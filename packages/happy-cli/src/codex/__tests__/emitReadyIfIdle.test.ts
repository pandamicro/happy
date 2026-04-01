import { describe, expect, it, vi } from 'vitest';
import { emitReadyIfIdle, getCodexToolErrorMessage } from '../runCodex';

describe('emitReadyIfIdle', () => {
    it('emits ready and notification when queue is idle', () => {
        const sendReady = vi.fn();
        const notify = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
            notify,
        });

        expect(emitted).toBe(true);
        expect(sendReady).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('skips when a message is still pending', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: {},
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when queue still has items', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 2,
            shouldExit: false,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when shutdown is requested', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: true,
            sendReady,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });

    it('skips when the turn ended with an error', () => {
        const sendReady = vi.fn();

        const emitted = emitReadyIfIdle({
            pending: null,
            queueSize: () => 0,
            shouldExit: false,
            sendReady,
            allowReady: false,
        });

        expect(emitted).toBe(false);
        expect(sendReady).not.toHaveBeenCalled();
    });
});

describe('getCodexToolErrorMessage', () => {
    it('extracts text from error tool responses', () => {
        const message = getCodexToolErrorMessage({
            isError: true,
            content: [
                {
                    type: 'text',
                    text: 'unexpected status 503 Service Unavailable',
                },
            ],
        });

        expect(message).toBe('unexpected status 503 Service Unavailable');
    });

    it('ignores successful tool responses', () => {
        const message = getCodexToolErrorMessage({
            isError: false,
            content: [
                {
                    type: 'text',
                    text: 'ok',
                },
            ],
        });

        expect(message).toBeNull();
    });
});
