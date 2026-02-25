'use strict';

const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

/**
 * Query catalog cache by group_name and type_code. Returns array of { _id, ...data }.
 * If multiple exist, use newest by created_at (take first after ordering desc).
 */
async function queryCatalogResults(groupName, typeCode, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('catalog.queryCatalogResults', { groupName, typeCode });
  const prisma = getPrisma();
  const rows = await prisma.catalogResult.findMany({
    where: {
      group_name: groupName,
      type_code: typeCode ?? null,
    },
    orderBy: { created_at: 'desc' },
  });
  return rows.map((d) => ({ _id: d.id, ...d }));
}

/**
 * Save catalog result (one document per call).
 */
async function saveCatalogResult(data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('catalog.saveCatalogResult');
  const prisma = getPrisma();
  await prisma.catalogResult.create({
    data: {
      type_code: data.type_code ?? null,
      series: data.series ?? null,
      model: data.model ?? null,
      engine: data.engine ?? null,
      group_name: data.group_name ?? '',
      subgroups: data.subgroups ?? [],
    },
  });
}

module.exports = { queryCatalogResults, saveCatalogResult };
