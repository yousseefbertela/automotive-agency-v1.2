'use strict';

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { verifyMetaSignature } = require('../utils/verifyMetaSignature');
const firestoreService = require('../services/firestore.service');
const cancellationFlow = require('../domain/cancellation.flow');
const confirmationFlow = require('../domain/confirmation.flow');

const router = express.Router();

/* ────────────────────────────────────────────
   GET /webhooks/waba — Meta webhook verification
   Matches n8n: "Whatsapp Response" GET method
   ──────────────────────────────────────────── */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken) {
    logger.info('waba.verify: success');
    return res.status(200).type('text/plain').send(challenge);
  }

  logger.warn('waba.verify: failed', { mode, token });
  return res.sendStatus(403);
});

/* ────────────────────────────────────────────
   POST /webhooks/waba — Incoming WhatsApp events
   Matches n8n: "Whatsapp Response" POST → full pipeline
   ──────────────────────────────────────────── */
router.post('/', async (req, res) => {
  // Always respond 200 immediately (Meta requires fast response)
  res.sendStatus(200);

  const correlationId = uuidv4();
  const log = logger.child(correlationId);

  try {
    const body = req.body;
    if (!body) return;

    // Validate Meta signature if configured
    if (process.env.META_APP_SECRET && req.rawBody) {
      const sig = req.headers['x-hub-signature-256'];
      if (!verifyMetaSignature(req.rawBody, sig)) {
        log.warn('waba.post: invalid signature');
        return;
      }
    }

    // Extract the message from the webhook payload
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || !messages.length) {
      log.debug('waba.post: no messages in payload (likely a status update)');
      return;
    }

    const message = messages[0];
    const buttonPayload = message.button?.payload;
    const contextId = message.context?.id;
    const waId = value.contacts?.[0]?.wa_id;

    if (!buttonPayload || !contextId) {
      log.debug('waba.post: not a button reply or missing context', {
        hasButton: Boolean(buttonPayload),
        hasContext: Boolean(contextId),
      });
      return;
    }

    const recipientPhone = `+${waId}`;

    log.info('waba.post: processing button reply', {
      buttonPayload,
      contextId,
      waId,
    });

    // ── Step 1: Get message document (messages/{context.id}) ──
    const messageDoc = await firestoreService.getMessageDocument(contextId, correlationId);
    if (!messageDoc || !messageDoc.quoteId) {
      log.error('waba.post: message document not found or missing quoteId', { contextId });
      return;
    }

    const quoteId = messageDoc.quoteId;

    // ── Step 2: Parallel — update status + get basket ──
    const statusValue = buttonPayload === 'تأكيد العمل' ? 'confirmed' : 'cancelled';

    const [, basketItems] = await Promise.all([
      firestoreService.updateQuoteStatus(quoteId, statusValue, correlationId),
      firestoreService.getBasketItems(quoteId, correlationId),
    ]);

    // ── Step 3: Get quote ──
    const quote = await firestoreService.getQuote(quoteId, correlationId);
    if (!quote) {
      log.error('waba.post: quote not found', { quoteId });
      return;
    }

    // ── Step 4: Parallel — get session + close quote ──
    const chatId = quote.chat_id;
    const [session] = await Promise.all([
      firestoreService.getSession(chatId, correlationId),
      firestoreService.closeQuote(quoteId, correlationId),
    ]);

    if (!session) {
      log.error('waba.post: session not found', { chatId });
      return;
    }

    // ── Step 5: Get tenant info ──
    const tenant = await firestoreService.getTenant(session.tenant_id, correlationId);
    const tenantName = tenant?.name || '';

    // ── Step 6: Switch on button payload ──
    const telegramChatId = session._id; // session doc ID = chat_id
    const ctx = {
      recipientPhone,
      quote,
      basketItems: basketItems || [],
      tenantName,
      chatId: telegramChatId,
      correlationId,
    };

    if (buttonPayload === 'تعديل / إلغاء') {
      log.info('waba.post: routing to cancellation flow');
      await cancellationFlow.run(ctx);
    } else if (buttonPayload === 'تأكيد العمل') {
      log.info('waba.post: routing to confirmation flow');
      await confirmationFlow.run(ctx);
    } else {
      log.info('waba.post: unknown button payload, ignoring', { buttonPayload });
    }

    log.info('waba.post: complete');
  } catch (err) {
    log.error('waba.post: unhandled error', { error: err.message, stack: err.stack });
  }
});

module.exports = router;
