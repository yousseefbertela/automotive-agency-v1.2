'use strict';

const { google } = require('googleapis');
const logger = require('../utils/logger');

let _sheets = null;

async function getSheetsClient() {
  if (_sheets) return _sheets;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let auth;
  if (json && json.trim()) {
    try {
      const credentials = typeof json === 'string' ? JSON.parse(json) : json;
      auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
    } catch (e) {
      logger.warn('sheets: invalid GOOGLE_SERVICE_ACCOUNT_JSON, falling back to file path');
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
    }
  } else {
    auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

/**
 * Read all rows from a sheet and return as array of objects.
 * First row is treated as header.
 */
async function getAllRows(spreadsheetId, sheetName, correlationId) {
  const log = logger.child(correlationId);
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
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
  } catch (err) {
    log.error('sheets.getAllRows failed', { spreadsheetId, error: err.message });
    return [];
  }
}

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
