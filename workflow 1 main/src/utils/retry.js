'use strict';

const logger = require('./logger');

/**
 * Retry a function with exponential back-off.
 * @param {Function} fn        - async function to retry
 * @param {object}   opts
 * @param {number}   opts.retries     - max retries (default 3)
 * @param {number}   opts.baseDelay   - starting delay ms (default 1000)
 * @param {number}   opts.maxDelay    - cap delay ms (default 10000)
 * @param {number}   opts.timeout     - per-attempt timeout ms (default 30000)
 * @param {string}   opts.label       - label for logging
 * @param {string}   opts.correlationId
 */
async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    timeout = 30000,
    label = 'operation',
    correlationId,
  } = opts;

  const log = correlationId ? logger.child(correlationId) : logger;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
      ]);
      return result;
    } catch (err) {
      if (attempt > retries) {
        log.error(`${label}: all ${retries + 1} attempts failed`, {
          error: err.message,
        });
        throw err;
      }
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      log.warn(`${label}: attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: err.message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
