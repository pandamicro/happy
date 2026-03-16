/**
 * Suggestion file search functionality using ripgrep for fast file discovery
 * Provides fuzzy search capabilities with in-memory caching for autocomplete suggestions
 */

import Fuse from 'fuse.js';
import { sessionRipgrep } from './ops';
import { AsyncLock } from '@/utils/lock';
import { storage } from './storage';
import type { SessionRipgrepResponse } from './ops';

export interface FileItem {
    fileName: string;
    filePath: string;
    fullPath: string;
    fileType: 'file' | 'folder';
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

interface SessionCache {
    files: FileItem[];
    fuse: Fuse<FileItem> | null;
    lastRefresh: number;
    refreshLock: AsyncLock;
    cwd?: string;
}

class FileSearchCache {
    private sessions = new Map<string, SessionCache>();
    private cacheTimeout = 5 * 60 * 1000; // 5 minutes
    private ripgrepTimeoutMs = 8000;

    private getOrCreateSessionCache(sessionId: string): SessionCache {
        let cache = this.sessions.get(sessionId);
        if (!cache) {
            cache = {
                files: [],
                fuse: null,
                lastRefresh: 0,
                refreshLock: new AsyncLock(),
                cwd: undefined
            };
            this.sessions.set(sessionId, cache);
        }
        return cache;
    }

    private getSessionCwd(sessionId: string): string | undefined {
        const state = storage.getState();
        const path = state.sessions[sessionId]?.metadata?.path?.trim();
        return path && path.length > 0 ? path : undefined;
    }

    private async ripgrepWithTimeout(
        sessionId: string,
        args: string[],
        cwd: string | undefined
    ): Promise<SessionRipgrepResponse> {
        return await new Promise<SessionRipgrepResponse>((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    success: false,
                    error: `ripgrep request timed out after ${this.ripgrepTimeoutMs}ms`
                });
            }, this.ripgrepTimeoutMs);

            sessionRipgrep(sessionId, args, cwd)
                .then((result) => {
                    clearTimeout(timeout);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeout);
                    resolve({
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                });
        });
    }

    private initializeFuse(cache: SessionCache) {
        if (cache.files.length === 0) {
            cache.fuse = null;
            return;
        }

        const fuseOptions = {
            keys: [
                { name: 'fileName', weight: 0.7 },  // Higher weight for file/directory name
                { name: 'fullPath', weight: 0.3 }   // Lower weight for full path
            ],
            threshold: 0.3,
            includeScore: true,
            shouldSort: true,
            minMatchCharLength: 1,
            ignoreLocation: true,
            useExtendedSearch: true,
            // Allow fuzzy matching on slashes for directories
            distance: 100
        };

        cache.fuse = new Fuse(cache.files, fuseOptions);
    }

    private async ensureCacheValid(sessionId: string): Promise<void> {
        const cache = this.getOrCreateSessionCache(sessionId);
        const now = Date.now();
        const currentCwd = this.getSessionCwd(sessionId);
        
        // Check if cache needs refresh
        if (
            now - cache.lastRefresh <= this.cacheTimeout &&
            cache.files.length > 0 &&
            cache.cwd === currentCwd
        ) {
            return; // Cache is still valid
        }

        // Use lock to prevent concurrent refreshes for this session
        await cache.refreshLock.inLock(async () => {
            // Double-check after acquiring lock
            const currentTime = Date.now();
            const lockedCwd = this.getSessionCwd(sessionId);
            if (currentTime - cache.lastRefresh < 1000 && cache.cwd === lockedCwd) { // Skip if refreshed within last second
                return;
            }

            console.log(`FileSearchCache: Refreshing file cache for session ${sessionId}...`);

            // Use ripgrep to get all files in the project
            let response = await this.ripgrepWithTimeout(
                sessionId,
                ['--files', '--follow'],
                lockedCwd
            );

            // Fallback to process cwd if explicit session cwd fails.
            if ((!response.success || !response.stdout) && lockedCwd) {
                response = await this.ripgrepWithTimeout(
                    sessionId,
                    ['--files', '--follow'],
                    undefined
                );
            }

            if (!response.success || !response.stdout) {
                console.error('FileSearchCache: Failed to fetch files', response.error);
                console.log(response);
                return;
            }

            if (response.stdoutTruncated) {
                console.warn(
                    `FileSearchCache: ripgrep result truncated (${response.stdoutReturnedBytes}/${response.stdoutOriginalBytes} bytes); suggestions may be partial`
                );
            }

            // Parse the output into file items
            const filePaths = response.stdout
                .split('\n')
                .map(path => path.trim())
                .filter(path => path.length > 0)
                .filter(path => !path.startsWith('Using system ripgrep:'))
                .filter(path => !path.startsWith('Using packaged ripgrep binary'));

            // Clear existing files
            cache.files = [];

            // Add all files
            filePaths.forEach(path => {
                const parts = path.split('/');
                const fileName = parts[parts.length - 1] || path;
                const filePath = parts.slice(0, -1).join('/') || '';

                cache.files.push({
                    fileName,
                    filePath: filePath ? filePath + '/' : '',
                    fullPath: path,
                    fileType: 'file' as const
                });
            });

            // Add unique directories with trailing slash
            const directories = new Set<string>();
            filePaths.forEach(path => {
                const parts = path.split('/');
                for (let i = 1; i <= parts.length - 1; i++) {
                    const dirPath = parts.slice(0, i).join('/');
                    if (dirPath) {
                        directories.add(dirPath);
                    }
                }
            });

            directories.forEach(dirPath => {
                const parts = dirPath.split('/');
                const dirName = parts[parts.length - 1] + '/';  // Add trailing slash to directory name
                const parentPath = parts.slice(0, -1).join('/');

                cache.files.push({
                    fileName: dirName,
                    filePath: parentPath ? parentPath + '/' : '',
                    fullPath: dirPath + '/',  // Add trailing slash to full path
                    fileType: 'folder'
                });
            });

            cache.lastRefresh = Date.now();
            cache.cwd = lockedCwd;
            this.initializeFuse(cache);

            console.log(`FileSearchCache: Cached ${cache.files.length} files and directories for session ${sessionId}`);
        });
    }

    async search(sessionId: string, query: string, options: SearchOptions = {}): Promise<FileItem[]> {
        await this.ensureCacheValid(sessionId);
        const cache = this.getOrCreateSessionCache(sessionId);

        if (!cache.fuse || cache.files.length === 0) {
            return [];
        }

        const { limit = 10, threshold = 0.3 } = options;

        // If query is empty, return most recently modified files
        if (!query || query.trim().length === 0) {
            return cache.files.slice(0, limit);
        }

        // Perform fuzzy search
        const searchOptions = {
            limit,
            threshold
        };

        const results = cache.fuse.search(query, searchOptions);
        return results.map(result => result.item);
    }

    getAllFiles(sessionId: string): FileItem[] {
        const cache = this.sessions.get(sessionId);
        return cache ? [...cache.files] : [];
    }

    clearCache(sessionId?: string): void {
        if (sessionId) {
            this.sessions.delete(sessionId);
        } else {
            this.sessions.clear();
        }
    }
}

// Export singleton instance
export const fileSearchCache = new FileSearchCache();

// Main export: search files with fuzzy matching
export async function searchFiles(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): Promise<FileItem[]> {
    return fileSearchCache.search(sessionId, query, options);
}
