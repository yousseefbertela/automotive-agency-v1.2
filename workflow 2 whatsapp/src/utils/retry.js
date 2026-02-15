'use strict';

const logger = require('./logger');

/**
 * Retry with exponential back-off.
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
    let timer;
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
        }),
      ]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      if (attempt > retries) {
        log.error(`${label}: all ${retries + 1} attempts failed`, { error: err.message });
        throw err;
      }
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      log.warn(`${label}: attempt ${attempt} failed, retrying in ${delay}ms`, { error: err.message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
