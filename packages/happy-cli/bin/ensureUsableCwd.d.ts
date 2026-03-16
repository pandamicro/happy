export function ensureUsableCwd(): {
  cwd: string;
  recovered: boolean;
  originalError?: unknown;
};
