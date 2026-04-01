import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommonHandlers } from './registerCommonHandlers';

const {
    mockExec,
    mockLogger,
    mockExecResult,
} = vi.hoisted(() => {
    const mockExecResult = {
        stdout: '',
        stderr: '',
    };
    const mockExec = vi.fn();
    (mockExec as any)[Symbol.for('nodejs.util.promisify.custom')] = () => Promise.resolve(mockExecResult);
    const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    return {
        mockExec,
        mockLogger,
        mockExecResult,
    };
});

vi.mock('child_process', () => ({
    exec: mockExec,
}));

vi.mock('../../api/rpc/RpcHandlerManager', () => ({
    RpcHandlerManager: class {},
}));

vi.mock('@/modules/ripgrep/index', () => ({
    run: vi.fn(),
}));

vi.mock('@/modules/difftastic/index', () => ({
    run: vi.fn(),
}));

vi.mock('@/ui/logger', () => ({
    logger: mockLogger,
}));

describe('registerCommonHandlers bash handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('treats permission-denied stderr as a failure even when exec resolves', async () => {
        mockExecResult.stdout = '';
        mockExecResult.stderr = 'mkdir: /restricted/path: Operation not permitted\n';

        const handlers = new Map<string, (data: any) => Promise<any>>();
        const manager = {
            registerHandler: vi.fn((method: string, handler: (data: any) => Promise<any>) => {
                handlers.set(method, handler);
            }),
        };

        registerCommonHandlers(manager as any, '/tmp/project');

        const handler = handlers.get('bash');
        expect(handler).toBeDefined();

        const response = await handler!({
            command: 'mkdir -p /restricted/path',
            cwd: '/tmp/project',
            timeout: 1000,
        }) as {
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
            error?: string;
        };

        expect(response).toEqual(expect.objectContaining({
            success: false,
            stdout: '',
            stderr: 'mkdir: /restricted/path: Operation not permitted\n',
            exitCode: 1,
        }));
        expect(response.error).toContain('Operation not permitted');
    });
});
