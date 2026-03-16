#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { ensureUsableCwd } from './ensureUsableCwd.mjs';

const cwdState = ensureUsableCwd();
if (cwdState.recovered) {
  console.error(`happy: current working directory was unavailable, using ${cwdState.cwd}`);
}

// Check if we're already running with the flags
const hasNoWarnings = process.execArgv.includes('--no-warnings');
const hasNoDeprecation = process.execArgv.includes('--no-deprecation');

if (!hasNoWarnings || !hasNoDeprecation) {
  // Get path to the actual CLI entrypoint
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const entrypoint = join(projectRoot, 'dist', 'index.mjs');
  
  // Execute the actual CLI directly with the correct flags
  try {
    execFileSync(process.execPath, [
      '--no-warnings',
      '--no-deprecation',
      entrypoint,
      ...process.argv.slice(2)
    ], {
      stdio: 'inherit',
      env: process.env
    });
  } catch (error) {
    // execFileSync throws if the process exits with non-zero
    process.exit(error.status || 1);
  }
} else {
  // We're running Node with the flags we wanted, import the CLI entrypoint
  // module to avoid creating a new process.
  import("../dist/index.mjs");
}
