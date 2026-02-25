'use strict';

const crypto = require('crypto');

/**
 * Verify the X-Hub-Signature-256 header from Meta webhook payloads.
 * Returns true if signature is valid, false otherwise.
 *
 * If META_APP_SECRET is not configured, logs a warning and returns true
 * (allows development without signature validation).
 */
function verifyMetaSignature(rawBody, signatureHeader) {
  const appSecret = process.env.META_APP_SECRET;

  if (!appSecret) {
    return true; // skip validation when not configured
  }

  if (!signatureHeader) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const providedSignature = signatureHeader.replace('sha256=', '');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(providedSignature, 'hex')
  );
}

module.exports = { verifyMetaSignature };
