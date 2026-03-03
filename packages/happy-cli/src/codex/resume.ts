import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

export type ResumeHistoryEntry = {
    role: 'user' | 'assistant';
    text: string;
};

type ResumeChannelStats = {
    userCount: number;
    assistantCount: number;
    totalChars: number;
};

function getCodexSessionsRootDir(codexHomeDir?: string): string {
    const home = codexHomeDir || process.env.CODEX_HOME || join(os.homedir(), '.codex');
    return join(home, 'sessions');
}

function getHappyLogsRootDir(happyHomeDir?: string): string {
    const home = happyHomeDir || process.env.HAPPY_HOME_DIR || join(os.homedir(), '.happy');
    return join(home, 'logs');
}

function collectFilesRecursive(dir: string, acc: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFilesRecursive(fullPath, acc);
            continue;
        }
        if (entry.isFile()) {
            acc.push(fullPath);
        }
    }

    return acc;
}

function sortByMtimeDesc(paths: string[]): string[] {
    return paths.sort((a, b) => {
        const aMtime = fs.statSync(a).mtimeMs;
        const bMtime = fs.statSync(b).mtimeMs;
        return bMtime - aMtime;
    });
}

function normalizeHistoryText(input: string, maxCharsPerEntry: number): string {
    const normalized = input.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return '';
    }
    if (!Number.isFinite(maxCharsPerEntry) || maxCharsPerEntry <= 0) {
        return normalized;
    }
    if (normalized.length <= maxCharsPerEntry) {
        return normalized;
    }
    return `${normalized.slice(0, maxCharsPerEntry)}\n...[truncated]`;
}

function extractMessageTextFromContent(content: unknown): string {
    if (!Array.isArray(content)) {
        return '';
    }

    const chunks: string[] = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') {
            continue;
        }
        const candidate = part as { type?: unknown; text?: unknown };
        const type = candidate.type;
        const text = candidate.text;
        if (
            (type === 'input_text' || type === 'output_text' || type === 'text')
            && typeof text === 'string'
            && text.trim().length > 0
        ) {
            chunks.push(text);
        }
    }

    return chunks.join('\n').trim();
}

function parseJsonLine(rawLine: string): unknown | null {
    try {
        return JSON.parse(rawLine);
    } catch {
        // Some recorded tool outputs can include unescaped control characters.
        // Strip them and retry so history recovery is best-effort.
        const sanitized = rawLine.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
        if (sanitized === rawLine) {
            return null;
        }
        try {
            return JSON.parse(sanitized);
        } catch {
            return null;
        }
    }
}

function getResumeChannelStats(entries: ResumeHistoryEntry[]): ResumeChannelStats {
    const stats: ResumeChannelStats = {
        userCount: 0,
        assistantCount: 0,
        totalChars: 0,
    };

    for (const entry of entries) {
        if (entry.role === 'user') {
            stats.userCount++;
        } else if (entry.role === 'assistant') {
            stats.assistantCount++;
        }
        stats.totalChars += entry.text.length;
    }

    return stats;
}

function chooseMostCompleteEntries(
    eventEntries: ResumeHistoryEntry[],
    responseEntries: ResumeHistoryEntry[],
): ResumeHistoryEntry[] {
    const eventStats = getResumeChannelStats(eventEntries);
    const responseStats = getResumeChannelStats(responseEntries);
    const eventHasConversation = eventStats.userCount > 0 && eventStats.assistantCount > 0;
    const responseHasConversation = responseStats.userCount > 0 && responseStats.assistantCount > 0;

    if (eventHasConversation && !responseHasConversation) {
        return eventEntries;
    }
    if (responseHasConversation && !eventHasConversation) {
        return responseEntries;
    }
    if (!eventHasConversation && !responseHasConversation) {
        return responseEntries.length >= eventEntries.length ? responseEntries : eventEntries;
    }

    // Prefer richer channel: more assistant turns, then more user turns, then more entries/characters.
    if (responseStats.assistantCount !== eventStats.assistantCount) {
        return responseStats.assistantCount > eventStats.assistantCount ? responseEntries : eventEntries;
    }
    if (responseStats.userCount !== eventStats.userCount) {
        return responseStats.userCount > eventStats.userCount ? responseEntries : eventEntries;
    }
    if (responseEntries.length !== eventEntries.length) {
        return responseEntries.length > eventEntries.length ? responseEntries : eventEntries;
    }
    if (responseStats.totalChars !== eventStats.totalChars) {
        return responseStats.totalChars > eventStats.totalChars ? responseEntries : eventEntries;
    }

    // Stable tie-breaker: keep event channel behavior if both are equally complete.
    return eventEntries;
}

/**
 * Parse a Codex transcript and extract replayable user/assistant text messages.
 * Used to hydrate Happy-side session history when resuming Codex sessions.
 */
export function loadResumeHistoryEntries(
    resumeFile: string,
    opts?: {
        maxEntries?: number;
        maxCharsPerEntry?: number;
    },
): ResumeHistoryEntry[] {
    const maxEntries = opts?.maxEntries ?? 5_000;
    const maxCharsPerEntry = opts?.maxCharsPerEntry ?? Number.POSITIVE_INFINITY;

    let text: string;
    try {
        text = fs.readFileSync(resumeFile, 'utf8');
    } catch {
        return [];
    }

    const responseEntries: ResumeHistoryEntry[] = [];
    const eventEntries: ResumeHistoryEntry[] = [];
    const pushDeduped = (target: ResumeHistoryEntry[], role: 'user' | 'assistant', text: string) => {
        const last = target[target.length - 1];
        if (last?.role === role && last.text === text) {
            return;
        }
        target.push({ role, text });
    };

    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }

        const obj = parseJsonLine(line);
        if (!obj) {
            continue;
        }

        if (!obj || typeof obj !== 'object') {
            continue;
        }

        const typed = obj as { type?: unknown; payload?: unknown };
        const payload = typed.payload && typeof typed.payload === 'object'
            ? (typed.payload as Record<string, unknown>)
            : null;
        if (!payload) {
            continue;
        }

        // Parse EventMsg channel (user_message / agent_message / task_complete).
        // We decide between event vs response channels after scanning the transcript.
        if (typed.type === 'event_msg') {
            const eventType = payload.type;
            const eventMessage = typeof payload.message === 'string'
                ? payload.message
                : (typeof payload.msg === 'string' ? payload.msg : null);
            if (eventType === 'user_message' && typeof eventMessage === 'string') {
                const normalized = normalizeHistoryText(eventMessage, maxCharsPerEntry);
                if (normalized) {
                    pushDeduped(eventEntries, 'user', normalized);
                }
                continue;
            }
            if (eventType === 'agent_message' && typeof eventMessage === 'string') {
                const normalized = normalizeHistoryText(eventMessage, maxCharsPerEntry);
                if (normalized) {
                    pushDeduped(eventEntries, 'assistant', normalized);
                }
                continue;
            }
            if (eventType === 'task_complete' && typeof payload.last_agent_message === 'string') {
                const normalized = normalizeHistoryText(payload.last_agent_message, maxCharsPerEntry);
                if (normalized) {
                    pushDeduped(eventEntries, 'assistant', normalized);
                }
                continue;
            }
        }

        if (typed.type !== 'response_item') {
            continue;
        }
        if (payload.type !== 'message') {
            continue;
        }

        const role = payload.role === 'user' || payload.role === 'assistant'
            ? payload.role
            : null;
        if (!role) {
            continue;
        }

        const rawText = extractMessageTextFromContent(payload.content);
        if (!rawText) {
            continue;
        }

        const normalized = normalizeHistoryText(rawText, maxCharsPerEntry);
        if (!normalized) {
            continue;
        }

        pushDeduped(responseEntries, role, normalized);
    }

    const entries = chooseMostCompleteEntries(eventEntries, responseEntries);

    if (entries.length <= maxEntries) {
        return entries;
    }
    return entries.slice(entries.length - maxEntries);
}

export function findCodexResumeFileBySessionId(sessionId: string, codexHomeDir?: string): string | null {
    const rootDir = getCodexSessionsRootDir(codexHomeDir);
    const candidates = collectFilesRecursive(rootDir)
        .filter((fullPath) => fullPath.endsWith('.jsonl'))
        .filter((fullPath) => fullPath.endsWith(`-${sessionId}.jsonl`));

    if (candidates.length === 0) {
        return null;
    }

    return sortByMtimeDesc(candidates)[0] || null;
}

export function findLatestCodexResumeFile(codexHomeDir?: string): string | null {
    const rootDir = getCodexSessionsRootDir(codexHomeDir);
    const candidates = collectFilesRecursive(rootDir).filter((fullPath) => fullPath.endsWith('.jsonl'));

    if (candidates.length === 0) {
        return null;
    }

    return sortByMtimeDesc(candidates)[0] || null;
}

/**
 * Resolve a Happy session id (cmm...) to the underlying Codex session id
 * by scanning local Happy CLI logs.
 */
export function findCodexSessionIdForHappySessionId(
    happySessionId: string,
    happyHomeDir?: string,
    codexHomeDir?: string,
): string | null {
    const logsRootDir = getHappyLogsRootDir(happyHomeDir);
    const allLogFiles = collectFilesRecursive(logsRootDir)
        .filter((fullPath) => fullPath.endsWith('.log'));

    if (allLogFiles.length === 0) {
        return null;
    }

    // Keep a bounded window, then process from oldest to newest to preserve session chronology.
    const recentLogFiles = sortByMtimeDesc(allLogFiles).slice(0, 200);
    const logFiles = [...recentLogFiles].reverse();
    const orderedCodexSessionIds: string[] = [];
    const seenSessionIds = new Set<string>();

    for (const logFile of logFiles) {
        let text: string;
        try {
            text = fs.readFileSync(logFile, 'utf8');
        } catch {
            continue;
        }

        if (!text.includes(`Session created/loaded: ${happySessionId}`)) {
            continue;
        }

        const lines = text.split(/\r?\n/);
        let activeTargetSession = false;

        for (const line of lines) {
            if (line.includes(`Session created/loaded: ${happySessionId}`)) {
                activeTargetSession = true;
                continue;
            }

            // Another Happy session starts in the same log; stop collecting until target session appears again.
            if (line.includes('Session created/loaded: ')) {
                activeTargetSession = false;
                continue;
            }

            if (!activeTargetSession) {
                continue;
            }

            const codexExtracted = line.match(
                /Session ID extracted from event:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
            );
            if (codexExtracted?.[1]) {
                if (!seenSessionIds.has(codexExtracted[1])) {
                    seenSessionIds.add(codexExtracted[1]);
                    orderedCodexSessionIds.push(codexExtracted[1]);
                }
                continue;
            }

            const codexSessionConfigured = line.match(
                /"type":"session_configured".*?"session_id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
            );
            if (codexSessionConfigured?.[1]) {
                if (!seenSessionIds.has(codexSessionConfigured[1])) {
                    seenSessionIds.add(codexSessionConfigured[1]);
                    orderedCodexSessionIds.push(codexSessionConfigured[1]);
                }
                continue;
            }
        }
    }

    if (orderedCodexSessionIds.length === 0) {
        return null;
    }

    // Pick the most complete local transcript among all Codex sessions belonging to the Happy session.
    // Heuristic: larger transcript file size indicates richer recoverable context.
    let bestSessionId: string | null = null;
    let bestTranscriptSize = -1;
    let bestTranscriptMtime = -1;

    for (const codexSessionId of orderedCodexSessionIds) {
        const resumeFile = findCodexResumeFileBySessionId(codexSessionId, codexHomeDir);
        if (!resumeFile) {
            continue;
        }

        let stats: fs.Stats;
        try {
            stats = fs.statSync(resumeFile);
        } catch {
            continue;
        }

        const size = stats.size;
        const mtime = stats.mtimeMs;
        if (
            size > bestTranscriptSize
            || (size === bestTranscriptSize && mtime > bestTranscriptMtime)
        ) {
            bestSessionId = codexSessionId;
            bestTranscriptSize = size;
            bestTranscriptMtime = mtime;
        }
    }

    if (bestSessionId) {
        return bestSessionId;
    }

    // Fallback when transcripts cannot be found locally: return the newest observed Codex session id.
    return orderedCodexSessionIds[orderedCodexSessionIds.length - 1] || null;
}
