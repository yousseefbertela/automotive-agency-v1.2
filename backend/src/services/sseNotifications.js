'use strict';

/**
 * SSE Notification Service
 *
 * Architecture:
 *  - Frontend connects via GET /api/chat/events?session_id=xxx
 *  - Backend registers the SSE response object keyed by session_id
 *  - When a WA event fires, we push to the agent session linked to that tenant
 *  - Fallback: if no active SSE connection, store in PendingNotification table
 */

const { getPrisma } = require('./prisma.service');
const logger = require('../utils/logger');

// In-memory registry: session_id → { res, tenantId, lastPing }
const connections = new Map();

// Heartbeat interval
const HEARTBEAT_MS = 30000;

let heartbeatInterval = null;

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, conn] of connections.entries()) {
      try {
        conn.res.write(': heartbeat\n\n');
        conn.lastPing = now;
      } catch {
        connections.delete(sessionId);
      }
    }
  }, HEARTBEAT_MS);
  if (heartbeatInterval.unref) heartbeatInterval.unref();
}

/**
 * Register an SSE connection for a session.
 * Sends required SSE headers and upserts SessionLink in DB.
 */
async function subscribe(sessionId, tenantId, res, correlationId) {
  const log = logger.child(correlationId);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders?.();

  // Send initial connected event
  sendEvent(res, 'connected', { session_id: sessionId });

  // Register
  connections.set(sessionId, { res, tenantId, lastPing: Date.now() });
  log.info('sseNotifications.subscribe', { sessionId, tenantId, active: connections.size });

  // Upsert SessionLink so we can find agent session by tenant
  if (tenantId) {
    try {
      const prisma = getPrisma();
      // Delete old links for this session (re-register)
      await prisma.sessionLink.deleteMany({ where: { agent_session_id: sessionId } });
      await prisma.sessionLink.create({
        data: { tenant_id: tenantId, agent_session_id: sessionId, last_seen: new Date() },
      });
    } catch (err) {
      log.warn('sseNotifications.subscribe: DB upsert failed', { error: err.message });
    }
  }

  startHeartbeat();

  // Handle client disconnect
  res.on('close', () => {
    unsubscribe(sessionId, correlationId);
  });
}

/**
 * Unregister an SSE connection.
 */
function unsubscribe(sessionId, correlationId) {
  const log = logger.child(correlationId);
  connections.delete(sessionId);
  log.info('sseNotifications.unsubscribe', { sessionId, active: connections.size });
}

/**
 * Push an event to a specific session.
 * Falls back to PendingNotification if session not connected.
 */
async function push(sessionId, eventType, data, tenantId, correlationId) {
  const log = logger.child(correlationId);
  const conn = connections.get(sessionId);
  if (conn) {
    try {
      sendEvent(conn.res, eventType, data);
      log.info('sseNotifications.push: sent', { sessionId, eventType });
      return true;
    } catch (err) {
      log.warn('sseNotifications.push: write failed, falling back to DB', { sessionId, error: err.message });
      connections.delete(sessionId);
    }
  }
  // Fallback: store in DB
  await storePendingNotification(tenantId || conn?.tenantId, eventType, data, correlationId);
  return false;
}

/**
 * Push an event to the most recent active Frontend session for a tenant.
 * Falls back to PendingNotification.
 */
async function pushToTenant(tenantId, eventType, data, correlationId) {
  const log = logger.child(correlationId);
  if (!tenantId) {
    log.warn('sseNotifications.pushToTenant: no tenantId');
    return false;
  }

  // Find active connection for this tenant
  let targetSessionId = null;
  for (const [sessionId, conn] of connections.entries()) {
    if (conn.tenantId === tenantId) {
      targetSessionId = sessionId;
      break;
    }
  }

  if (targetSessionId) {
    return push(targetSessionId, eventType, data, tenantId, correlationId);
  }

  // Try DB SessionLink (most recent, last 2 hours)
  try {
    const prisma = getPrisma();
    const link = await prisma.sessionLink.findFirst({
      where: {
        tenant_id: tenantId,
        last_seen: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { last_seen: 'desc' },
    });
    if (link && connections.has(link.agent_session_id)) {
      return push(link.agent_session_id, eventType, data, tenantId, correlationId);
    }
  } catch (err) {
    log.warn('sseNotifications.pushToTenant: DB lookup failed', { error: err.message });
  }

  // Final fallback: store as pending notification
  await storePendingNotification(tenantId, eventType, data, correlationId);
  return false;
}

/**
 * Get and mark-delivered pending notifications for a session/tenant.
 */
async function getPendingNotifications(tenantId, correlationId) {
  const log = logger.child(correlationId);
  if (!tenantId) return [];
  try {
    const prisma = getPrisma();
    const notifications = await prisma.pendingNotification.findMany({
      where: { tenant_id: tenantId, delivered: false },
      orderBy: { created_at: 'asc' },
    });
    if (notifications.length > 0) {
      await prisma.pendingNotification.updateMany({
        where: { id: { in: notifications.map(n => n.id) } },
        data: { delivered: true },
      });
      log.info('sseNotifications.getPendingNotifications: delivered', { count: notifications.length });
    }
    return notifications.map(n => ({ type: n.event_type, data: n.data }));
  } catch (err) {
    log.warn('sseNotifications.getPendingNotifications: failed', { error: err.message });
    return [];
  }
}

// --- Internal helpers ---

function sendEvent(res, eventType, data) {
  const payload = JSON.stringify(data);
  res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
}

async function storePendingNotification(tenantId, eventType, data, correlationId) {
  const log = logger.child(correlationId);
  if (!tenantId) return;
  try {
    const prisma = getPrisma();
    await prisma.pendingNotification.create({
      data: { tenant_id: tenantId, event_type: eventType, data },
    });
    log.info('sseNotifications.storePendingNotification', { tenantId, eventType });
  } catch (err) {
    log.warn('sseNotifications.storePendingNotification: failed', { error: err.message });
  }
}

module.exports = {
  subscribe,
  unsubscribe,
  push,
  pushToTenant,
  getPendingNotifications,
};
