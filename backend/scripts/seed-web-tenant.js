#!/usr/bin/env node
'use strict';

/**
 * Creates a "web" tenant and user for web chat sessions.
 * Run from backend: node scripts/seed-web-tenant.js
 * Then set in .env: WEB_DEFAULT_TENANT_ID=web-tenant, WEB_DEFAULT_USER_ID=<printed user id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.DATABASE_URL_PUBLIC) process.env.DATABASE_URL = process.env.DATABASE_URL_PUBLIC;

const { getPrisma } = require('../src/services/prisma.service');

const WEB_TENANT_ID = 'web-tenant';

async function main() {
  const prisma = getPrisma();
  let tenant = await prisma.tenant.findUnique({ where: { id: WEB_TENANT_ID } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { id: WEB_TENANT_ID, name: 'Web Chat', status: 'active' },
    });
    console.log('Created tenant:', tenant.id);
  } else {
    console.log('Tenant already exists:', tenant.id);
  }

  let user = await prisma.user.findFirst({ where: { tenant_id: tenant.id, chat_id: 'web' } });
  if (!user) {
    user = await prisma.user.create({
      data: { chat_id: 'web', tenant_id: tenant.id },
    });
    console.log('Created user:', user.id);
  } else {
    console.log('User already exists:', user.id);
  }

  console.log('\nAdd to your .env:');
  console.log('WEB_DEFAULT_TENANT_ID=' + WEB_TENANT_ID);
  console.log('WEB_DEFAULT_USER_ID=' + user.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
