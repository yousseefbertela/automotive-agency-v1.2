'use strict';

/**
 * Debug API Routes — Internal Engineering Debugger
 *
 * GET /api/debug/trace/runs   — list TraceRuns (latest first)
 * GET /api/debug/trace/run/:id — full TraceRun + all TraceEvents
 *
 * Protected by x-debug-api-key header (env: DEBUG_API_KEY).
 * If DEBUG_API_KEY is not set, requests are allowed (dev mode).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

const router = express.Router();

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireDebugKey(req, res, next) {
  const expectedKey = process.env.DEBUG_API_KEY;
  if (!expectedKey) {
    // No key configured — allow access (dev environment)
    return next();
  }
  const provided = req.headers['x-debug-api-key'];
  if (!provided || provided !== expectedKey) {
    return res.status(403).json({ error: 'Forbidden: missing or invalid x-debug-api-key header' });
  }
  next();
}

router.use(requireDebugKey);

// ── GET /api/debug/trace/runs ────────────────────────────────────────────────
// Query params:
//   session_id  — filter by session_id
//   chat_id     — filter by chat_id
//   limit       — max results (default 20, cap 100)
//   offset      — pagination offset (default 0)

router.get('/trace/runs', async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child ? logger.child(correlationId) : logger;
  try {
    const { session_id, chat_id, limit: limitStr, offset: offsetStr } = req.query;
    const limit  = Math.min(parseInt(limitStr  || '20', 10), 100);
    const offset = Math.max(parseInt(offsetStr || '0',  10), 0);

    const where = {};
    if (session_id) where.session_id = session_id;
    if (chat_id)    where.chat_id    = chat_id;

    const prisma = getPrisma();
    const [runs, total] = await Promise.all([
      prisma.traceRun.findMany({
        where,
        orderBy: { started_at: 'desc' },
        take:    limit,
        skip:    offset,
        include: { _count: { select: { events: true } } },
      }),
      prisma.traceRun.count({ where }),
    ]);

    const result = runs.map(r => ({
      id:             r.id,
      session_id:     r.session_id,
      chat_id:        r.chat_id,
      tenant_id:      r.tenant_id,
      correlation_id: r.correlation_id,
      started_at:     r.started_at,
      ended_at:       r.ended_at,
      status:         r.status,
      duration_ms:    r.ended_at
        ? (new Date(r.ended_at) - new Date(r.started_at))
        : null,
      event_count:    r._count.events,
    }));

    res.json({ runs: result, total, limit, offset });
  } catch (err) {
    log.error && log.error('debugRoutes.trace/runs error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/debug/trace/run/:id ─────────────────────────────────────────────
// Returns: { run: TraceRun, events: TraceEvent[] ordered by sequence }

router.get('/trace/run/:id', async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child ? logger.child(correlationId) : logger;
  try {
    const { id } = req.params;
    const prisma = getPrisma();

    const run = await prisma.traceRun.findUnique({
      where:   { id },
      include: { events: { orderBy: { sequence: 'asc' } } },
    });

    if (!run) {
      return res.status(404).json({ error: 'TraceRun not found' });
    }

    res.json({
      run: {
        id:             run.id,
        session_id:     run.session_id,
        chat_id:        run.chat_id,
        tenant_id:      run.tenant_id,
        correlation_id: run.correlation_id,
        started_at:     run.started_at,
        ended_at:       run.ended_at,
        status:         run.status,
        duration_ms:    run.ended_at
          ? (new Date(run.ended_at) - new Date(run.started_at))
          : null,
        event_count: run.events.length,
      },
      events: run.events.map(e => ({
        id:          e.id,
        sequence:    e.sequence,
        step_name:   e.step_name,
        domain:      e.domain,
        timestamp:   e.timestamp,
        duration_ms: e.duration_ms,
        status:      e.status,
        replay_safe: e.replay_safe,
        input_json:  e.input_json,
        output_json: e.output_json,
        error_json:  e.error_json,
      })),
    });
  } catch (err) {
    log.error && log.error('debugRoutes.trace/run/:id error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
