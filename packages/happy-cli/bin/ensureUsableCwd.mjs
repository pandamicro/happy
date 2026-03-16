import { accessSync, constants, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';

function isUsableDirectory(candidate) {
  if (!candidate) {
    return false;
  }

  try {
    const stats = statSync(candidate);
    if (!stats.isDirectory()) {
      return false;
    }

    accessSync(candidate, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function ensureUsableCwd() {
  try {
    return {
      cwd: process.cwd(),
      recovered: false,
    };
  } catch (error) {
    const originalError = error;
    const candidates = [
      process.env.PWD,
      process.env.INIT_CWD,
      homedir(),
      tmpdir(),
      '/',
    ];
    const seen = new Set();

    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);

      if (!isUsableDirectory(candidate)) {
        continue;
      }

      try {
        process.chdir(candidate);
        process.env.PWD = candidate;
        return {
          cwd: candidate,
          recovered: true,
          originalError,
        };
      } catch {
        // Try the next fallback.
      }
    }

    throw originalError;
  }
}
