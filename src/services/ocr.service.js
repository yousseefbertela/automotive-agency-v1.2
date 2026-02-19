'use strict';

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const integrationLog = require('./integrationLog.service');

/**
 * Send an image buffer to ocr.space and return the extracted text.
 * Matches the n8n node: POST https://api.ocr.space/parse/image
 *   - OCREngine=2, language=eng, scale=true, detectOrientation=true, filetype=JPG
 *
 * @param {Buffer} imageBuffer
 * @param {string} correlationId
 * @returns {Promise<string>} extracted text
 */
async function extractText(imageBuffer, correlationId) {
  const log = logger.child(correlationId);
  const apiKey = process.env.OCR_SPACE_API_KEY;
  const start = Date.now();

  if (!apiKey) {
    log.warn('OCR_SPACE_API_KEY not set — returning empty string');
    return '';
  }

  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  form.append('OCREngine', '2');
  form.append('language', 'eng');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  form.append('isOverlayRequired', 'false');
  form.append('filetype', 'JPG');

  log.info('ocr.space: sending image for OCR');

  try {
    const res = await withRetry(
      () =>
        axios.post('https://api.ocr.space/parse/image', form, {
          headers: {
            ...form.getHeaders(),
            apikey: apiKey,
          },
          timeout: 30000,
          maxContentLength: 10 * 1024 * 1024,
        }),
      { retries: 2, label: 'ocr.space', correlationId }
    );

    const parsedResults = res.data?.ParsedResults;
    if (!parsedResults || !parsedResults.length) {
      log.warn('ocr.space returned no ParsedResults');
      integrationLog.logCall(
        { service: 'OCR', operation: 'ocr_space', status: 'SUCCESS', duration_ms: Date.now() - start, response_meta: { parsedResultsCount: 0 } },
        correlationId
      ).catch(() => {});
      return '';
    }

    const text = parsedResults[0].ParsedText || '';
    log.info('ocr.space: extracted text', { textLength: text.length });
    integrationLog.logCall(
      { service: 'OCR', operation: 'ocr_space', status: 'SUCCESS', duration_ms: Date.now() - start, response_meta: { textLength: text.length } },
      correlationId
    ).catch(() => {});
    return text.trim();
  } catch (err) {
    integrationLog.logCall(
      { service: 'OCR', operation: 'ocr_space', status: 'ERROR', duration_ms: Date.now() - start, response_meta: { error: err.message } },
      correlationId
    ).catch(() => {});
    throw err;
  }
}

module.exports = { extractText };
