'use strict';

const { withRetry } = require('../src/utils/retry');

describe('withRetry', () => {
  test('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelay: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, { retries: 3, baseDelay: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws after all retries exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry(fn, { retries: 2, baseDelay: 10, timeout: 5000 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
