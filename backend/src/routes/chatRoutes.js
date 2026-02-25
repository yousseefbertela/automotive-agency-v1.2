'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const chatService = require('../services/chatService');
const sessionStore = require('../services/sessionStore');
const stateRepo = require('../db/state.repo');
const { getPendingAction, clearPendingAction } = require('../services/stateMachine');
const { subscribe, getPendingNotifications } = require('../services/sseNotifications');
const logger = require('../utils/logger');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ─────────────────────────────────────────────────────────────
   POST /api/chat/message
   Body: { session_id?: string, message: string }
   Returns: { session_id, reply, meta? }
   ───────────────────────────────────────────────────────────── */
router.post('/message', express.json(), async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    const sessionId = req.body?.session_id || null;
    const message = req.body?.message != null ? String(req.body.message) : '';
    const result = await chatService.sendMessage(sessionId, message, correlationId);
    res.json(result);
  } catch (err) {
    log.error('chatRoutes.message error', { error: err.message });
    res.status(500).json({
      session_id: req.body?.session_id || uuidv4(),
      reply: 'عذراً، حصل مشكلة. حاول تاني بعد شوية.',
      meta: { error: err.message },
    });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/chat/photo
   multipart/form-data: file field "photo", optional "session_id"
   Returns: { session_id, ocr_text, reply, meta? }
   ───────────────────────────────────────────────────────────── */
router.post('/photo', upload.single('photo'), async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    const sessionId =
      req.body?.session_id && req.body.session_id !== '' ? req.body.session_id : null;
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({
        session_id: sessionId || uuidv4(),
        ocr_text: '',
        reply: 'No photo uploaded. Send a file with field name "photo".',
        meta: {},
      });
    }
    const result = await chatService.sendPhoto(sessionId, file.buffer, correlationId);
    res.json(result);
  } catch (err) {
    log.error('chatRoutes.photo error', { error: err.message });
    res.status(500).json({
      session_id: req.body?.session_id || uuidv4(),
      ocr_text: '',
      reply: 'عذراً، حصل مشكلة. حاول تاني بعد شوية.',
      meta: { error: err.message },
    });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/chat/events?session_id=xxx&tenant_id=xxx
   Server-Sent Events stream for Frontend agent notifications.
   Headers: text/event-stream (SSE).

   On connect: sends "connected" event with { session_id }.
   On WA button press: server pushes "order_confirmed" / "order_cancelled".
   On finalize: server pushes "quote_sent".
   Heartbeat: ": heartbeat\n\n" every 30 seconds.
   ───────────────────────────────────────────────────────────── */
router.get('/events', async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    let sessionId = req.query.session_id || null;
    const tenantId = req.query.tenant_id || null;

    if (!sessionId) {
      return res.status(400).json({ error: 'session_id query param required' });
    }

    // Ensure the session exists in DB (creates web session if needed)
    const { session_id: chatId } = await sessionStore.getStateForWeb(sessionId, correlationId);
    sessionId = chatId;

    log.info('chatRoutes.events: SSE connect', { sessionId, tenantId });

    // SSE headers + registration
    await subscribe(sessionId, tenantId, res, correlationId);

    // Keep the connection open — the close handler in subscribe() cleans up
  } catch (err) {
    log.error('chatRoutes.events error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/chat/notifications?session_id=xxx
   Poll fallback for when SSE is not connected.
   Returns undelivered PendingNotifications for this session's tenant.
   Marks them delivered.
   ───────────────────────────────────────────────────────────── */
router.get('/notifications', express.json(), async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    const sessionId = req.query.session_id || null;
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id query param required' });
    }

    const { state, session_id: chatId } = await sessionStore.getStateForWeb(sessionId, correlationId);
    const tenantId = state?.tenant_id || null;

    const notifications = await getPendingNotifications(tenantId, correlationId);
    log.info('chatRoutes.notifications: polled', { count: notifications.length });
    res.json({ notifications });
  } catch (err) {
    log.error('chatRoutes.notifications error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/chat/submit-form
   Body: { session_id, action, data: { ...formFields } }

   Handles structured-form submissions from the Frontend:
     • COLLECT_CUSTOMER_DATA  → resume handler (creates quotation)
     • CHOOSE_PRODUCT         → finalize handler (sends WA quote, SSE)

   Returns: { session_id, reply, meta? }
   ───────────────────────────────────────────────────────────── */
router.post('/submit-form', express.json(), async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    const { session_id, action, data: formData } = req.body || {};

    if (!session_id) {
      return res.status(400).json({ error: 'session_id required' });
    }

    const { state, session_id: chatId } = await sessionStore.getStateForWeb(
      session_id,
      correlationId
    );

    if (state._blocked) {
      return res.status(403).json({
        error: 'Session blocked',
        reason: state.reason,
      });
    }

    // Get active pending action
    const pending = await getPendingAction(chatId, correlationId);
    if (!pending) {
      return res.status(400).json({
        error: 'No pending action for this session. Nothing to submit.',
      });
    }

    const effectiveAction = action || pending.action;
    log.info('chatRoutes.submit-form', { chatId, effectiveAction });

    // Collect all agent replies
    const replies = [];
    const sender = {
      sendMessage: (text) => {
        replies.push(String(text));
        return Promise.resolve();
      },
      sendPhotoBuffer: () => Promise.resolve(),
    };

    if (
      effectiveAction === 'CHOOSE_PRODUCT' ||
      pending.action === 'CHOOSE_PRODUCT'
    ) {
      // Lazy require to avoid circular dependency
      const { handleChooseProductSubmit } = require('../domain/finalize.flow');
      await handleChooseProductSubmit(
        chatId,
        formData || {},
        pending.payload,
        correlationId,
        sender
      );
    } else if (
      effectiveAction === 'COLLECT_CUSTOMER_DATA' ||
      pending.action === 'COLLECT_CUSTOMER_DATA'
    ) {
      // Pass form data object directly — resumeCollectCustomerData handles objects
      const { handleResume } = require('../workflows/resumeHandlers');
      await handleResume(
        chatId,
        'COLLECT_CUSTOMER_DATA',
        pending.payload,
        formData || {},   // object — handled by resumeCollectCustomerData
        state,
        sender,
        correlationId
      );
    } else {
      return res.status(400).json({
        error: `Unhandled pending action: ${pending.action}`,
      });
    }

    const reply = replies.join('\n\n');
    res.json({ session_id, reply, meta: {} });
  } catch (err) {
    log.error('chatRoutes.submit-form error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/debug/session/:chatId?key=DEBUG_KEY
   Returns full session state + pending action for debugging.
   Protected by DEBUG_KEY env var.
   ───────────────────────────────────────────────────────────── */
router.get('/debug/session/:chatId', express.json(), async (req, res) => {
  const correlationId = uuidv4();
  try {
    const expectedKey = process.env.DEBUG_KEY;
    if (expectedKey) {
      const providedKey = req.query.key;
      if (providedKey !== expectedKey) {
        return res.status(403).json({ error: 'Forbidden: invalid DEBUG_KEY' });
      }
    }

    const { chatId } = req.params;
    const [state, session, pending] = await Promise.all([
      stateRepo.getState(chatId, correlationId),
      stateRepo.getSession(chatId, correlationId),
      getPendingAction(chatId, correlationId),
    ]);

    res.json({
      chat_id: chatId,
      session,
      state,
      pending_action: pending,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
