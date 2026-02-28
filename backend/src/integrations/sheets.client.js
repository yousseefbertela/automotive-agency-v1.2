'use strict';

const { google } = require('googleapis');
const logger = require('../utils/logger');
const trace = require('../services/trace.service');

let _sheets = null;

/**
 * Build a Google Sheets v4 client.
 *
 * Priority:
 *  1. GOOGLE_SERVICE_ACCOUNT_JSON — full service-account JSON string (private sheets)
 *  2. GOOGLE_SHEETS_API_KEY       — plain API key (public/shared sheets, no service account needed)
 *  3. Application Default Credentials (ADC) — local gcloud auth or GCP-managed identity
 */
async function getSheetsClient() {
  if (_sheets) return _sheets;

  // Option 1: Service Account JSON (works for private & public sheets)
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson && saJson.trim()) {
    try {
      const credentials = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
      _sheets = google.sheets({ version: 'v4', auth });
      return _sheets;
    } catch (e) {
      logger.warn('sheets: GOOGLE_SERVICE_ACCOUNT_JSON parse failed, trying API key / ADC');
    }
  }

  // Option 2: Plain API key (sheets must be publicly shared "Anyone with link can view")
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey && apiKey.trim()) {
    _sheets = google.sheets({ version: 'v4', auth: apiKey });
    return _sheets;
  }

  // Option 3: Application Default Credentials (ADC)
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

// ── Public CSV fallback ───────────────────────────────────────────────────────
// For sheets shared "Anyone with the link can view".
// Uses Node 18+ native fetch — no extra packages needed.

/**
 * Parse a CSV string into an array of header-keyed objects.
 * Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
 */
function _parseCsv(text) {
  // Strip UTF-8 BOM if present
  const cleaned = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  // Tokenise: split on CRLF or LF, respecting quoted fields with embedded newlines
  const rows = [];
  let currentRow = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote inside quoted field
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        // Windows CRLF
        currentRow.push(field);
        rows.push(currentRow);
        currentRow = [];
        field = '';
        i++; // skip \n
      } else if (ch === '\n') {
        currentRow.push(field);
        rows.push(currentRow);
        currentRow = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  // Push the last field/row
  if (field || currentRow.length) {
    currentRow.push(field);
    if (currentRow.some(f => f !== '')) rows.push(currentRow);
  }

  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
}

/**
 * Fetch a publicly shared Google Sheet as CSV (no auth required).
 * URL: https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&sheet={name}
 */
async function _fetchPublicCsv(spreadsheetId, sheetName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'PartPilot/1.0' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Public CSV fetch HTTP ${response.status} for sheet "${sheetName}" ` +
      `(spreadsheetId=${spreadsheetId})`
    );
  }

  const text = await response.text();
  return _parseCsv(text);
}

// ── Core data accessor ────────────────────────────────────────────────────────

/**
 * Read all rows from a sheet and return as array of objects.
 * First row is treated as header.
 *
 * Auth waterfall:
 *   googleapis (service-account / API key / ADC)
 *     → on auth failure: public CSV export (no credentials needed)
 */
async function getAllRows(spreadsheetId, sheetName, correlationId) {
  const log = logger.child ? logger.child(correlationId) : logger;

  return trace.step('sheets_getAllRows', async () => {
    // ── Attempt 1: googleapis (handles private + authenticated public sheets) ──
    try {
      const sheets = await getSheetsClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName,
      });
      const rows = res.data.values;
      if (!rows || rows.length < 2) return [];
      const headers = rows[0];
      return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });
    } catch (apiErr) {
      // Detect credential / auth failures and try the zero-config CSV fallback
      const isAuthErr = /credentials|Could not load|unauthorized|401|invalid_grant|UNAUTHENTICATED/i
        .test(apiErr.message || '');

      if (isAuthErr) {
        // Reset the cached client so the next call re-attempts auth properly
        _sheets = null;
        log.warn('sheets.getAllRows: API auth error — falling back to public CSV export', {
          spreadsheetId,
          sheetName,
          error: apiErr.message,
        });

        // ── Attempt 2: public CSV export (works for "Anyone with link" sheets) ─
        try {
          const rows = await _fetchPublicCsv(spreadsheetId, sheetName);
          log.info('sheets.getAllRows: public CSV fallback succeeded', {
            spreadsheetId,
            sheetName,
            rowCount: rows.length,
          });
          return rows;
        } catch (csvErr) {
          log.error('sheets.getAllRows: public CSV fallback also failed', {
            spreadsheetId,
            sheetName,
            error: csvErr.message,
          });
          return [];
        }
      }

      // Non-auth error (network, quota, bad range, etc.)
      log.error('sheets.getAllRows failed', { spreadsheetId, sheetName, error: apiErr.message });
      return [];
    }
  }, { domain: 'sheets', input: { spreadsheetId, sheetName }, replaySafe: true }).catch((err) => {
    log.error('sheets.getAllRows trace.step failed', { error: err.message });
    return [];
  });
}

// ── Domain-level helpers ──────────────────────────────────────────────────────

/**
 * Check Hot Items sheet — lookup by "Item Desc" column.
 * Returns first matching row or null.
 */
async function lookupHotItem(partName, correlationId) {
  const spreadsheetId = process.env.SHEETS_HOT_ITEMS_SPREADSHEET_ID;
  const sheetName = process.env.SHEETS_HOT_ITEMS_SHEET_NAME || 'Sheet1';
  if (!spreadsheetId) {
    logger.child(correlationId).warn('SHEETS_HOT_ITEMS_SPREADSHEET_ID not configured');
    return null;
  }
  const rows = await getAllRows(spreadsheetId, sheetName, correlationId);
  const match = rows.find(
    (r) => (r['Item Desc'] || '').toLowerCase().trim() === partName.toLowerCase().trim()
  );
  return match || null;
}

/**
 * Search Alias Map sheet — lookup by "Aliases" column (comma-separated).
 * Returns matched row or null.
 */
async function lookupAliasMap(partName, correlationId) {
  const spreadsheetId = process.env.SHEETS_ALIAS_MAP_SPREADSHEET_ID;
  const sheetName = process.env.SHEETS_ALIAS_MAP_SHEET_NAME || 'Sheet1';
  if (!spreadsheetId) {
    logger.child(correlationId).warn('SHEETS_ALIAS_MAP_SPREADSHEET_ID not configured');
    return null;
  }
  const rows = await getAllRows(spreadsheetId, sheetName, correlationId);
  const query = partName.toLowerCase().trim();

  for (const row of rows) {
    const mainKeyword = (row['Main Keyword'] || '').trim();
    const aliasString = row['Aliases'] || '';
    const aliasList = aliasString.split(',').map((s) => s.toLowerCase().trim());

    if (
      mainKeyword.toLowerCase() === query ||
      aliasList.includes(query)
    ) {
      return {
        'Main Keyword': mainKeyword,
        'Main Group': row['Main Group'] || '',
        'Other Main Groups': row['Other Main Groups'] || '',
        Aliases: row['Aliases'] || '',
      };
    }
  }
  return null;
}

/**
 * Get all kit rows from kits sheet.
 */
async function getAllKits(correlationId) {
  const spreadsheetId = process.env.SHEETS_KITS_SPREADSHEET_ID;
  const sheetName = process.env.SHEETS_KITS_SHEET_NAME || 'Sheet1';
  if (!spreadsheetId) {
    logger.child(correlationId).warn('SHEETS_KITS_SPREADSHEET_ID not configured');
    return [];
  }
  const rows = await getAllRows(spreadsheetId, sheetName, correlationId);
  return rows
    .filter((r) => r.kit_code || r.kit_name_ar || r.kit_name_en)
    .map((r) => ({
      kit_code: r.kit_code || '',
      kit_name_ar: r.kit_name_ar || '',
      kit_name_en: r.kit_name_en || '',
      aliases: r.aliases || '',
      category: r.category || '',
      parts_list: r.parts_list || '',
      notes: r.notes || '',
    }));
}

module.exports = { getAllRows, lookupHotItem, lookupAliasMap, getAllKits };
