'use strict';

const ai = require('../ai/agent');
const logger = require('../utils/logger');
const trace = require('./trace.service');

/**
 * LLM classify with one automatic retry on parse failure, then safe fallback reply.
 * Returns { items, fallbackReply }. If items is non-null use it; else use fallbackReply.
 */
async function classifyWithFallback(userMessage, conversationHistory, correlationId) {
  const log = logger.child(correlationId);

  return trace.step('ai_classify', async () => {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const items = await ai.classifyMessage(userMessage, conversationHistory || [], correlationId);
        if (items && Array.isArray(items) && items.length) {
          return { items, fallbackReply: null };
        }
        lastError = new Error('classifyMessage returned empty or invalid');
      } catch (err) {
        lastError = err;
        log.warn('agentService: classify attempt failed', { attempt, error: err.message });
      }
    }
    const fallbackReply = 'مش فاهم الرسالة. حاول تكتبها بشكل أوضح.';
    return { items: null, fallbackReply };
  }, {
    domain:      'ai',
    input:       {
      userMessage:   typeof userMessage === 'string' ? userMessage.slice(0, 500) : userMessage,
      historyLength: (conversationHistory || []).length,
    },
    replaySafe: true,
  });
}

module.exports = { classifyWithFallback };
