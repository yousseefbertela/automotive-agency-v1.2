'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');

// Scraper 1: RealOEM (Cloud Run). One base URL used for all three endpoints in n8n.
// Optional per-endpoint overrides if you use different scrapers per call.
const REALOEM_BASE = () =>
  process.env.SCRAPER_BASE_URL ||
  'https://scraper-api-207722784991.europe-west3.run.app';

function urlGetCarDetails(vin) {
  const base =
    process.env.SCRAPER_GET_CAR_DETAILS_URL ||
    `${REALOEM_BASE()}/realoem/get-car-details`;
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(vin)}`;
}
function urlQueryGroup() {
  return process.env.SCRAPER_QUERY_GROUP_URL || `${REALOEM_BASE()}/realoem/query-group/`;
}
function urlFindPart() {
  return process.env.SCRAPER_FIND_PART_URL || `${REALOEM_BASE()}/realoem/find-part`;
}

/**
 * GET /realoem/get-car-details/{vin}
 * Returns: { series, model, body, market, prod_month, engine, type_code, ... }
 */
async function getCarDetails(vin, correlationId) {
  const url = urlGetCarDetails(vin);
  const log = logger.child(correlationId);
  log.info('scraper.getCarDetails', { vin, url });

  const res = await withRetry(
    () => axios.get(url, { timeout: 30000 }),
    { retries: 2, label: 'scraper.getCarDetails', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/query-group/
 * Body: { vin, group }
 * Returns: { subgroups: [{ subgroup, diagram_image, parts: [...] }] }
 */
async function queryGroup(vin, group, correlationId) {
  const url = urlQueryGroup();
  const log = logger.child(correlationId);
  log.info('scraper.queryGroup', { vin, group });

  const res = await withRetry(
    () => axios.post(url, { vin, group }, { timeout: 60000 }),
    { retries: 1, baseDelay: 2000, label: 'scraper.queryGroup', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/find-part
 * Body: { vin, part }
 * Returns: part result object
 */
async function findPart(vin, part, correlationId) {
  const url = urlFindPart();
  const log = logger.child(correlationId);
  log.info('scraper.findPart', { vin, part });

  const res = await withRetry(
    () => axios.post(url, { vin, part }, { timeout: 30000 }),
    { retries: 1, label: 'scraper.findPart', correlationId }
  );
  return res.data;
}

/**
 * Download a diagram image via ScraperAPI proxy.
 * Returns: { data: Buffer, contentType: string }
 */
async function downloadDiagramImage(diagramUrl, correlationId) {
  const apiKey = process.env.SCRAPER_API_COM_KEY;
  if (!apiKey) {
    logger.child(correlationId).warn('SCRAPER_API_COM_KEY not set, skipping diagram download');
    return null;
  }
  const safeUrl = (diagramUrl || '').replace('http://', 'https://');
  const proxyUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(safeUrl)}`;

  const res = await axios.get(proxyUrl, {
    timeout: 30000,
    responseType: 'arraybuffer',
  });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'image/png',
  };
}

module.exports = { getCarDetails, queryGroup, findPart, downloadDiagramImage };
