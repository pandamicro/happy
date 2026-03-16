import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureUsableCwd } from '../../bin/ensureUsableCwd.mjs';

describe('ensureUsableCwd', () => {
  const originalPwd = process.env.PWD;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PWD = originalPwd;
  });

  it('returns the current cwd when it is available', () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo');
    const chdirSpy = vi.spyOn(process, 'chdir');

    expect(ensureUsableCwd()).toEqual({
      cwd: '/repo',
      recovered: false,
    });
    expect(cwdSpy).toHaveBeenCalledTimes(1);
    expect(chdirSpy).not.toHaveBeenCalled();
  });

  it('falls back to a usable directory when cwd is unavailable', () => {
    const originalError = Object.assign(new Error('EPERM: operation not permitted, uv_cwd'), {
      code: 'EPERM',
    });

    vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw originalError;
    });
    const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
    process.env.PWD = '/Users/screamcart-agent0';

    const result = ensureUsableCwd();

    expect(chdirSpy).toHaveBeenCalledWith('/Users/screamcart-agent0');
    expect(result).toMatchObject({
      cwd: '/Users/screamcart-agent0',
      recovered: true,
      originalError,
    });
    expect(process.env.PWD).toBe('/Users/screamcart-agent0');
  });
});
