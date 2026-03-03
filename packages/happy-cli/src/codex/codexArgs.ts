export type CodexStartedBy = 'daemon' | 'terminal';

export type ParsedCodexArgs = {
    startedBy?: CodexStartedBy;
    resumeRequested: boolean;
    resumeSessionId?: string;
};

function isStartedBy(value: string | undefined): value is CodexStartedBy {
    return value === 'daemon' || value === 'terminal';
}

/**
 * Parse happy codex arguments for Happy-specific flags.
 *
 * Supported forms:
 * - happy codex --resume [session-id]
 * - happy codex -r [session-id]
 * - happy codex resume [session-id]
 * - happy codex --started-by daemon|terminal
 */
export function parseCodexArgs(rawArgs: string[]): ParsedCodexArgs {
    const parsed: ParsedCodexArgs = {
        resumeRequested: false,
    };

    const args = [...rawArgs];

    // Support `happy codex resume [session-id]`.
    if (args[0] === 'resume') {
        parsed.resumeRequested = true;
        args.shift();

        const maybeSessionId = args[0];
        if (maybeSessionId && !maybeSessionId.startsWith('-')) {
            parsed.resumeSessionId = maybeSessionId;
            args.shift();
        }
    }

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--started-by') {
            const value = args[i + 1];
            if (isStartedBy(value)) {
                parsed.startedBy = value;
            }
            i += 1;
            continue;
        }

        if (arg === '--resume' || arg === '-r') {
            parsed.resumeRequested = true;
            const maybeSessionId = args[i + 1];
            if (maybeSessionId && !maybeSessionId.startsWith('-')) {
                parsed.resumeSessionId = maybeSessionId;
                i += 1;
            }
        }
    }

    return parsed;
}
