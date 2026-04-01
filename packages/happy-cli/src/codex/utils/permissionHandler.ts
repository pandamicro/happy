/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { AgentState } from "@/api/types";
import { randomUUID } from "node:crypto";
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest,
    PermissionResolutionContext,
} from '@/utils/BasePermissionHandler';

export type { PermissionResult, PendingRequest };

export class CodexPermissionHandler extends BasePermissionHandler {
    private approveForSessionTools = new Set<string>();

    private static readonly ALWAYS_AUTO_APPROVE_NAMES = [
        'change_title',
    ];

    private static readonly ALWAYS_AUTO_APPROVE_IDS = [
        'change_title',
    ];

    constructor(session: ApiSessionClient) {
        super(session);
    }

    protected getLogPrefix(): string {
        return '[Codex]';
    }

    protected onPermissionResolved(context: PermissionResolutionContext): void {
        if (context.result.decision === 'approved_for_session') {
            const toolName = context.pending.toolName;
            if (!this.approveForSessionTools.has(toolName)) {
                logger.debug(`${this.getLogPrefix()} Session-level auto-approval enabled`, { toolName });
            }
            this.approveForSessionTools.add(toolName);
        }
    }

    private shouldAutoApprove(toolName: string, toolCallId: string): boolean {
        if (CodexPermissionHandler.ALWAYS_AUTO_APPROVE_NAMES.some((name) => toolName.toLowerCase().includes(name.toLowerCase()))) {
            return true;
        }

        if (CodexPermissionHandler.ALWAYS_AUTO_APPROVE_IDS.some((id) => toolCallId.toLowerCase().includes(id.toLowerCase()))) {
            return true;
        }

        return false;
    }

    async handleToolCall(
        toolCallId: string | null | undefined,
        toolName: string,
        input: unknown,
    ): Promise<PermissionResult> {
        const normalizedToolCallId = typeof toolCallId === 'string' && toolCallId.trim().length > 0
            ? toolCallId
            : randomUUID();

        if (normalizedToolCallId !== toolCallId) {
            logger.debug(`${this.getLogPrefix()} Missing tool call id for ${toolName}, generated fallback id`, {
                receivedToolCallId: toolCallId,
                normalizedToolCallId,
            });
        }

        if (this.shouldAutoApprove(toolName, normalizedToolCallId)) {
            logger.debug(`${this.getLogPrefix()} Auto-approving tool ${toolName} (${normalizedToolCallId})`);

            this.session.updateAgentState((currentState) => ({
                ...currentState,
                completedRequests: {
                    ...currentState.completedRequests,
                    [normalizedToolCallId]: {
                        tool: toolName,
                        arguments: input,
                        createdAt: Date.now(),
                        completedAt: Date.now(),
                        status: 'approved',
                        decision: 'approved',
                    },
                },
            } satisfies AgentState));

            return { decision: 'approved' };
        }

        if (this.approveForSessionTools.has(toolName)) {
            logger.debug(`${this.getLogPrefix()} Session-level approval active, auto-approving ${toolName} (${normalizedToolCallId})`);

            this.session.updateAgentState((currentState) => ({
                ...currentState,
                completedRequests: {
                    ...currentState.completedRequests,
                    [normalizedToolCallId]: {
                        tool: toolName,
                        arguments: input,
                        createdAt: Date.now(),
                        completedAt: Date.now(),
                        status: 'approved',
                        decision: 'approved_for_session',
                    },
                },
            } satisfies AgentState));

            return { decision: 'approved_for_session' };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            this.pendingRequests.set(normalizedToolCallId, {
                resolve,
                reject,
                toolName,
                input,
            });

            this.addPendingRequestToState(normalizedToolCallId, toolName, input);

            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${normalizedToolCallId})`);
        });
    }
}
