import { describe, expect, it } from 'vitest';
import { formatToolError } from './codexBashViewUtils';

describe('formatToolError', () => {
    it('returns plain string errors as-is', () => {
        expect(formatToolError('Permission denied')).toBe('Permission denied');
    });

    it('prefers structured error fields', () => {
        expect(formatToolError({ stderr: 'Operation not permitted', exitCode: 1 })).toBe('Operation not permitted');
    });

    it('falls back to JSON for opaque objects', () => {
        expect(formatToolError({ foo: 'bar' })).toBe('{\n  "foo": "bar"\n}');
    });
});
