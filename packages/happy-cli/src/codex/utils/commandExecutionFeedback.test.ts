import { describe, expect, it } from 'vitest';
import { formatCommandExecutionOutput, isCommandExecutionError } from './commandExecutionFeedback';

describe('commandExecutionFeedback', () => {
    it('treats non-zero exit code as an error', () => {
        expect(isCommandExecutionError({ exit_code: 1, status: 'failed' })).toBe(true);
    });

    it('treats completed status with zero exit code as success', () => {
        expect(isCommandExecutionError({ exit_code: 0, status: 'completed' })).toBe(false);
    });

    it('formats string error output as-is', () => {
        expect(formatCommandExecutionOutput({ error: 'Permission denied' })).toBe('Permission denied');
    });

    it('stringifies structured output when needed', () => {
        expect(formatCommandExecutionOutput({ output: { stderr: 'Permission denied' } })).toBe('{"stderr":"Permission denied"}');
    });
});
