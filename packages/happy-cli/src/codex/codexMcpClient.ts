/**
 * Codex MCP Client - Simple wrapper for Codex tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '@/ui/logger';
import type { CodexSessionConfig, CodexToolResponse } from './types';
import { z } from 'zod';
import { CodexPermissionHandler } from './utils/permissionHandler';
import { execSync } from 'child_process';
import type { SandboxConfig } from '@/persistence';
import { initializeSandbox, wrapForMcpTransport } from '@/sandbox/manager';
import { delay } from '@/utils/time';

const DEFAULT_TIMEOUT = 14 * 24 * 60 * 60 * 1000; // 14 days, which is the half of the maximum possible timeout (~28 days for int32 value in NodeJS)
const CodexElicitRequestSchema = z.object({
    method: z.literal('elicitation/create'),
    params: z.record(z.string(), z.unknown()),
}).passthrough();

function extractEnumStringsFromSchema(schema: unknown): string[] {
    if (!schema || typeof schema !== 'object') {
        return [];
    }

    const queue: unknown[] = [schema];
    const allowed = new Set<string>();

    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') {
            continue;
        }

        const typed = node as Record<string, unknown>;
        if (Array.isArray(typed.enum)) {
            for (const item of typed.enum) {
                if (typeof item === 'string') {
                    allowed.add(item);
                }
            }
        }
        if (typeof typed.const === 'string') {
            allowed.add(typed.const);
        }

        for (const value of Object.values(typed)) {
            if (value && typeof value === 'object') {
                queue.push(value);
            }
        }
    }

    return [...allowed];
}

function normalizeCodexDecision(
    decision: 'approved' | 'approved_for_session' | 'denied' | 'abort',
    allowedDecisions: string[] = [],
): string {
    const allowedSet = new Set(allowedDecisions);

    // Codex approval endpoints generally expect approved/abort style decisions.
    // Keep existing behavior equivalent while avoiding unsupported variants.
    let normalized: string = decision;
    if (normalized === 'approved_for_session') {
        normalized = 'approved';
    } else if (normalized === 'denied') {
        normalized = 'abort';
    }

    if (allowedSet.size > 0 && !allowedSet.has(normalized)) {
        if (normalized === 'approved' && allowedSet.has('accept')) {
            normalized = 'accept';
        } else if (allowedSet.has('approved')) {
            normalized = 'approved';
        } else if (allowedSet.has('abort')) {
            normalized = 'abort';
        } else {
            normalized = allowedDecisions[0] || 'abort';
        }
    }

    return normalized;
}

function extractStringDecisionsFromAvailableDecisions(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const decisions = new Set<string>();
    for (const item of value) {
        if (typeof item === 'string') {
            decisions.add(item);
        }
    }

    return [...decisions];
}

function buildElicitationApprovalResponse(
    decision: string,
    decisionField: string,
): Record<string, unknown> {
    const content: Record<string, unknown> = {
        [decisionField]: decision,
    };

    // Compatibility:
    // - Standard MCP elicitation consumers read `action` + `content`.
    // - Some Codex builds still read top-level `decision` (and sometimes the decision field itself).
    return {
        action: decision === 'abort' ? 'decline' : 'accept',
        content,
        decision,
        [decisionField]: decision,
    };
}

function getRequestedSchemaProperties(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') {
        return {};
    }

    const properties = (schema as Record<string, unknown>).properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        return {};
    }

    return properties as Record<string, unknown>;
}

function resolveDecisionFieldAndEnum(schema: unknown): { field: string; allowedDecisions: string[] } {
    const properties = getRequestedSchemaProperties(schema);
    const propertyEntries = Object.entries(properties);

    if (propertyEntries.length === 0) {
        return { field: 'decision', allowedDecisions: [] };
    }

    if (Object.prototype.hasOwnProperty.call(properties, 'decision')) {
        const allowedDecisions = extractEnumStringsFromSchema(properties.decision);
        return { field: 'decision', allowedDecisions };
    }

    const preferredValues = new Set(['approved', 'abort', 'accept', 'decline', 'cancel', 'deny', 'denied']);
    for (const [field, schemaNode] of propertyEntries) {
        const enums = extractEnumStringsFromSchema(schemaNode);
        if (enums.some(value => preferredValues.has(value))) {
            return { field, allowedDecisions: enums };
        }
    }

    const [firstField, firstSchema] = propertyEntries[0];
    return {
        field: firstField,
        allowedDecisions: extractEnumStringsFromSchema(firstSchema),
    };
}

/**
 * Get the correct MCP subcommand based on installed codex version
 * Versions >= 0.43.0-alpha.5 use 'mcp-server', older versions use 'mcp'
 * Returns null if codex is not installed or version cannot be determined
 */
function getCodexMcpCommand(): string | null {
    try {
        const version = execSync('codex --version', { encoding: 'utf8' }).trim();
        const match = version.match(/codex-cli\s+(\d+\.\d+\.\d+(?:-alpha\.\d+)?)/);
        if (!match) {
            logger.debug('[CodexMCP] Could not parse codex version:', version);
            return null;
        }

        const versionStr = match[1];
        const [major, minor, patch] = versionStr.split(/[-.]/).map(Number);

        // Version >= 0.43.0-alpha.5 has mcp-server
        if (major > 0 || minor > 43) return 'mcp-server';
        if (minor === 43 && patch === 0) {
            // Check for alpha version
            if (versionStr.includes('-alpha.')) {
                const alphaNum = parseInt(versionStr.split('-alpha.')[1]);
                return alphaNum >= 5 ? 'mcp-server' : 'mcp';
            }
            return 'mcp-server'; // 0.43.0 stable has mcp-server
        }
        return 'mcp'; // Older versions use mcp
    } catch (error) {
        logger.debug('[CodexMCP] Codex CLI not found or not executable:', error);
        return null;
    }
}

export class CodexMcpClient {
    private client: Client;
    private transport: StdioClientTransport | null = null;
    private connected: boolean = false;
    private sessionId: string | null = null;
    private conversationId: string | null = null;
    private handler: ((event: any) => void) | null = null;
    private permissionHandler: CodexPermissionHandler | null = null;
    private sandboxConfig?: SandboxConfig;
    private sandboxCleanup: (() => Promise<void>) | null = null;
    public sandboxEnabled: boolean = false;
    private terminalEventCounter = 0;
    private terminalEventListeners = new Set<(event: { counter: number; message: any }) => void>();

    constructor(sandboxConfig?: SandboxConfig) {
        this.sandboxConfig = sandboxConfig;
        this.client = new Client(
            { name: 'happy-codex-client', version: '1.0.0' },
            { capabilities: { elicitation: {} } }
        );

        this.client.setNotificationHandler(z.object({
            method: z.literal('codex/event'),
            params: z.object({
                msg: z.any()
            })
        }).passthrough(), (data) => {
            const msg = data.params.msg;
            this.updateIdentifiersFromEvent(msg);
            this.notifyTerminalEventIfNeeded(msg);
            this.handler?.(msg);
        });
    }

    private notifyTerminalEventIfNeeded(message: any): void {
        if (!message || typeof message !== 'object') {
            return;
        }

        if (message.type !== 'task_complete' && message.type !== 'turn_aborted') {
            return;
        }

        this.terminalEventCounter += 1;
        const event = {
            counter: this.terminalEventCounter,
            message,
        };

        for (const listener of this.terminalEventListeners) {
            try {
                listener(event);
            } catch (error) {
                logger.debug('[CodexMCP] Terminal event listener failed', error);
            }
        }
    }

    private waitForNextTerminalEvent(afterCounter: number): {
        promise: Promise<{ counter: number; message: any }>;
        dispose: () => void;
    } {
        let disposed = false;
        let resolveFn: ((event: { counter: number; message: any }) => void) | null = null;

        const promise = new Promise<{ counter: number; message: any }>((resolve) => {
            resolveFn = resolve;
        });

        const listener = (event: { counter: number; message: any }) => {
            if (disposed) {
                return;
            }
            if (event.counter <= afterCounter) {
                return;
            }
            disposed = true;
            this.terminalEventListeners.delete(listener);
            resolveFn?.(event);
        };

        this.terminalEventListeners.add(listener);

        return {
            promise,
            dispose: () => {
                if (disposed) {
                    return;
                }
                disposed = true;
                this.terminalEventListeners.delete(listener);
            },
        };
    }

    /**
     * Codex can emit terminal events (e.g. turn_aborted) without resolving the MCP tool call.
     * Use terminal events as a fallback so the run loop does not remain blocked forever.
     */
    private async callToolWithTerminalFallback(
        request: { name: string; arguments: any },
        options?: { signal?: AbortSignal },
        operationLabel: 'startSession' | 'continueSession' = 'continueSession',
    ): Promise<any> {
        const baselineCounter = this.terminalEventCounter;
        const terminalWait = this.waitForNextTerminalEvent(baselineCounter);
        const toolPromise = this.client.callTool(request, undefined, {
            signal: options?.signal,
            timeout: DEFAULT_TIMEOUT,
        });

        try {
            const raced = await Promise.race([
                toolPromise.then((response) => ({ kind: 'tool' as const, response })),
                terminalWait.promise.then((event) => ({ kind: 'terminal' as const, event })),
            ]);

            if (raced.kind === 'tool') {
                return raced.response;
            }

            logger.debug(`[CodexMCP] ${operationLabel} observed terminal event before tool response`, {
                eventType: raced.event.message?.type,
                turnId: raced.event.message?.turn_id,
            });

            const graceResult = await Promise.race([
                toolPromise.then((response) => ({ settled: true as const, response })),
                delay(1200).then(() => ({ settled: false as const })),
            ]);

            if (graceResult.settled) {
                return graceResult.response;
            }

            // Keep observing late completion to avoid unhandled rejections.
            toolPromise
                .then((response) => {
                    logger.debug(`[CodexMCP] ${operationLabel} late tool response arrived`, response);
                })
                .catch((error) => {
                    logger.debug(`[CodexMCP] ${operationLabel} late tool response failed`, error);
                });

            logger.debug(`[CodexMCP] ${operationLabel} returning synthetic fallback response after terminal event`);
            return { content: [] };
        } finally {
            terminalWait.dispose();
        }
    }

    setHandler(handler: ((event: any) => void) | null): void {
        this.handler = handler;
    }

    /**
     * Set the permission handler for tool approval
     */
    setPermissionHandler(handler: CodexPermissionHandler): void {
        this.permissionHandler = handler;
    }

    async connect(): Promise<void> {
        if (this.connected) return;

        const mcpCommand = getCodexMcpCommand();

        if (mcpCommand === null) {
            throw new Error(
                'Codex CLI not found or not executable.\n' +
                '\n' +
                'To install codex:\n' +
                '  npm install -g @openai/codex\n' +
                '\n' +
                'Alternatively, use Claude:\n' +
                '  happy claude'
            );
        }

        logger.debug(`[CodexMCP] Connecting to Codex MCP server using command: codex ${mcpCommand}`);

        let transportCommand = 'codex';
        let transportArgs = [mcpCommand];
        this.sandboxEnabled = false;

        if (this.sandboxConfig?.enabled) {
            if (process.platform === 'win32') {
                logger.warn('[CodexMCP] Sandbox is not supported on Windows; continuing without sandbox.');
            } else {
                try {
                    this.sandboxCleanup = await initializeSandbox(this.sandboxConfig, process.cwd());
                    const wrappedTransport = await wrapForMcpTransport('codex', [mcpCommand]);
                    transportCommand = wrappedTransport.command;
                    transportArgs = wrappedTransport.args;
                    this.sandboxEnabled = true;
                    logger.info(
                        `[CodexMCP] Sandbox enabled: workspace=${this.sandboxConfig.workspaceRoot ?? process.cwd()}, network=${this.sandboxConfig.networkMode}`,
                    );
                } catch (error) {
                    logger.warn('[CodexMCP] Failed to initialize sandbox; continuing without sandbox.', error);
                    this.sandboxCleanup = null;
                    this.sandboxEnabled = false;
                }
            }
        }

        try {
            const transportEnv = Object.keys(process.env).reduce((acc, key) => {
                const value = process.env[key];
                if (typeof value === 'string') acc[key] = value;
                return acc;
            }, {} as Record<string, string>);

            // Codex currently logs noisy rollout fallback messages at ERROR level during
            // state-db migration. Keep all other logs intact, only mute this module.
            const rolloutListFilter = 'codex_core::rollout::list=off';
            const existingRustLog = transportEnv.RUST_LOG?.trim();
            if (!existingRustLog) {
                transportEnv.RUST_LOG = rolloutListFilter;
            } else if (!existingRustLog.includes('codex_core::rollout::list=')) {
                transportEnv.RUST_LOG = `${existingRustLog},${rolloutListFilter}`;
            }

            if (this.sandboxEnabled) {
                // Codex uses this flag to disable proxy auto-discovery that can panic under seatbelt-like sandboxes.
                transportEnv.CODEX_SANDBOX = 'seatbelt';
            }

            this.transport = new StdioClientTransport({
                command: transportCommand,
                args: transportArgs,
                env: transportEnv,
            });

            // Register request handlers for Codex permission methods
            this.registerPermissionHandlers();

            await this.client.connect(this.transport);
            this.connected = true;
        } catch (error) {
            if (this.sandboxCleanup) {
                try {
                    await this.sandboxCleanup();
                } catch (cleanupError) {
                    logger.warn('[CodexMCP] Failed to reset sandbox after connection error.', cleanupError);
                } finally {
                    this.sandboxCleanup = null;
                }
            }
            this.sandboxEnabled = false;
            throw error;
        }

        logger.debug('[CodexMCP] Connected to Codex');
    }

    private registerPermissionHandlers(): void {
        // Register handler for exec command approval requests
        this.client.setRequestHandler(
            CodexElicitRequestSchema,
            async (request) => {
                const params = request.params && typeof request.params === 'object'
                    ? (request.params as Record<string, unknown>)
                    : {};
                const pickString = (...values: unknown[]): string | undefined => {
                    for (const value of values) {
                        if (typeof value === 'string' && value.trim().length > 0) {
                            return value;
                        }
                    }
                    return undefined;
                };

                const commandInput = params.codex_command ?? params.command;
                const normalizedCommand = Array.isArray(commandInput)
                    ? commandInput.filter((item): item is string => typeof item === 'string')
                    : (typeof commandInput === 'string' ? commandInput : undefined);
                const toolCallId = pickString(
                    params.codex_call_id,
                    params.call_id,
                    params.codex_mcp_tool_call_id,
                    params.codex_event_id,
                );
                const elicitationType = pickString(params.codex_elicitation, params.type, params.message) || '';
                const lowerElicitationType = elicitationType.toLowerCase();
                const isPatchApproval = lowerElicitationType.includes('patch') || lowerElicitationType.includes('code changes');
                const toolName = isPatchApproval ? 'CodexPatch' : 'CodexBash';
                const schemaResolution = resolveDecisionFieldAndEnum(params.requestedSchema);
                const availableDecisions = extractStringDecisionsFromAvailableDecisions(params.available_decisions);
                const mergedAllowedDecisions = schemaResolution.allowedDecisions.length > 0
                    ? schemaResolution.allowedDecisions
                    : availableDecisions;
                const decisionField = schemaResolution.field;
                const input: Record<string, unknown> = {};
                if (normalizedCommand !== undefined) {
                    input.command = normalizedCommand;
                }
                const cwd = pickString(params.codex_cwd, params.cwd);
                if (cwd) {
                    input.cwd = cwd;
                }
                const message = pickString(params.message, params.reason);
                if (message) {
                    input.message = message;
                }
                if (params.changes && typeof params.changes === 'object') {
                    input.changes = params.changes;
                }
                if (Object.keys(input).length === 0) {
                    Object.assign(input, params);
                }

                logger.debug('[CodexMCP] Received approval request', {
                    elicitationType,
                    toolCallId,
                    toolName,
                    keys: Object.keys(params),
                    hasCommand: normalizedCommand !== undefined,
                    availableDecisions,
                    decisionField,
                });

                // If no permission handler set, deny by default
                if (!this.permissionHandler) {
                    logger.debug('[CodexMCP] No permission handler set, denying by default');
                    const decision = normalizeCodexDecision('abort', mergedAllowedDecisions);
                    return buildElicitationApprovalResponse(decision, decisionField);
                }

                try {
                    // Request permission through the handler
                    const result = await this.permissionHandler.handleToolCall(
                        toolCallId,
                        toolName,
                        input
                    );
                    const decision = normalizeCodexDecision(result.decision, mergedAllowedDecisions);

                    logger.debug('[CodexMCP] Permission result:', {
                        rawDecision: result.decision,
                        normalizedDecision: decision,
                        decisionField,
                    });
                    return buildElicitationApprovalResponse(decision, decisionField);
                } catch (error) {
                    logger.debug('[CodexMCP] Error handling permission request:', error);
                    const decision = normalizeCodexDecision('abort', mergedAllowedDecisions);
                    return buildElicitationApprovalResponse(decision, decisionField);
                }
            }
        );

        logger.debug('[CodexMCP] Permission handlers registered');
    }

    async startSession(config: CodexSessionConfig, options?: { signal?: AbortSignal }): Promise<CodexToolResponse> {
        if (!this.connected) await this.connect();

        logger.debug('[CodexMCP] Starting Codex session:', config);

        const response = await this.callToolWithTerminalFallback(
            {
                name: 'codex',
                arguments: config as any,
            },
            options,
            'startSession',
        );

        logger.debug('[CodexMCP] startSession response:', response);

        // Extract session / conversation identifiers from response if present
        this.extractIdentifiers(response);

        return response as CodexToolResponse;
    }

    async continueSession(prompt: string, options?: { signal?: AbortSignal }): Promise<CodexToolResponse> {
        if (!this.connected) await this.connect();

        if (!this.sessionId) {
            throw new Error('No active session. Call startSession first.');
        }

        if (!this.conversationId) {
            // Some Codex deployments reuse the session ID as the conversation identifier
            this.conversationId = this.sessionId;
            logger.debug('[CodexMCP] conversationId missing, defaulting to sessionId:', this.conversationId);
        }

        const args = { sessionId: this.sessionId, conversationId: this.conversationId, prompt };
        logger.debug('[CodexMCP] Continuing Codex session:', args);

        const response = await this.callToolWithTerminalFallback(
            {
                name: 'codex-reply',
                arguments: args,
            },
            options,
            'continueSession',
        );

        logger.debug('[CodexMCP] continueSession response:', response);
        this.extractIdentifiers(response);

        return response as CodexToolResponse;
    }


    private updateIdentifiersFromEvent(event: any): void {
        if (!event || typeof event !== 'object') {
            return;
        }

        const candidates: any[] = [event];
        if (event.data && typeof event.data === 'object') {
            candidates.push(event.data);
        }

        for (const candidate of candidates) {
            const sessionId = candidate.session_id ?? candidate.sessionId;
            if (sessionId) {
                this.sessionId = sessionId;
                logger.debug('[CodexMCP] Session ID extracted from event:', this.sessionId);
            }

            const conversationId = candidate.conversation_id ?? candidate.conversationId;
            if (conversationId) {
                this.conversationId = conversationId;
                logger.debug('[CodexMCP] Conversation ID extracted from event:', this.conversationId);
            }
        }
    }
    private extractIdentifiers(response: any): void {
        const meta = response?.meta || {};
        if (meta.sessionId) {
            this.sessionId = meta.sessionId;
            logger.debug('[CodexMCP] Session ID extracted:', this.sessionId);
        } else if (response?.sessionId) {
            this.sessionId = response.sessionId;
            logger.debug('[CodexMCP] Session ID extracted:', this.sessionId);
        }

        if (meta.conversationId) {
            this.conversationId = meta.conversationId;
            logger.debug('[CodexMCP] Conversation ID extracted:', this.conversationId);
        } else if (response?.conversationId) {
            this.conversationId = response.conversationId;
            logger.debug('[CodexMCP] Conversation ID extracted:', this.conversationId);
        }

        const content = response?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (!this.sessionId && item?.sessionId) {
                    this.sessionId = item.sessionId;
                    logger.debug('[CodexMCP] Session ID extracted from content:', this.sessionId);
                }
                if (!this.conversationId && item && typeof item === 'object' && 'conversationId' in item && item.conversationId) {
                    this.conversationId = item.conversationId;
                    logger.debug('[CodexMCP] Conversation ID extracted from content:', this.conversationId);
                }
            }
        }
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    hasActiveSession(): boolean {
        return this.sessionId !== null;
    }

    clearSession(): void {
        // Store the previous session ID before clearing for potential resume
        const previousSessionId = this.sessionId;
        this.sessionId = null;
        this.conversationId = null;
        logger.debug('[CodexMCP] Session cleared, previous sessionId:', previousSessionId);
    }

    /**
     * Store the current session ID without clearing it, useful for abort handling
     */
    storeSessionForResume(): string | null {
        logger.debug('[CodexMCP] Storing session for potential resume:', this.sessionId);
        return this.sessionId;
    }

    /**
     * Force close the Codex MCP transport and clear all session identifiers.
     * Use this for permanent shutdown (e.g. kill/exit). Prefer `disconnect()` for
     * transient connection resets where you may want to keep the session id.
     */
    async forceCloseSession(): Promise<void> {
        logger.debug('[CodexMCP] Force closing session');
        try {
            await this.disconnect();
        } finally {
            this.clearSession();
        }
        logger.debug('[CodexMCP] Session force-closed');
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        // Capture pid in case we need to force-kill
        const pid = this.transport?.pid ?? null;
        logger.debug(`[CodexMCP] Disconnecting; child pid=${pid ?? 'none'}`);

        try {
            // Ask client to close the transport
            logger.debug('[CodexMCP] client.close begin');
            await this.client.close();
            logger.debug('[CodexMCP] client.close done');
        } catch (e) {
            logger.debug('[CodexMCP] Error closing client, attempting transport close directly', e);
            try { 
                logger.debug('[CodexMCP] transport.close begin');
                await this.transport?.close?.(); 
                logger.debug('[CodexMCP] transport.close done');
            } catch {}
        }

        // As a last resort, if child still exists, send SIGKILL
        if (pid) {
            try {
                process.kill(pid, 0); // check if alive
                logger.debug('[CodexMCP] Child still alive, sending SIGKILL');
                try { process.kill(pid, 'SIGKILL'); } catch {}
            } catch { /* not running */ }
        }

        this.transport = null;
        this.connected = false;
        if (this.sandboxCleanup) {
            try {
                await this.sandboxCleanup();
            } catch (error) {
                logger.warn('[CodexMCP] Failed to reset sandbox during disconnect.', error);
            } finally {
                this.sandboxCleanup = null;
            }
        }
        this.sandboxEnabled = false;
        // Preserve session/conversation identifiers for potential reconnection / recovery flows.
        logger.debug(`[CodexMCP] Disconnected; session ${this.sessionId ?? 'none'} preserved`);
    }
}
