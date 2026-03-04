/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest,
    PermissionResolutionContext,
} from '../../utils/BasePermissionHandler';

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
    private approveForSessionTools = new Set<string>();

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

    /**
     * Handle a tool permission request
     * @param toolCallId - The unique ID of the tool call
     * @param toolName - The name of the tool being called
     * @param input - The input parameters for the tool
     * @returns Promise resolving to permission result
     */
    async handleToolCall(
        toolCallId: string | null | undefined,
        toolName: string,
        input: unknown
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
            }));

            return { decision: 'approved_for_session' };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            // Store the pending request
            this.pendingRequests.set(normalizedToolCallId, {
                resolve,
                reject,
                toolName,
                input
            });

            // Update agent state with pending request
            this.addPendingRequestToState(normalizedToolCallId, toolName, input);

            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${normalizedToolCallId})`);
        });
    }
}
