'use strict';

const scraper = require('../integrations/scraper.client');
const sheets = require('../integrations/sheets.client');
const catalogRepo = require('../db/catalog.repo');
const quotesRepo = require('../db/quotes.repo');
const stateRepo = require('../db/state.repo');
const ai = require('../ai/agent');
const { setPendingAction, PENDING_ACTIONS } = require('../services/stateMachine');
const logger = require('../utils/logger');

/* ─── Scoring helpers (unchanged from original) ──────────────────────────── */

function getLevenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

function getTokenSetRatio(a, b) {
  if (!a || !b) return 0;
  const A = new Set(a.split(/\s+/));
  const B = new Set(b.split(/\s+/));
  const inter = [...A].filter((x) => B.has(x));
  const union = new Set([...A, ...B]);
  return union.size === 0 ? 0 : (inter.length / union.size) * 100;
}

function porterStem(w) { return w.replace(/(ing|ed|s)$/i, ''); }
function stemSentence(s) { return s.toLowerCase().split(/\s+/).map(porterStem).join(' '); }

function scoreParts(query, subgroups) {
  const queryStemmed = stemSentence(query.toLowerCase());
  const uniqueParts = new Map();
  for (const subgroup of subgroups) {
    if (!Array.isArray(subgroup.parts)) continue;
    const diagramUrl = subgroup.diagram_image ?? null;
    for (const part of subgroup.parts) {
      if (!part.description || !part.part_number) continue;
      const desc = part.description.toLowerCase();
      const descStemmed = stemSentence(desc);
      const maxLen = Math.max(query.length, desc.length);
      if (!maxLen) continue;
      const leven = (maxLen - getLevenshtein(query.toLowerCase(), desc)) / maxLen;
      const fuzzy = getTokenSetRatio(query.toLowerCase(), desc) / 100;
      const lemma = getTokenSetRatio(queryStemmed, descStemmed) / 100;
      const score = 0.6 * fuzzy + 0.25 * lemma + 0.15 * leven;
      const existing = uniqueParts.get(part.part_number);
      if (!existing || score > existing.score) {
        uniqueParts.set(part.part_number, {
          part_number: part.part_number, description: part.description,
          score, original_part: part, diagram_url: diagramUrl,
        });
      }
    }
  }
  const ranked = [...uniqueParts.values()].sort((a, b) => b.score - a.score);
  return { best_match: ranked[0] ?? { score: 0 }, second_match: ranked[1] ?? { score: 0 } };
}

/* ─── Public: handlePart ─────────────────────────────────────────────────── */

/**
 * Entry point. Validates quote exists, then processes first part name.
 * Remaining parts passed down as payload so resume handler can chain them.
 */
async function handlePart(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  const partNames = item.part_name || [];

  if (!partNames.length) {
    await s.sendMessage('من فضلك حدد قطعة الغيار المطلوبة.');
    return;
  }

  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
  if (!quote) { await s.sendMessage('مفيش عرض سعر مفتوح.\nابعت الـ VIN.'); return; }

  const vin = quote.vin || state.vin;
  if (!vin) { await s.sendMessage('مفيش VIN محفوظ. ابعت الـ VIN الأول.'); return; }

  log.info('part.flow: start', { chatId, partNames, vin, quoteId: quote._id });

  // Process first part; remaining passed as payload so resume handler chains them
  await processOnePart(chatId, partNames[0], vin, quote, state, correlationId, s, partNames.slice(1));
}

/**
 * Core: scrape, score, and set CONFIRM_PART_MATCH wait state.
 * @param {string[]} remainingParts - parts to process after this one is confirmed
 */
async function processOnePart(chatId, partName, vin, quote, state, correlationId, sender, remainingParts) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  log.info('part.flow.processOnePart', { partName, remainingParts });

  // Step 1: Hot Items
  const hotItem = await sheets.lookupHotItem(partName, correlationId).catch(() => null);
  let chosenPart = null;

  if (hotItem && hotItem['Item Desc']) {
    try {
      const groupName = await ai.resolvePartGroup(partName, correlationId);
      const res = await scraper.findPart(vin, partName, correlationId, groupName);
      if (res && res.part_number) chosenPart = res;
    } catch (err) { log.warn('part.flow: hot-item find-part failed', { error: err.message }); }
  }

  if (!chosenPart) {
    // Step 2: Alias map or LLM categorize
    const aliasResult = await sheets.lookupAliasMap(partName, correlationId).catch(() => null);
    let mainGroup = null, otherGroups = [], mainKeyword = partName;

    if (aliasResult && aliasResult['Main Group']) {
      mainGroup = aliasResult['Main Group'];
      mainKeyword = aliasResult['Main Keyword'] || partName;
      otherGroups = (aliasResult['Other Main Groups'] || '').split(',').map(s => s.trim()).filter(Boolean);
    } else {
      const cat = await ai.categorizePart(partName, correlationId);
      mainGroup = cat.main_group || 'UNKNOWN';
      otherGroups = cat.other_groups || [];
      mainKeyword = cat.technical_name || partName;
    }

    const allGroups = [...new Set([mainGroup, ...otherGroups].filter(Boolean))];
    let allSubgroups = [];
    const typeCode = quote.vehicle_details?.type_code || '';

    for (const group of allGroups) {
      let cachedResults = [];
      try { cachedResults = await catalogRepo.queryCatalogResults(group, typeCode, correlationId); } catch {}

      if (cachedResults.length > 0) {
        for (const c of cachedResults) { if (c.subgroups) allSubgroups.push(...c.subgroups); }
      } else {
        try {
          const subgroupsList = await scraper.getSubgroups(vin, group, correlationId);
          const subgroupNames = subgroupsList?.subgroups || [];
          const collected = [];
          for (const sgName of Array.isArray(subgroupNames) ? subgroupNames : []) {
            const sgId = typeof sgName === 'string' ? sgName : (sgName?.name ?? sgName?.subgroup ?? String(sgName));
            try {
              const sgData = await scraper.querySubgroup(vin, group, sgId, correlationId);
              if (sgData) collected.push(sgData);
            } catch {}
          }
          if (!collected.length) {
            try {
              const gData = await scraper.queryGroup(vin, group, correlationId);
              if (gData?.subgroups?.length) collected.push(...gData.subgroups);
            } catch {}
          }
          if (collected.length) {
            allSubgroups.push(...collected);
            await catalogRepo.saveCatalogResult({
              type_code: typeCode, series: quote.vehicle_details?.series || null,
              model: quote.vehicle_details?.model || null, engine: quote.vehicle_details?.engine || null,
              group_name: group,
              subgroups: collected.map(sg => ({
                subgroup: sg.subgroup ?? null, diagram_image: sg.diagram_image ?? null,
                parts: Array.isArray(sg.parts) ? sg.parts.map(p => ({
                  item_no: p.item_no || null, description: p.description || null,
                  part_number: p.part_number || null, price: p.price || null,
                })) : [],
              })),
            }, correlationId).catch(() => {});
          }
        } catch (err) { log.warn('part.flow: scraper failed', { group, error: err.message }); }
      }
    }

    if (!allSubgroups.length) {
      await s.sendMessage(`مش لاقي نتايج للقطعة "${partName}". جرب اسم تاني.`);
      return;
    }

    const { best_match, second_match } = scoreParts(mainKeyword, allSubgroups);
    if (!best_match || best_match.score === 0) {
      await s.sendMessage(`مش لاقي نتايج للقطعة "${partName}". جرب اسم تاني.`);
      return;
    }

    const earlyExit = best_match.score >= 0.88 && (best_match.score - (second_match?.score || 0)) >= 0.08;
    if (earlyExit) {
      chosenPart = best_match;
    } else {
      const evaluated = await ai.evaluateScraperResults(mainKeyword, best_match, second_match, correlationId);
      chosenPart = (evaluated && evaluated.part_number) ? evaluated : best_match;
    }
  }

  if (!chosenPart || !chosenPart.part_number) {
    await s.sendMessage(`تمام، آسف جداً. مش لاقي القطعة "${partName}". جرب اسم تاني.`);
    return;
  }

  // Send diagram if available
  const diagramUrl = chosenPart.diagram_url || chosenPart.original_part?.diagram_url;
  if (diagramUrl) {
    try {
      const img = await scraper.downloadDiagramImage(diagramUrl, correlationId);
      if (img) await s.sendPhotoBuffer(img.data, `Diagram: ${chosenPart.description || partName}`);
    } catch {}
  }

  // Build confirmation message
  const partDesc = chosenPart.description || partName;
  const partNumber = chosenPart.part_number || '';
  const itemNo = chosenPart.original_part?.item_no || '';
  const confirmMsg = [
    'لقيت القطعة دي:',
    '',
    `*القطعة:* ${partDesc}`,
    `*رقم القطعة:* ${partNumber}`,
    itemNo ? `*رقم الصنف:* ${itemNo}` : '',
    '',
    'هل دي القطعة المطلوبة؟ (نعم / لا)',
  ].filter(Boolean).join('\n');

  await s.sendMessage(confirmMsg);

  // Set CONFIRM_PART_MATCH wait — do NOT auto-proceed to basket
  await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_PART_MATCH, {
    best_match: chosenPart,
    second_match: second_match || null,
    quote_id: quote._id,
    part_name: partName,
    vin: vin,
    remaining_parts: remainingParts || [],
    tenant_id: state.tenant_id,
  }, 60, correlationId);

  log.info('part.flow: waiting for part confirmation', { partNumber, remaining: (remainingParts || []).length });
}

module.exports = { handlePart, processOnePart, scoreParts, getLevenshtein, getTokenSetRatio, stemSentence };
