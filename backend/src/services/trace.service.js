'use strict';

/**
 * Execution Tracer — Internal Engineering Debugger
 *
 * Architecture:
 *  - AsyncLocalStorage: zero-signature-change context propagation through the
 *    entire async call tree rooted at processUserMessage.
 *  - All DB writes are fire-and-forget (.catch(() => {})) — never blocks main flow.
 *  - All errors inside the tracer are swallowed — the tracer NEVER throws.
 *  - If traceRunId is null (DB unavailable), every operation is a no-op.
 *  - Secrets are stripped recursively; payloads > 10 KB are truncated.
 */

const { AsyncLocalStorage } = require('async_hooks');
const { getPrisma } = require('./prisma.service');
const { pushToTenant } = require('./sseNotifications');
const logger = require('../utils/logger');

// ── Module-level singletons ──────────────────────────────────────────────────

const als = new AsyncLocalStorage();

const TRACE_RETENTION_DAYS = parseInt(process.env.TRACE_RETENTION_DAYS || '30', 10);

// ── Secret sanitization ──────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'api_key', 'apikey',
  'authorization', 'access_token', 'refresh_token',
  'private_key', 'client_secret', 'odoo_password',
]);

function safeSanitize(obj, depth = 0) {
  if (depth > 10 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => safeSanitize(item, depth + 1));
  }
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.has(lk) ||
      [...SENSITIVE_KEYS].some(s => lk.includes(s));
    result[k] = isSensitive ? '[REDACTED]' : safeSanitize(v, depth + 1);
  }
  return result;
}

// ── Payload truncation ───────────────────────────────────────────────────────

function safeTruncate(obj, maxBytes = 10240) {
  if (obj === null || obj === undefined) return obj;
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length <= maxBytes) return obj;
    return {
      _truncated: true,
      preview: serialized.slice(0, 300) + '...',
      originalSize: serialized.length,
    };
  } catch {
    return { _truncated: true, preview: '[unserializable]', originalSize: -1 };
  }
}

function preparePayload(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    return safeTruncate(safeSanitize(raw));
  } catch {
    return { _error: 'payload_preparation_failed' };
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function _persistEvent(ctx, eventData) {
  if (!ctx || !ctx.traceRunId) return;
  try {
    const prisma = getPrisma();
    await prisma.traceEvent.create({
      data: {
        trace_run_id: ctx.traceRunId,
        sequence:     eventData.sequence,
        step_name:    eventData.stepName,
        domain:       eventData.domain,
        duration_ms:  eventData.durationMs,
        status:       eventData.status,
        replay_safe:  eventData.replaySafe,
        input_json:   eventData.input   ?? undefined,
        output_json:  eventData.output  ?? undefined,
        error_json:   eventData.error   ?? undefined,
      },
    });
  } catch (err) {
    if (ctx.log) ctx.log.warn('trace._persistEvent: DB write failed',
      { stepName: eventData.stepName, error: err.message });
  }
}

async function _pushTraceEvent(ctx, payload) {
  if (!ctx || !ctx.tenantId) return;
  try {
    await pushToTenant(ctx.tenantId, 'trace_event', payload, ctx.correlationId);
  } catch {
    // SSE push is best-effort — never propagate errors
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new TraceRun in the DB and return a context object.
 * Idempotent: upserts on correlation_id.
 */
async function startRun(sessionId, chatId, tenantId, correlationId) {
  const effectiveSession = sessionId || chatId;
  const ctx = {
    traceRunId:    null,
    sessionId:     effectiveSession,
    chatId,
    tenantId:      tenantId || null,
    correlationId,
    sequence:      0,
    log:           logger.child ? logger.child(correlationId) : logger,
  };

  try {
    const prisma = getPrisma();
    const run = await prisma.traceRun.upsert({
      where:  { correlation_id: correlationId },
      update: {},  // already exists (race condition) — leave it
      create: {
        session_id:     effectiveSession,
        chat_id:        chatId,
        tenant_id:      tenantId || null,
        correlation_id: correlationId,
        status:         'RUNNING',
      },
    });
    ctx.traceRunId = run.id;
    ctx.log.info && ctx.log.info('trace.startRun', { traceRunId: run.id, chatId });
  } catch (err) {
    // DB unavailable — ctx.traceRunId stays null; all operations become no-ops
    logger.warn('trace.startRun: DB failed, tracing disabled for this run',
      { error: err.message, correlationId });
  }

  return ctx;
}

/**
 * Bind a TraceContext to an async execution tree.
 * Must wrap the entire body of processUserMessage.
 *
 * Usage:
 *   const ctx = await trace.startRun(...);
 *   return trace.bindRun(ctx, async () => { ... main body ... });
 */
function bindRun(ctx, asyncFn) {
  return als.run(ctx, asyncFn);
}

/**
 * Get the current TraceContext from AsyncLocalStorage.
 * Returns null when called outside a bindRun() context.
 */
function current() {
  return als.getStore() || null;
}

/**
 * Execute fn() as a named trace step.
 * - Records duration, input, output, or error to DB (fire-and-forget).
 * - Pushes SSE trace_event (fire-and-forget).
 * - Re-throws errors from fn() — never swallows application errors.
 * - Never throws itself.
 *
 * @param {string}   stepName
 * @param {Function} fn           async function to execute
 * @param {object}   [options]
 * @param {string}   [options.domain='general']
 * @param {*}        [options.input=null]    data to capture as input_json
 * @param {boolean}  [options.replaySafe=false]
 */
async function step(stepName, fn, options = {}) {
  const ctx = current();

  // No active trace context — just run fn transparently
  if (!ctx || !ctx.traceRunId) {
    return fn();
  }

  const { domain = 'general', input = null, replaySafe = false } = options;

  ctx.sequence += 1;
  const seq = ctx.sequence;
  const startTime = Date.now();

  let result;
  let thrownError = null;

  try {
    result = await fn();
  } catch (err) {
    thrownError = err;
  }

  const durationMs = Date.now() - startTime;
  const stepStatus = thrownError ? 'error' : 'success';

  const errorData = thrownError
    ? {
        message: thrownError.message,
        name:    thrownError.name,
        code:    thrownError.code || undefined,
        stack:   thrownError.stack
          ? thrownError.stack.split('\n').slice(0, 8).join('\n')
          : undefined,
      }
    : null;

  // Fire-and-forget DB persist
  _persistEvent(ctx, {
    sequence:   seq,
    stepName,
    domain,
    durationMs,
    status:     stepStatus,
    replaySafe,
    input:      preparePayload(input),
    output:     stepStatus === 'success' ? preparePayload(result) : null,
    error:      errorData ? preparePayload(errorData) : null,
  }).catch(() => {});

  // Fire-and-forget SSE push (lightweight — no full payloads)
  _pushTraceEvent(ctx, {
    trace_run_id:  ctx.traceRunId,
    sequence:      seq,
    step_name:     stepName,
    domain,
    duration_ms:   durationMs,
    status:        stepStatus,
    replay_safe:   replaySafe,
    input_preview: input != null
      ? JSON.stringify(input).slice(0, 200)
      : null,
    error_preview: errorData ? errorData.message : null,
  }).catch(() => {});

  if (thrownError) {
    throw thrownError;  // re-throw original error
  }

  return result;
}

/**
 * Explicitly capture an error that occurred outside a step() call.
 * Used in the catch block of processUserMessage.
 */
async function captureError(stepName, err, options = {}) {
  const ctx = current();
  if (!ctx || !ctx.traceRunId) return;

  const { domain = 'general', input = null } = options;
  ctx.sequence += 1;

  const errorData = {
    message: err.message,
    name:    err.name,
    code:    err.code || undefined,
    stack:   err.stack
      ? err.stack.split('\n').slice(0, 8).join('\n')
      : undefined,
  };

  await _persistEvent(ctx, {
    sequence:   ctx.sequence,
    stepName,
    domain,
    durationMs: 0,
    status:     'error',
    replaySafe: false,
    input:      preparePayload(input),
    output:     null,
    error:      preparePayload(errorData),
  }).catch(() => {});
}

/**
 * Finalize the TraceRun with a terminal status.
 * Called from the finally block of processUserMessage via a `finalized` flag
 * so it is invoked exactly once per run.
 *
 * @param {'SUCCESS'|'ERROR'} status
 */
async function endRun(status = 'SUCCESS') {
  const ctx = current();
  if (!ctx || !ctx.traceRunId) return;

  try {
    const prisma = getPrisma();
    await prisma.traceRun.update({
      where: { id: ctx.traceRunId },
      data:  { ended_at: new Date(), status },
    });
    ctx.log.info && ctx.log.info('trace.endRun', { traceRunId: ctx.traceRunId, status });
  } catch (err) {
    if (ctx.log) ctx.log.warn('trace.endRun: DB update failed', { error: err.message });
  }
}

/**
 * Delete TraceRuns older than TRACE_RETENTION_DAYS.
 * Cascade deletes all associated TraceEvents automatically.
 * Called once on server startup.
 */
async function cleanupOldTraces() {
  const cutoff = new Date(Date.now() - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const prisma = getPrisma();
    const { count } = await prisma.traceRun.deleteMany({
      where: { started_at: { lt: cutoff } },
    });
    if (count > 0) {
      logger.info('trace.cleanupOldTraces: pruned old traces',
        { count, cutoff: cutoff.toISOString(), retentionDays: TRACE_RETENTION_DAYS });
    }
  } catch (err) {
    logger.warn('trace.cleanupOldTraces: failed', { error: err.message });
  }
}

module.exports = {
  // Core API
  startRun,
  bindRun,
  current,
  step,
  captureError,
  endRun,
  cleanupOldTraces,
  // Exported for test-trace.js
  safeSanitize,
  safeTruncate,
};
