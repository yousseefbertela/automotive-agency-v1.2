'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { verifyMetaSignature } = require('../utils/verifyMetaSignature');
const messageRepo = require('../db/message.repo');
const quotesRepo = require('../db/quotes.repo');
const stateRepo = require('../db/state.repo');
const { logInboundEvent } = require('../db/inboundEvent.repo');
const cancellationFlow = require('../domain/cancellation.flow');
const confirmationFlow = require('../domain/confirmation.flow');
const router = express.Router();

/* ────────────────────────────────────────────
   GET /webhooks/waba — Meta webhook verification
   Matches n8n flow: "Whatsapp Response" GET method
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
  res.sendStatus(200);

  const correlationId = uuidv4();
  const log = logger.child(correlationId);

  try {
    const body = req.body;
    if (!body) return;

    try {
      const entry = body.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const msgs = value?.messages;
      const first = msgs?.[0];
      logInboundEvent(
        {
          channel: 'WHATSAPP',
          external_id: first?.id ?? value?.metadata?.phone_number_id?.toString?.() ?? null,
          chat_id: value?.contacts?.[0]?.wa_id ? String(value.contacts[0].wa_id) : '',
          event_type: first?.type ?? (first?.button ? 'interactive' : 'unknown'),
          payload: body,
        },
        correlationId
      ).catch(() => {});
    } catch (_) {}

    if (process.env.META_APP_SECRET && req.rawBody) {
      const sig = req.headers['x-hub-signature-256'];
      if (!verifyMetaSignature(req.rawBody, sig)) {
        log.warn('waba.post: invalid signature');
        return;
      }
    }

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

    const messageDoc = await messageRepo.getMessageDocument(contextId, correlationId);
    if (!messageDoc || !messageDoc.quoteId) {
      log.error('waba.post: message document not found or missing quoteId', { contextId });
      return;
    }

    const quoteId = messageDoc.quoteId;

    const statusValue = buttonPayload === 'تأكيد العمل' ? 'confirmed' : 'cancelled';

    const [, basketItems] = await Promise.all([
      quotesRepo.updateQuoteStatus(quoteId, statusValue, correlationId),
      quotesRepo.getBasketItems(quoteId, correlationId),
    ]);

    const quote = await quotesRepo.getQuote(quoteId, correlationId);
    if (!quote) {
      log.error('waba.post: quote not found', { quoteId });
      return;
    }

    const chatId = quote.chat_id;
    const [session] = await Promise.all([
      stateRepo.getSession(chatId, correlationId),
      quotesRepo.closeQuote(quoteId, correlationId),
    ]);

    if (!session) {
      log.error('waba.post: session not found', { chatId });
      return;
    }

    const tenant = await stateRepo.getTenant(session.tenant_id, correlationId);
    const tenantName = tenant?.name || '';

    const telegramChatId = session._id;
    const ctx = {
      recipientPhone,
      quote,
      basketItems: basketItems || [],
      tenant,
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

function trimPayload(payload, maxSize = 50000) {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (str.length <= maxSize) return payload;
  return { _trimmed: true, length: str.length, preview: str.slice(0, 500) };
}

module.exports = router;
