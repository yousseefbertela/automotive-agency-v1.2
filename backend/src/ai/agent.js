'use strict';

const OpenAI = require('openai');
const { AGENT_SYSTEM_PROMPT, PART_CATEGORIZATION_PROMPT, EVALUATE_RESULTS_PROMPT, KIT_MATCHING_SYSTEM_PROMPT, PART_GROUP_SELECTION_PROMPT, MAIN_GROUPS } = require('./prompts');
const { parseFirstJson } = require('./parseFirstJson');
const logger = require('../utils/logger');
const integrationLog = require('../services/integrationLog.service');
const trace = require('../services/trace.service');

async function withOpenAILog(operation, fn, correlationId) {
  const start = Date.now();
  return trace.step(`ai_openai_${operation}`, async () => {
    try {
      const result = await fn();
      integrationLog.logCall(
        { service: 'OPENAI', operation, status: 'SUCCESS', duration_ms: Date.now() - start },
        correlationId
      ).catch(() => {});
      return result;
    } catch (err) {
      integrationLog.logCall(
        { service: 'OPENAI', operation, status: 'ERROR', duration_ms: Date.now() - start, response_meta: { error: err.message } },
        correlationId
      ).catch(() => {});
      throw err;
    }
  }, { domain: 'ai', input: { operation }, replaySafe: true });
}

let _openai = null;

function getClient() {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Main AI agent: classify user message and extract structured fields.
 * Returns array of items: { scenario, vin, part_name[], human_text }
 */
async function classifyMessage(userMessage, conversationHistory = [], correlationId) {
  return withOpenAILog(
    'classifyMessage',
    async () => {
      const log = logger.child(correlationId);
      log.info('ai.classifyMessage', { userMessage: userMessage.slice(0, 200) });
      const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        ...conversationHistory.slice(-10),
        { role: 'user', content: userMessage },
      ];
      const completion = await getClient().chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 2000,
      });
      const rawOutput = completion.choices[0]?.message?.content || '';
      log.debug('ai.classifyMessage raw output', { rawOutput: rawOutput.slice(0, 500) });
      const items = parseFirstJson(rawOutput);
      log.info('ai.classifyMessage parsed', { itemCount: items.length });
      return items;
    },
    correlationId
  );
}

/**
 * Resolve which Main Group a part belongs to (for find-part scraper).
 * Uses hardcoded MAIN_GROUPS list. Returns exactly one group name.
 */
async function resolvePartGroup(partName, correlationId) {
  return withOpenAILog(
    'resolvePartGroup',
    async () => {
      const log = logger.child(correlationId);
      log.info('ai.resolvePartGroup', { partName });
      const completion = await getClient().chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: PART_GROUP_SELECTION_PROMPT },
          { role: 'user', content: partName },
        ],
        temperature: 0.1,
        max_tokens: 150,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(raw);
        const group = parsed.group && String(parsed.group).trim();
        if (group && MAIN_GROUPS.includes(group)) {
          log.info('ai.resolvePartGroup: resolved', { group });
          return group;
        }
        const fallback = MAIN_GROUPS[0];
        log.warn('ai.resolvePartGroup: invalid group, using fallback', { returned: group, fallback });
        return fallback;
      } catch {
        log.warn('ai.resolvePartGroup: parse failed', { raw });
        return MAIN_GROUPS[0];
      }
    },
    correlationId
  );
}

/**
 * Categorize a part using LLM — used when alias map doesn't have the part.
 * Returns: { main_group, other_groups[], technical_name, likely_aliases[] }
 */
async function categorizePart(partName, correlationId) {
  return withOpenAILog(
    'categorizePart',
    async () => {
      const log = logger.child(correlationId);
      log.info('ai.categorizePart', { partName });
      const completion = await getClient().chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: PART_CATEGORIZATION_PROMPT },
          { role: 'user', content: partName },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      try {
        return JSON.parse(raw);
      } catch {
        log.warn('ai.categorizePart: failed to parse response', { raw });
        return { main_group: 'UNKNOWN', other_groups: [], technical_name: null, likely_aliases: [] };
      }
    },
    correlationId
  );
}

/**
 * Evaluate scraper results (tie-breaker) — when top two scores are too close.
 * Returns the chosen part object or {}.
 */
async function evaluateScraperResults(targetKeyword, bestMatch, secondMatch, correlationId) {
  return withOpenAILog(
    'evaluateScraperResults',
    async () => {
      const log = logger.child(correlationId);
      log.info('ai.evaluateScraperResults', { targetKeyword });
      const userContent = `Target Keyword: ${targetKeyword}

---
Option A:
${JSON.stringify(bestMatch, null, 2)}

---
Option B:
${JSON.stringify(secondMatch, null, 2)}
---

Please analyze these two options and return *only* the JSON object of the single best match.
and must add diagram url dont forget`;
      const completion = await getClient().chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: EVALUATE_RESULTS_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      try {
        return JSON.parse(raw);
      } catch {
        log.warn('ai.evaluateScraperResults: failed to parse', { raw });
        return {};
      }
    },
    correlationId
  );
}

/**
 * Kit matching — match user input against kits database.
 * Returns: { matched, kit_code, kit_name_ar, kit_name_en, confidence, parts_array, clarify_message, suggestions }
 */
async function matchKit(userInput, kitsJson, correlationId) {
  return withOpenAILog(
    'matchKit',
    async () => {
      const log = logger.child(correlationId);
      log.info('ai.matchKit', { userInput });
      const userContent = `User input:\n${userInput}\n\nKits JSON:\n${JSON.stringify(kitsJson)}`;
      const completion = await getClient().chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: KIT_MATCHING_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      log.debug('ai.matchKit raw', { raw: raw.slice(0, 500) });
      try {
        let parsed = JSON.parse(raw);
        if (parsed.output && typeof parsed.output === 'string') {
          parsed = JSON.parse(parsed.output);
        }
        return {
          matched: Boolean(parsed.matched),
          kit_code: String(parsed.kit_code || ''),
          kit_name_ar: String(parsed.kit_name_ar || ''),
          kit_name_en: String(parsed.kit_name_en || ''),
          confidence: ['high', 'medium', 'low'].includes(String(parsed.confidence).toLowerCase())
            ? String(parsed.confidence).toLowerCase()
            : 'low',
          parts_array: Array.isArray(parsed.parts_array) ? parsed.parts_array.map(String) : [],
          clarify_message: String(parsed.clarify_message || ''),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
        };
      } catch {
        log.warn('ai.matchKit: failed to parse response', { raw });
        return {
          matched: false, kit_code: '', kit_name_ar: '', kit_name_en: '',
          confidence: 'low', parts_array: [],
          clarify_message: 'مفيش رد واضح من النظام، حاول تاني.',
          suggestions: [],
        };
      }
    },
    correlationId
  );
}

module.exports = { classifyMessage, resolvePartGroup, categorizePart, evaluateScraperResults, matchKit };
