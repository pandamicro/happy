/**
 * Suggestion commands functionality for slash commands
 * Reads commands directly from session metadata storage
 */

import Fuse from 'fuse.js';
import { storage } from './storage';

export interface CommandItem {
    command: string;        // The command without slash (e.g., "compact")
    description?: string;   // Optional description of what the command does
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

// Commands to ignore/filter out
export const IGNORED_COMMANDS = [
    "add-dir",
    "agents",
    "config",
    "statusline",
    "bashes",
    "settings",
    "cost",
    "doctor",
    "exit",
    "help",
    "ide",
    "init",
    "install-github-app",
    "mcp",
    "memory",
    "migrate-installer",
    "model",
    "pr-comments",
    "release-notes",
    "resume",
    "status",
    "bug",
    "review",
    "security-review",
    "terminal-setup",
    "upgrade",
    "vim",
    "permissions",
    "hooks",
    "export",
    "logout",
    "login"
];

// Default commands always available
const DEFAULT_COMMANDS: CommandItem[] = [
    { command: 'compact', description: 'Compact the conversation history' },
    { command: 'clear', description: 'Clear the conversation' }
];

// Codex sessions do not always publish slashCommands metadata.
// Keep a conservative fallback set so `/` suggestions remain useful in WebUI.
const CODEX_FALLBACK_COMMANDS: CommandItem[] = [
    { command: 'agents', description: 'List available agents and skills' },
    { command: 'help', description: 'Show available commands' },
    { command: 'model', description: 'Select the model for this session' },
    { command: 'permissions', description: 'Change the approval policy' },
    { command: 'review', description: 'Review workspace changes' },
    { command: 'status', description: 'Show current session status' }
];

// Command descriptions for known tools/commands
const COMMAND_DESCRIPTIONS: Record<string, string> = {
    // Default commands
    compact: 'Compact the conversation history',
    
    // Common tool commands
    help: 'Show available commands',
    clear: 'Clear the conversation',
    reset: 'Reset the session',
    export: 'Export conversation',
    debug: 'Show debug information',
    status: 'Show connection status',
    stop: 'Stop current operation',
    abort: 'Abort current operation',
    cancel: 'Cancel current operation',
    agents: 'List available agents and skills',
    model: 'Select the model for this session',
    permissions: 'Change the approval policy',
    review: 'Review workspace changes',
    
    // Add more descriptions as needed
};

function dedupeCommands(commands: CommandItem[]): CommandItem[] {
    const deduped: CommandItem[] = [];
    const seen = new Set<string>();
    for (const command of commands) {
        const key = command.command.trim();
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push({
            command: key,
            description: command.description
        });
    }
    return deduped;
}

function getFlavorFallbackCommands(flavor: string | null | undefined): CommandItem[] {
    if (flavor === 'codex') {
        return CODEX_FALLBACK_COMMANDS;
    }
    return [];
}

// Get commands from session metadata
function getCommandsFromSession(sessionId: string): CommandItem[] {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session || !session.metadata) {
        return DEFAULT_COMMANDS;
    }

    const commands: CommandItem[] = dedupeCommands([
        ...DEFAULT_COMMANDS,
        ...getFlavorFallbackCommands(session.metadata.flavor)
    ]);
    
    // Add commands from metadata.slashCommands (filter with ignore list)
    if (session.metadata.slashCommands) {
        for (const cmd of session.metadata.slashCommands) {
            // Skip if in ignore list
            if (IGNORED_COMMANDS.includes(cmd)) continue;
            
            // Check if it's already in default commands
            if (!commands.find(c => c.command === cmd)) {
                commands.push({
                    command: cmd,
                    description: COMMAND_DESCRIPTIONS[cmd]  // Optional description
                });
            }
        }
    }
    
    return dedupeCommands(commands);
}

// Main export: search commands with fuzzy matching
export async function searchCommands(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): Promise<CommandItem[]> {
    const { limit = 10, threshold = 0.3 } = options;
    
    // Get commands from session metadata (no caching)
    const commands = getCommandsFromSession(sessionId);
    
    // If query is empty, return all commands
    if (!query || query.trim().length === 0) {
        return commands.slice(0, limit);
    }
    
    // Setup Fuse for fuzzy search
    const fuseOptions = {
        keys: [
            { name: 'command', weight: 0.7 },
            { name: 'description', weight: 0.3 }
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true
    };
    
    const fuse = new Fuse(commands, fuseOptions);
    const results = fuse.search(query, { limit });
    
    return results.map(result => result.item);
}

// Get all available commands for a session
export function getAllCommands(sessionId: string): CommandItem[] {
    return getCommandsFromSession(sessionId);
}
