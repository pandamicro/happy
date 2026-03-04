import { describe, expect, it, vi } from 'vitest';
import type { AgentState } from '@/api/types';
import type { ApiSessionClient } from '@/api/apiSession';
import { CodexPermissionHandler } from '../utils/permissionHandler';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

type PermissionRpcHandler = (response: {
    id?: string | null;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}) => Promise<void>;

function createMockSession() {
    let permissionHandler: PermissionRpcHandler | null = null;
    let state: AgentState = {
        controlledByUser: false,
        requests: {},
        completedRequests: {},
    };

    const session = {
        rpcHandlerManager: {
            registerHandler: vi.fn((method: string, handler: PermissionRpcHandler) => {
                if (method === 'permission') {
                    permissionHandler = handler;
                }
            }),
        },
        updateAgentState: vi.fn((updater: (currentState: AgentState) => AgentState) => {
            state = updater(state);
            return state;
        }),
    } as unknown as ApiSessionClient;

    return {
        session,
        getState: () => state,
        getPermissionHandler: () => permissionHandler,
    };
}

describe('CodexPermissionHandler', () => {
    it('generates a stable fallback id when toolCallId is missing and resolves permission without id', async () => {
        const mock = createMockSession();
        const handler = new CodexPermissionHandler(mock.session);

        const permissionPromise = handler.handleToolCall(undefined, 'CodexPatch', { changes: { a: 1 } });
        const requests = mock.getState().requests || {};
        const requestIds = Object.keys(requests);
        expect(requestIds.length).toBe(1);
        const generatedId = requestIds[0];
        expect(generatedId).toBeTruthy();
        expect(generatedId).not.toBe('undefined');

        const permissionRpc = mock.getPermissionHandler();
        expect(permissionRpc).toBeTruthy();
        await permissionRpc!({ approved: true });

        await expect(permissionPromise).resolves.toEqual({ decision: 'approved' });
        const finalState = mock.getState();
        expect(finalState.requests?.[generatedId]).toBeUndefined();
        expect(finalState.completedRequests?.[generatedId]?.status).toBe('approved');
    });

    it('falls back to sole pending request when response id mismatches', async () => {
        const mock = createMockSession();
        const handler = new CodexPermissionHandler(mock.session);

        const permissionPromise = handler.handleToolCall('call_123', 'CodexBash', { command: 'ls' });
        const permissionRpc = mock.getPermissionHandler();
        expect(permissionRpc).toBeTruthy();
        await permissionRpc!({ id: 'wrong_id', approved: false, decision: 'denied' });

        await expect(permissionPromise).resolves.toEqual({ decision: 'denied' });
        const finalState = mock.getState();
        expect(finalState.requests?.call_123).toBeUndefined();
        expect(finalState.completedRequests?.call_123?.status).toBe('denied');
        expect(finalState.completedRequests?.call_123?.decision).toBe('denied');
    });

    it('auto-approves subsequent calls after approved_for_session', async () => {
        const mock = createMockSession();
        const handler = new CodexPermissionHandler(mock.session);

        const firstPermission = handler.handleToolCall('call_first', 'CodexPatch', { changes: { a: 1 } });
        const permissionRpc = mock.getPermissionHandler();
        expect(permissionRpc).toBeTruthy();
        await permissionRpc!({ id: 'call_first', approved: true, decision: 'approved_for_session' });

        await expect(firstPermission).resolves.toEqual({ decision: 'approved_for_session' });

        const secondPermission = await handler.handleToolCall('call_second', 'CodexPatch', { changes: { b: 2 } });
        expect(secondPermission).toEqual({ decision: 'approved_for_session' });

        const state = mock.getState();
        expect(state.requests?.call_second).toBeUndefined();
        expect(state.completedRequests?.call_second?.status).toBe('approved');
        expect(state.completedRequests?.call_second?.decision).toBe('approved_for_session');
    });

    it('does not auto-approve other tool types after approved_for_session', async () => {
        const mock = createMockSession();
        const handler = new CodexPermissionHandler(mock.session);

        const firstPermission = handler.handleToolCall('call_patch_1', 'CodexPatch', { changes: { a: 1 } });
        const permissionRpc = mock.getPermissionHandler();
        expect(permissionRpc).toBeTruthy();
        await permissionRpc!({ id: 'call_patch_1', approved: true, decision: 'approved_for_session' });
        await expect(firstPermission).resolves.toEqual({ decision: 'approved_for_session' });

        const bashPermissionPromise = handler.handleToolCall('call_bash_1', 'CodexBash', { command: 'ls' });
        const stateWithPendingBash = mock.getState();
        expect(stateWithPendingBash.requests?.call_bash_1).toBeDefined();

        await permissionRpc!({ id: 'call_bash_1', approved: false, decision: 'denied' });
        await expect(bashPermissionPromise).resolves.toEqual({ decision: 'denied' });
        expect(mock.getState().completedRequests?.call_bash_1?.decision).toBe('denied');
    });
});
