'use strict';

const logger = require('../utils/logger');
const { ScenarioNotFoundError } = require('../utils/errors');
const trace = require('../services/trace.service');

/**
 * Route a parsed AI output item to the correct domain flow.
 * Matches the n8n Switch node on "scenario".
 *
 * Valid scenarios: vin, part, kit, finalize, unrecognized
 */
function routeScenario(item) {
  const scenario = (item.scenario || '').toLowerCase().trim();
  let result;
  switch (scenario) {
    case 'vin':          result = 'vin';          break;
    case 'part':         result = 'part';         break;
    case 'kit':          result = 'kit';          break;
    case 'finalize':     result = 'finalize';     break;
    case 'unrecognized': result = 'unrecognized'; break;
    default:             result = 'unrecognized'; break;
  }

  // Fire-and-forget trace step (synchronous function — use setImmediate to not block)
  const ctx = trace.current();
  if (ctx) {
    setImmediate(() => {
      trace.step('route_decision', async () => result, {
        domain:     'routing',
        input:      { scenario: item.scenario, vin: item.vin, part_name: item.part_name },
        replaySafe: true,
      }).catch(() => {});
    });
  }

  return result;
}

/**
 * Normalize a VIN — replicated exactly from the n8n "get_vehicle_info" tool code.
 *
 * Steps:
 * 1. Uppercase, remove non-alphanum, replace O→0, I→1, Q→0
 * 2. Match 17-char VIN first, then 7-char
 * 3. If 17-char, take last 7
 */
function normalizeVin(inputText) {
  if (!inputText || typeof inputText !== 'string') return null;

  const cleanedInput = inputText
    .toUpperCase()
    .replace(/[\W_]/g, '')
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/Q/g, '0');

  // Try 17-character VIN first
  const match17 = cleanedInput.match(/[A-HJ-NPR-Z0-9]{17}/);
  // If not found, try 7-character VIN
  const match7 = cleanedInput.match(/[A-HJ-NPR-Z0-9]{7}/);

  let extractedVin = null;
  if (match17) {
    extractedVin = match17[0];
  } else if (match7) {
    extractedVin = match7[0];
  }

  if (!extractedVin) return null;

  // Normalize to last 7
  if (extractedVin.length === 17) {
    return extractedVin.slice(-7);
  } else if (extractedVin.length === 7) {
    return extractedVin;
  }
  return null;
}

module.exports = { routeScenario, normalizeVin };
