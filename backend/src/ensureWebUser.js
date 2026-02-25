'use strict';

/**
 * Ensures web tenant and user exist; sets WEB_DEFAULT_TENANT_ID and WEB_DEFAULT_USER_ID if missing.
 * Call before loading app so sessionStore sees the values. No-op if already set or DB unreachable.
 */
const logger = require('./utils/logger');

const WEB_TENANT_ID = 'web-tenant';

async function ensureWebUser() {
  if (process.env.WEB_DEFAULT_USER_ID) {
    return;
  }
  if (!process.env.DATABASE_URL) {
    return;
  }
  try {
    const { getPrisma } = require('./services/prisma.service');
    const prisma = getPrisma();
    let tenant = await prisma.tenant.findUnique({ where: { id: WEB_TENANT_ID } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { id: WEB_TENANT_ID, name: 'Web Chat', status: 'active' },
      });
      logger.info('ensureWebUser: created tenant', { id: tenant.id });
    }
    let user = await prisma.user.findFirst({ where: { tenant_id: tenant.id, chat_id: 'web' } });
    if (!user) {
      user = await prisma.user.create({
        data: { chat_id: 'web', tenant_id: tenant.id },
      });
      logger.info('ensureWebUser: created user', { id: user.id });
    }
    process.env.WEB_DEFAULT_TENANT_ID = WEB_TENANT_ID;
    process.env.WEB_DEFAULT_USER_ID = user.id;
    logger.info('ensureWebUser: web chat user ready', { WEB_DEFAULT_USER_ID: user.id });
  } catch (err) {
    logger.warn('ensureWebUser: could not ensure web user (DB may be unreachable)', { error: err.message });
  }
}

module.exports = { ensureWebUser };
