'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function phoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || '804877562714688';
}

function accessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

/**
 * Send a WhatsApp template message.
 * Matches n8n: "send order cancellation" and "send order confirmation" nodes.
 *
 * @param {string} recipientPhone  - e.g. "+201001202986"
 * @param {string} templateStr     - e.g. "partpilot_order_cancelled|en"
 * @param {string[]} bodyParams    - template body parameter values
 * @param {string} correlationId
 */
async function sendTemplate(recipientPhone, templateStr, bodyParams, correlationId) {
  const log = logger.child(correlationId);
  const token = accessToken();

  if (!token) {
    log.warn('whatsapp.sendTemplate: WHATSAPP_ACCESS_TOKEN not set — skipping');
    return { skipped: true };
  }

  // Parse template string "name|language"
  const [templateName, language] = templateStr.split('|');

  const url = `${GRAPH_API}/${phoneNumberId()}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientPhone.replace(/^\+/, ''), // strip leading +
    type: 'template',
    template: {
      name: templateName,
      language: { code: language || 'en' },
      components: [
        {
          type: 'body',
          parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
        },
      ],
    },
  };

  log.info('whatsapp.sendTemplate', {
    to: recipientPhone,
    template: templateName,
    paramCount: bodyParams.length,
  });

  const res = await withRetry(
    () =>
      axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }),
    { retries: 2, label: 'whatsapp.sendTemplate', correlationId }
  );

  log.info('whatsapp.sendTemplate: sent', { messageId: res.data?.messages?.[0]?.id });
  return res.data;
}

/**
 * Send cancellation template.
 * Matches n8n: "send order cancellation"
 * Template: partpilot_order_cancelled|en
 * Params: customer_name, series+model, tenant_name
 */
async function sendCancellationTemplate(recipientPhone, quote, tenantName, correlationId) {
  const template = process.env.WA_TEMPLATE_CANCELLATION || 'partpilot_order_cancelled|en';
  const series = quote.vehicle_details?.series || '';
  const model = quote.vehicle_details?.model || '';
  const params = [
    quote.customer_name || '',
    `${series}${model}`,
    tenantName || '',
  ];
  return sendTemplate(recipientPhone, template, params, correlationId);
}

/**
 * Send confirmation template.
 * Matches n8n: "send order confirmation"
 * Template: partpilot_order_cancelled|en (as per n8n JSON)
 * Params: customer_name, series, total_cost, tenant_name
 */
async function sendConfirmationTemplate(recipientPhone, quote, totalCost, tenantName, correlationId) {
  const template = process.env.WA_TEMPLATE_CONFIRMATION || 'partpilot_order_cancelled|en';
  const series = quote.vehicle_details?.series || '';
  const params = [
    quote.customer_name || '',
    series,
    String(totalCost || 0),
    tenantName || '',
  ];
  return sendTemplate(recipientPhone, template, params, correlationId);
}

module.exports = { sendTemplate, sendCancellationTemplate, sendConfirmationTemplate };
