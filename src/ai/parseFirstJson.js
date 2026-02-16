'use strict';

/**
 * Robust JSON extraction from LLM output.
 * Handles code fences, extra text around JSON, double-escaped strings.
 * Returns a parsed JS value (object or array).
 */
function stripCodeFences(s) {
  return s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();
}

/**
 * Extract the first balanced JSON object or array from a text blob.
 */
function extractFirstJson(text) {
  const s = stripCodeFences(String(text || '')).trim();

  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  if (startObj === -1 && startArr === -1) return '';

  const start =
    startArr !== -1 && (startObj === -1 || startArr < startObj)
      ? startArr
      : startObj;
  const openChar = s[start];
  const closeChar = openChar === '[' ? ']' : '}';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;

    if (depth === 0) {
      return s.slice(start, i + 1).trim();
    }
  }
  // If we didn't close properly, fallback to full trimmed
  return s;
}

/**
 * Parse the first JSON payload from an LLM output string.
 * Always returns an array of scenario items.
 */
function parseFirstJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('parseFirstJson: input must be a non-empty string');
  }

  const jsonText = extractFirstJson(raw);
  if (!jsonText) {
    throw new Error('parseFirstJson: no JSON found in input');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `parseFirstJson: invalid JSON — ${e.message}\nExtracted:\n${jsonText.slice(0, 500)}`
    );
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];

  return arr.map((obj) => ({
    scenario: String(obj.scenario ?? ''),
    vin: String(obj.vin ?? ''),
    part_name: Array.isArray(obj.part_name) ? obj.part_name.map(String) : [],
    human_text: String(obj.human_text ?? ''),
  }));
}

module.exports = { parseFirstJson, extractFirstJson, stripCodeFences };
