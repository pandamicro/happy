import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStateMock = vi.fn();

vi.mock('./storage', () => ({
    storage: {
        getState: () => getStateMock()
    }
}));

import { getAllCommands, searchCommands } from './suggestionCommands';

describe('suggestionCommands', () => {
    beforeEach(() => {
        getStateMock.mockReset();
    });

    it('returns Codex fallback commands when slash metadata is missing', () => {
        getStateMock.mockReturnValue({
            sessions: {
                s1: {
                    metadata: {
                        flavor: 'codex'
                    }
                }
            }
        });

        const commands = getAllCommands('s1').map((c) => c.command);
        expect(commands).toEqual(
            expect.arrayContaining([
                'clear',
                'compact',
                'agents',
                'help',
                'model',
                'permissions',
                'review',
                'status'
            ])
        );
    });

    it('filters ignored slash commands but keeps deduped defaults', async () => {
        getStateMock.mockReturnValue({
            sessions: {
                s1: {
                    metadata: {
                        flavor: 'codex',
                        slashCommands: ['help', 'status', 'custom-tool', 'mcp']
                    }
                }
            }
        });

        const commands = await searchCommands('s1', '', { limit: 20 });
        const names = commands.map((c) => c.command);

        expect(names).toContain('custom-tool');
        expect(names).not.toContain('mcp');
        expect(names.filter((c) => c === 'help')).toHaveLength(1);
        expect(names.filter((c) => c === 'status')).toHaveLength(1);
    });
});
