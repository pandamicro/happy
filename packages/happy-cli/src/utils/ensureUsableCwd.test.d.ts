declare module '../../bin/ensureUsableCwd.mjs' {
  export function ensureUsableCwd(): {
    cwd: string;
    recovered: boolean;
    originalError?: unknown;
  };
}
