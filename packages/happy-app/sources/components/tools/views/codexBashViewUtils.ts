export function formatToolError(result: unknown): string {
    if (typeof result === 'string' && result.trim().length > 0) {
        return result;
    }

    if (result && typeof result === 'object') {
        const record = result as Record<string, unknown>;
        for (const key of ['error', 'stderr', 'message', 'output']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().length > 0) {
                return value;
            }
        }
    }

    if (result == null) {
        return 'Command failed';
    }

    try {
        return JSON.stringify(result, null, 2);
    } catch {
        return String(result);
    }
}
