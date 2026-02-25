'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const chatService = require('../services/chatService');
const logger = require('../utils/logger');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * POST /api/chat/message
 * Body: { session_id?: string, message: string }
 * Returns: { session_id, reply, meta? }
 */
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

/**
 * POST /api/chat/photo
 * multipart/form-data: file field "photo", optional text field "session_id"
 * Returns: { session_id, ocr_text, reply, meta? }
 */
router.post('/photo', upload.single('photo'), async (req, res) => {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);
  try {
    const sessionId = req.body?.session_id || req.body?.session_id === '' ? req.body.session_id : null;
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

module.exports = router;
