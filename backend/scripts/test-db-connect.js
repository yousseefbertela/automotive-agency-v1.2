#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.DATABASE_URL_PUBLIC) process.env.DATABASE_URL = process.env.DATABASE_URL_PUBLIC;
const { getPrisma } = require('../src/services/prisma.service');
getPrisma().$connect()
  .then(() => { console.log('DB connected OK'); process.exit(0); })
  .catch(e => { console.error('DB connection failed:', e.message); process.exit(1); });
