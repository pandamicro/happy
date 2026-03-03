import { describe, expect, it } from 'vitest';
import { parseCodexArgs } from '../codexArgs';

describe('parseCodexArgs', () => {
    it('parses --started-by', () => {
        const parsed = parseCodexArgs(['--started-by', 'daemon']);
        expect(parsed).toEqual({
            startedBy: 'daemon',
            resumeRequested: false,
        });
    });

    it('parses --resume without session id', () => {
        const parsed = parseCodexArgs(['--resume']);
        expect(parsed).toEqual({
            resumeRequested: true,
        });
    });

    it('parses --resume with session id', () => {
        const parsed = parseCodexArgs(['--resume', 'session-123']);
        expect(parsed).toEqual({
            resumeRequested: true,
            resumeSessionId: 'session-123',
        });
    });

    it('parses short -r resume flag', () => {
        const parsed = parseCodexArgs(['-r', 'session-123']);
        expect(parsed).toEqual({
            resumeRequested: true,
            resumeSessionId: 'session-123',
        });
    });

    it('parses `resume` subcommand style without session id', () => {
        const parsed = parseCodexArgs(['resume']);
        expect(parsed).toEqual({
            resumeRequested: true,
        });
    });

    it('parses `resume` subcommand style with session id', () => {
        const parsed = parseCodexArgs(['resume', 'session-123', '--started-by', 'terminal']);
        expect(parsed).toEqual({
            startedBy: 'terminal',
            resumeRequested: true,
            resumeSessionId: 'session-123',
        });
    });
});
