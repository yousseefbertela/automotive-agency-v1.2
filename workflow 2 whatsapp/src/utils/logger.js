'use strict';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'debug'] ?? 0;

function formatMsg(level, message, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    correlationId: meta.correlationId || undefined,
    msg: message,
    ...Object.fromEntries(
      Object.entries(meta).filter(([k]) => k !== 'correlationId')
    ),
  });
}

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const line = formatMsg(level, message, meta);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function child(correlationId) {
  return {
    debug: (msg, m = {}) => log('debug', msg, { ...m, correlationId }),
    info: (msg, m = {}) => log('info', msg, { ...m, correlationId }),
    warn: (msg, m = {}) => log('warn', msg, { ...m, correlationId }),
    error: (msg, m = {}) => log('error', msg, { ...m, correlationId }),
  };
}

module.exports = {
  debug: (msg, m) => log('debug', msg, m),
  info: (msg, m) => log('info', msg, m),
  warn: (msg, m) => log('warn', msg, m),
  error: (msg, m) => log('error', msg, m),
  child,
};
