import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommonHandlers } from './registerCommonHandlers';

type ExecCallback = (error: any, stdout: string, stderr: string) => void;

const { mockExec, mockLogger } = vi.hoisted(() => {
    const mockExec = vi.fn();
    const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    return {
        mockExec,
        mockLogger,
    };
});

vi.mock('child_process', () => ({
    exec: mockExec,
}));

vi.mock('@/utils/time', () => ({
    delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
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

function createMockExecChild() {
    const child = new EventEmitter() as EventEmitter & {
        pid: number;
        kill: ReturnType<typeof vi.fn>;
        stdin: { end: ReturnType<typeof vi.fn> };
    };

    child.pid = 4242;
    child.kill = vi.fn(() => true);
    child.stdin = { end: vi.fn() };
    return child;
}

describe('registerCommonHandlers bash handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('treats permission-denied stderr as a failure when exec reports an error', async () => {
        const child = createMockExecChild();
        let execCallback: any = null;

        mockExec.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
            execCallback = callback;
            return child;
        });

        const handlers = new Map<string, (data: any) => Promise<any>>();
        const cleanupHooks: Array<() => Promise<void> | void> = [];
        const manager = {
            registerHandler: vi.fn((method: string, handler: (data: any) => Promise<any>) => {
                handlers.set(method, handler);
            }),
            registerCleanupHook: vi.fn((hook: () => Promise<void> | void) => {
                cleanupHooks.push(hook);
            }),
        };

        registerCommonHandlers(manager as any, '/tmp/project');

        const handler = handlers.get('bash');
        expect(handler).toBeDefined();
        expect(cleanupHooks).toHaveLength(1);

        const responsePromise = handler!({
            command: 'mkdir -p /restricted/path',
            cwd: '/tmp/project',
            timeout: 1000,
        }) as Promise<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
            error?: string;
        }>;

        expect(mockExec).toHaveBeenCalledTimes(1);
        if (!execCallback) {
            throw new Error('Expected exec callback to be captured');
        }
        execCallback!(Object.assign(new Error('Command failed'), {
            code: 1,
            stdout: '',
            stderr: 'mkdir: /restricted/path: Operation not permitted\n',
        }), '', 'mkdir: /restricted/path: Operation not permitted\n');

        await expect(responsePromise).resolves.toEqual(expect.objectContaining({
            success: false,
            stdout: '',
            stderr: 'mkdir: /restricted/path: Operation not permitted\n',
            exitCode: 1,
        }));
    });

    it('terminates active shell commands when the cleanup hook runs', async () => {
        vi.useFakeTimers();
        try {
            const child = createMockExecChild();
            let execCallback: any = null;

            mockExec.mockImplementation((_command: string, _options: unknown, callback: ExecCallback) => {
                execCallback = callback;
                return child;
            });

            const handlers = new Map<string, (data: any) => Promise<any>>();
            const cleanupHooks: Array<() => Promise<void> | void> = [];
            const manager = {
                registerHandler: vi.fn((method: string, handler: (data: any) => Promise<any>) => {
                    handlers.set(method, handler);
                }),
                registerCleanupHook: vi.fn((hook: () => Promise<void> | void) => {
                    cleanupHooks.push(hook);
                }),
            };

            registerCommonHandlers(manager as any, '/tmp/project');

            const handler = handlers.get('bash');
            expect(handler).toBeDefined();
            expect(cleanupHooks).toHaveLength(1);

            const responsePromise = handler!({
                command: 'sleep 30',
                cwd: '/tmp/project',
                timeout: 30000,
            }) as Promise<{
                success: boolean;
                stdout: string;
                stderr: string;
                exitCode: number;
                error?: string;
            }>;

            expect(mockExec).toHaveBeenCalledTimes(1);

            const cleanupPromise = Promise.resolve(cleanupHooks[0]());
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');

            await vi.advanceTimersByTimeAsync(250);
            expect(child.kill).toHaveBeenCalledWith('SIGKILL');

            if (!execCallback) {
                throw new Error('Expected exec callback to be captured');
            }
            execCallback!(Object.assign(new Error('Command failed'), {
                code: 'SIGTERM',
                killed: true,
                stdout: '',
                stderr: '',
            }), '', '');

            await vi.advanceTimersByTimeAsync(100);
            await cleanupPromise;
            await expect(responsePromise).resolves.toEqual(expect.objectContaining({
                success: false,
                exitCode: -1,
            }));
        } finally {
            vi.useRealTimers();
        }
    });
});
