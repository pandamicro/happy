import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    findCodexResumeFileBySessionId,
    findCodexSessionIdForHappySessionId,
    findLatestCodexResumeFile,
    loadResumeHistoryEntries,
} from '../resume';

function writeTranscript(path: string, content: string, mtimeMs: number): void {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content, 'utf8');
    const time = new Date(mtimeMs);
    fs.utimesSync(path, time, time);
}

describe('codex resume utilities', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('returns newest transcript for specific session id', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const sessionsRoot = join(tempHome, 'sessions');
        writeTranscript(
            join(sessionsRoot, '2026', '03', 'old-session-abc123.jsonl'),
            'old',
            Date.now() - 10_000,
        );
        const newestPath = join(sessionsRoot, '2026', '03', 'new-session-abc123.jsonl');
        writeTranscript(newestPath, 'new', Date.now());

        const found = findCodexResumeFileBySessionId('abc123', tempHome);
        expect(found).toBe(newestPath);
    });

    it('returns newest transcript overall for latest resume', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const sessionsRoot = join(tempHome, 'sessions');
        writeTranscript(
            join(sessionsRoot, '2026', '03', 'session-a.jsonl'),
            'first',
            Date.now() - 20_000,
        );
        const newestPath = join(sessionsRoot, '2026', '03', 'session-b.jsonl');
        writeTranscript(newestPath, 'second', Date.now());

        const found = findLatestCodexResumeFile(tempHome);
        expect(found).toBe(newestPath);
    });

    it('returns null when no transcript exists', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        expect(findLatestCodexResumeFile(tempHome)).toBeNull();
        expect(findCodexResumeFileBySessionId('missing', tempHome)).toBeNull();
    });

    it('maps Happy session id to Codex session id from logs', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const logsRoot = join(tempHome, 'logs');
        const logFile = join(logsRoot, '2026-03-02-22-42-38-pid-22997.log');
        fs.mkdirSync(dirname(logFile), { recursive: true });
        fs.writeFileSync(
            logFile,
            [
                '[22:42:40.576] Session created/loaded: cmm9ag0n0cgltyn14i053ooaj (tag: xxx)',
                '[22:42:47.072] [CodexMCP] Session ID extracted from event: 019caf00-6e86-78c1-9a5d-6387e66a0df9',
            ].join('\n'),
            'utf8',
        );

        const found = findCodexSessionIdForHappySessionId('cmm9ag0n0cgltyn14i053ooaj', tempHome);
        expect(found).toBe('019caf00-6e86-78c1-9a5d-6387e66a0df9');
    });

    it('prefers the most complete transcript when a Happy session restarted multiple times', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const logsRoot = join(tempHome, 'logs');
        const logFile = join(logsRoot, '2026-03-02-22-42-38-pid-22997.log');
        const sessionsRoot = join(tempHome, 'sessions');
        fs.mkdirSync(dirname(logFile), { recursive: true });
        fs.writeFileSync(
            logFile,
            [
                '[22:42:40.576] Session created/loaded: cmm9ag0n0cgltyn14i053ooaj (tag: xxx)',
                '[22:42:47.072] [CodexMCP] Session ID extracted from event: 019caf00-6e86-78c1-9a5d-6387e66a0df9',
                '[23:18:25.618] [Codex] MCP message: {"type":"session_configured","session_id":"019caf21-103b-7b71-8e81-8d0c9338dfbe"}',
                '[23:24:22.467] [Codex] MCP message: {"type":"session_configured","session_id":"019caf26-823e-7342-a09d-ed882f0b63ed"}',
            ].join('\n'),
            'utf8',
        );

        // Newest is 019caf26, but 019caf00 has the largest transcript and should be selected.
        writeTranscript(
            join(sessionsRoot, '2026', '03', 'rollout-2026-03-02T22-42-47-019caf00-6e86-78c1-9a5d-6387e66a0df9.jsonl'),
            'x'.repeat(30_000),
            Date.now() - 30_000,
        );
        writeTranscript(
            join(sessionsRoot, '2026', '03', 'rollout-2026-03-02T23-18-25-019caf21-103b-7b71-8e81-8d0c9338dfbe.jsonl'),
            'x'.repeat(10_000),
            Date.now() - 20_000,
        );
        writeTranscript(
            join(sessionsRoot, '2026', '03', 'rollout-2026-03-02T23-24-22-019caf26-823e-7342-a09d-ed882f0b63ed.jsonl'),
            'x'.repeat(15_000),
            Date.now() - 10_000,
        );

        const found = findCodexSessionIdForHappySessionId(
            'cmm9ag0n0cgltyn14i053ooaj',
            tempHome,
            tempHome,
        );
        expect(found).toBe('019caf00-6e86-78c1-9a5d-6387e66a0df9');
    });

    it('falls back to latest observed session id when transcript files are missing', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const logsRoot = join(tempHome, 'logs');
        const logFile = join(logsRoot, '2026-03-02-22-42-38-pid-22997.log');
        fs.mkdirSync(dirname(logFile), { recursive: true });
        fs.writeFileSync(
            logFile,
            [
                '[22:42:40.576] Session created/loaded: cmm9ag0n0cgltyn14i053ooaj (tag: xxx)',
                '[22:42:47.072] [CodexMCP] Session ID extracted from event: 019caf00-6e86-78c1-9a5d-6387e66a0df9',
                '[23:18:25.618] [Codex] MCP message: {"type":"session_configured","session_id":"019caf21-103b-7b71-8e81-8d0c9338dfbe"}',
                '[23:24:22.467] [Codex] MCP message: {"type":"session_configured","session_id":"019caf26-823e-7342-a09d-ed882f0b63ed"}',
            ].join('\n'),
            'utf8',
        );

        const found = findCodexSessionIdForHappySessionId('cmm9ag0n0cgltyn14i053ooaj', tempHome, tempHome);
        expect(found).toBe('019caf26-823e-7342-a09d-ed882f0b63ed');
    });

    it('returns null when Happy session id mapping is missing', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        expect(findCodexSessionIdForHappySessionId('missing-session', tempHome)).toBeNull();
    });

    it('extracts replayable user/assistant text from resume transcript', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const transcript = join(tempHome, 'sessions', '2026', '03', 'rollout-abc.jsonl');
        writeTranscript(
            transcript,
            [
                JSON.stringify({ type: 'session_meta', payload: { id: 'abc' } }),
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: 'hello user' }],
                    },
                }),
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'hello assistant' }],
                    },
                }),
                JSON.stringify({
                    type: 'event_msg',
                    payload: { type: 'user_message', message: 'ignored duplicate channel' },
                }),
            ].join('\n'),
            Date.now(),
        );

        const entries = loadResumeHistoryEntries(transcript);
        expect(entries).toEqual([
            { role: 'user', text: 'hello user' },
            { role: 'assistant', text: 'hello assistant' },
        ]);
    });

    it('prefers full event transcript channel when available', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const transcript = join(tempHome, 'sessions', '2026', '03', 'rollout-abc.jsonl');
        const longAssistant = `assistant-${'x'.repeat(6_000)}`;
        writeTranscript(
            transcript,
            [
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: 'bootstrap user' }],
                    },
                }),
                JSON.stringify({
                    type: 'event_msg',
                    payload: { type: 'user_message', message: 'real user prompt' },
                }),
                JSON.stringify({
                    type: 'event_msg',
                    payload: { type: 'agent_message', message: longAssistant },
                }),
            ].join('\n'),
            Date.now(),
        );

        const entries = loadResumeHistoryEntries(transcript);
        expect(entries).toEqual([
            { role: 'user', text: 'real user prompt' },
            { role: 'assistant', text: longAssistant },
        ]);
        expect(entries[1]?.text.includes('...[truncated]')).toBe(false);
    });

    it('prefers richer response transcript when both channels are usable', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const transcript = join(tempHome, 'sessions', '2026', '03', 'rollout-abc.jsonl');
        writeTranscript(
            transcript,
            [
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: 'bootstrap instructions' }],
                    },
                }),
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: 'real user prompt' }],
                    },
                }),
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'real assistant answer' }],
                    },
                }),
                JSON.stringify({
                    type: 'event_msg',
                    payload: { type: 'user_message', message: 'event user prompt' },
                }),
                JSON.stringify({
                    type: 'event_msg',
                    payload: { type: 'agent_message', message: 'event assistant answer' },
                }),
            ].join('\n'),
            Date.now(),
        );

        const entries = loadResumeHistoryEntries(transcript);
        expect(entries).toEqual([
            { role: 'user', text: 'bootstrap instructions' },
            { role: 'user', text: 'real user prompt' },
            { role: 'assistant', text: 'real assistant answer' },
        ]);
    });

    it('parses lines with unescaped control characters in resume transcript', () => {
        const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'happy-codex-resume-'));
        tempDirs.push(tempHome);

        const transcript = join(tempHome, 'sessions', '2026', '03', 'rollout-abc.jsonl');
        writeTranscript(
            transcript,
            [
                '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello\u0001 world"}]}}',
                JSON.stringify({
                    type: 'response_item',
                    payload: {
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: 'hi back' }],
                    },
                }),
            ].join('\n'),
            Date.now(),
        );

        const entries = loadResumeHistoryEntries(transcript);
        expect(entries).toEqual([
            { role: 'user', text: 'hello world' },
            { role: 'assistant', text: 'hi back' },
        ]);
    });
});
