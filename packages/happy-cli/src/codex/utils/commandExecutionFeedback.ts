export type CommandExecutionEndEvent = {
    output?: unknown;
    error?: unknown;
    exit_code?: number | null;
    status?: string | null;
};

export function isCommandExecutionError(event: CommandExecutionEndEvent): boolean {
    if (event.exit_code !== undefined && event.exit_code !== null) {
        return event.exit_code !== 0;
    }

    return event.status !== undefined && event.status !== null
        ? event.status !== 'completed'
        : false;
}

export function formatCommandExecutionOutput(event: CommandExecutionEndEvent): string {
    const fallback = event.exit_code !== undefined && event.exit_code !== null && event.exit_code !== 0
        ? `Command failed with exit code ${event.exit_code}`
        : 'Command completed';
    const value = event.error ?? event.output ?? fallback;

    if (typeof value === 'string') {
        return value.trim().length > 0 ? value : fallback;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
