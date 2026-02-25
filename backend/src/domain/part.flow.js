'use strict';

const scraper = require('../integrations/scraper.client');
const odoo = require('../services/odoo.service');
const sheets = require('../integrations/sheets.client');
const catalogRepo = require('../db/catalog.repo');
const quotesRepo = require('../db/quotes.repo');
const stateRepo = require('../db/state.repo');
const telegram = require('../services/telegram.service');
const ai = require('../ai/agent');
const logger = require('../utils/logger');

/* ─── Scoring helpers (replicated from n8n "Compare Results" code node) ─── */

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

function porterStem(w) {
  return w.replace(/(ing|ed|s)$/i, '');
}

function stemSentence(s) {
  return s.toLowerCase().split(/\s+/).map(porterStem).join(' ');
}

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
          part_number: part.part_number,
          description: part.description,
          score,
          original_part: part,
          diagram_url: diagramUrl,
        });
      }
    }
  }

  const ranked = [...uniqueParts.values()].sort((a, b) => b.score - a.score);
  return {
    best_match: ranked[0] ?? { score: 0 },
    second_match: ranked[1] ?? { score: 0 },
  };
}

/**
 * Part flow — replicated from the n8n Part branch.
 *
 * For each part_name:
 * 1. Get latest open quotation
 * 2. Check Hot Items (Google Sheets)
 * 3. If hot item: direct scraper find-part
 * 4. If not: alias map → categorize → scrape groups → score → evaluate
 * 5. Search Odoo for product by part number
 * 6. Add to basket
 * 7. Reply to Telegram
 */
async function handlePart(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: (t) => telegram.sendMessage(chatId, t), sendPhotoBuffer: (b, c) => telegram.sendPhotoBuffer(chatId, b, c) };
  const partNames = item.part_name || [];

  if (!partNames.length) {
    await s.sendMessage('من فضلك حدد قطعة الغيار المطلوبة.');
    return;
  }

  // Get latest open quotation
  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
  if (!quote) {
    await s.sendMessage('مفيش عرض سعر مفتوح. ابعت الـ VIN الأول.');
    return;
  }

  const vin = quote.vin || state.vin;
  if (!vin) {
    await s.sendMessage('مفيش VIN محفوظ. ابعت الـ VIN الأول.');
    return;
  }

  log.info('part.flow: start', { chatId, partNames, vin, quoteId: quote._id });

  const tenant = state.tenant_id ? await stateRepo.getTenant(state.tenant_id, correlationId) : null;

  for (const partName of partNames) {
    try {
      await processOnePart(chatId, partName, vin, quote, state, correlationId, s);
    } catch (err) {
      log.error('part.flow: error processing part', { partName, error: err.message });
      await s.sendMessage(`حصل مشكلة في البحث عن "${partName}". حاول تاني.`);
    }
  }

  // After all parts, ask if want to add more
  const basketItems = await quotesRepo.getBasketItems(quote._id, correlationId);
  const basketEmpty = basketItems.length === 0;
  const addMoreMsg = basketEmpty
    ? 'هل تريد البحث عن قطعة أخرى؟'
    : 'هل تريد إضافة قطعة أخرى ؟';
  await s.sendMessage(addMoreMsg);
}

async function processOnePart(chatId, partName, vin, quote, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: (t) => telegram.sendMessage(chatId, t), sendPhotoBuffer: (b, c) => telegram.sendPhotoBuffer(chatId, b, c) };
  log.info('part.flow.processOnePart', { partName });

  // Step 1: Check Hot Items
  const hotItem = await sheets.lookupHotItem(partName, correlationId);

  let chosenPart = null;

  if (hotItem && hotItem['Item Desc']) {
    log.info('part.flow: found in hot items', { partName });
    // AI agent decides which group the part belongs to, then scraper find-part (vin + group + partName)
    try {
      const groupName = await ai.resolvePartGroup(partName, correlationId);
      const scraperResult = await scraper.findPart(vin, partName, correlationId, groupName);
      if (scraperResult && scraperResult.part_number) {
        chosenPart = scraperResult;
      }
    } catch (err) {
      log.warn('part.flow: direct find-part failed', { error: err.message });
    }
  }

  if (!chosenPart) {
    // Step 2: Alias Map lookup
    const aliasResult = await sheets.lookupAliasMap(partName, correlationId);
    let mainGroup = null;
    let otherGroups = [];
    let mainKeyword = partName;

    if (aliasResult && aliasResult['Main Group']) {
      log.info('part.flow: found in alias map', { mainGroup: aliasResult['Main Group'] });
      mainGroup = aliasResult['Main Group'];
      mainKeyword = aliasResult['Main Keyword'] || partName;
      otherGroups = (aliasResult['Other Main Groups'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      // Step 3: LLM categorization
      log.info('part.flow: not in alias map, using LLM categorization');
      const category = await ai.categorizePart(partName, correlationId);
      mainGroup = category.main_group || 'UNKNOWN';
      otherGroups = category.other_groups || [];
      mainKeyword = category.technical_name || partName;
    }

    // Step 4: Prepare groups to scrape
    const allGroups = [mainGroup, ...otherGroups].filter(Boolean);
    const uniqueGroups = [...new Set(allGroups)];

    // Step 5: For each group, check Firestore cache then scrape
    let allSubgroups = [];
    const typeCode = quote.vehicle_details?.type_code || '';

    for (const group of uniqueGroups) {
      // Check Firestore catalogResults cache
      let cachedResults = [];
      try {
        cachedResults = await catalogRepo.queryCatalogResults(group, typeCode, correlationId);
      } catch (err) {
        log.warn('part.flow: catalog cache query failed', { error: err.message });
      }

      if (cachedResults.length > 0) {
        log.info('part.flow: using cached catalog data', { group });
        for (const cached of cachedResults) {
          if (cached.subgroups) allSubgroups.push(...cached.subgroups);
        }
      } else {
        // Scrape from Realoem: get subgroups list then query each subgroup
        log.info('part.flow: scraping group from Realoem', { group });
        try {
          const subgroupsList = await scraper.getSubgroups(vin, group, correlationId);
          const subgroupNames = subgroupsList?.subgroups || [];
          const subgroupArray = Array.isArray(subgroupNames) ? subgroupNames : [];
          const collectedSubgroups = [];

          for (const sgName of subgroupArray) {
            const subgroupId = typeof sgName === 'string' ? sgName : (sgName?.name ?? sgName?.subgroup ?? String(sgName));
            try {
              const sgData = await scraper.querySubgroup(vin, group, subgroupId, correlationId);
              if (sgData) collectedSubgroups.push(sgData);
            } catch (sgErr) {
              log.warn('part.flow: querySubgroup failed for one subgroup', { subgroup: subgroupId, error: sgErr.message });
            }
          }

          // Fallback: if getSubgroups returned nothing, use v2-query-group (single call)
          if (collectedSubgroups.length === 0) {
            try {
              const scraperData = await scraper.queryGroup(vin, group, correlationId);
              if (scraperData?.subgroups?.length) collectedSubgroups.push(...scraperData.subgroups);
            } catch (qgErr) {
              log.warn('part.flow: scraper queryGroup fallback failed', { group, error: qgErr.message });
            }
          }

          if (collectedSubgroups.length > 0) {
            allSubgroups.push(...collectedSubgroups);
            // Save to Firestore cache
            try {
              await catalogRepo.saveCatalogResult(
                {
                  type_code: typeCode,
                  series: quote.vehicle_details?.series || null,
                  model: quote.vehicle_details?.model || null,
                  engine: quote.vehicle_details?.engine || null,
                  group_name: group,
                  subgroups: collectedSubgroups.map((sg) => ({
                    subgroup: sg.subgroup ?? null,
                    diagram_image: sg.diagram_image ?? null,
                    parts: Array.isArray(sg.parts)
                      ? sg.parts.map((p) => ({
                          item_no: p.item_no || null,
                          description: p.description || null,
                          supplement: p.supplement || null,
                          quantity: p.quantity || null,
                          from_date: p.from_date ?? null,
                          to_date: p.to_date ?? null,
                          part_number: p.part_number || null,
                          price: p.price || null,
                        }))
                      : [],
                  })),
                },
                correlationId
              );
            } catch (cacheErr) {
              log.warn('part.flow: failed to cache catalog data', { error: cacheErr.message });
            }
          }
        } catch (err) {
          log.warn('part.flow: scraper getSubgroups/querySubgroup failed', { group, error: err.message });
        }
      }
    }

  if (!allSubgroups.length) {
    log.warn('part.flow: no subgroups found');
    await s.sendMessage(`مش لاقي نتايج للقطعة "${partName}". جرب اسم تاني.`);
    return;
  }

  // Step 6: Score parts
  const { best_match, second_match } = scoreParts(mainKeyword, allSubgroups);

  if (!best_match || best_match.score === 0) {
    await s.sendMessage(`مش لاقي نتايج للقطعة "${partName}". جرب اسم تاني.`);
    return;
  }

    // Step 7: Early exit or LLM evaluate
    const earlyExit = best_match.score >= 0.88 && (best_match.score - (second_match.score || 0)) >= 0.08;

    if (earlyExit) {
      chosenPart = best_match;
    } else {
      // LLM tie-breaker
      log.info('part.flow: running LLM tie-breaker', {
        bestScore: best_match.score,
        secondScore: second_match.score,
      });
      const evaluated = await ai.evaluateScraperResults(
        mainKeyword,
        best_match,
        second_match,
        correlationId
      );
      if (evaluated && evaluated.part_number) {
        chosenPart = evaluated;
      } else {
        chosenPart = best_match; // fallback to best match
      }
    }
  }

  if (!chosenPart || !chosenPart.part_number) {
    await s.sendMessage(`تمام، آسف جداً. مش لاقي القطعة "${partName}". جرب اسم تاني.`);
    return;
  }

  // Step 8: Send diagram image if available
  const diagramUrl = chosenPart.diagram_url || chosenPart.original_part?.diagram_url;
  if (diagramUrl) {
    try {
      const imageData = await scraper.downloadDiagramImage(diagramUrl, correlationId);
      if (imageData) {
        await s.sendPhotoBuffer(imageData.data, `Diagram for ${chosenPart.description || partName}`);
      }
    } catch (err) {
      log.warn('part.flow: diagram download/send failed', { error: err.message });
    }
  }

  // Step 9: Send part details to user
  const partDesc = chosenPart.description || chosenPart.original_part?.description || partName;
  const partNumber = chosenPart.part_number || chosenPart.original_part?.part_number || '';
  const itemNo = chosenPart.original_part?.item_no || '';
  const notes = chosenPart.original_part?.notes
    ? (Array.isArray(chosenPart.original_part.notes) ? chosenPart.original_part.notes.join(', ') : chosenPart.original_part.notes)
    : '';

  const confirmMsg = [
    'لقيت القطعة دي:',
    '',
    `*القطعة:* ${partDesc}`,
    `*رقم القطعة (Part Number):* ${partNumber}`,
    `*رقم الصنف (Item No):* ${itemNo}`,
    notes ? `*ملاحظات:* ${notes}` : '',
    '',
    'هل دي القطعة المطلوبة؟',
  ].filter(Boolean).join('\n');

  await s.sendMessage(confirmMsg);

  // Step 10: Search Odoo for product and add to basket
  // (In the n8n flow this waits for user confirmation — in code we auto-proceed)
  let products = [];
  try {
    products = await odoo.searchProduct(partNumber, correlationId, tenant);
  } catch (err) {
    log.warn('part.flow: Odoo searchProduct failed', { error: err.message });
  }

  if (!products.length) {
    await s.sendMessage('Sorry item out of stock or unavailable');
    return;
  }

  // Add to basket
  try {
    await quotesRepo.addToBasket(
      quote._id,
      { part_number: partNumber, products },
      correlationId
    );
    log.info('part.flow: added to basket', { partNumber });
  } catch (err) {
    log.warn('part.flow: addToBasket failed', { error: err.message });
  }
}

module.exports = { handlePart, scoreParts, getLevenshtein, getTokenSetRatio, stemSentence };
