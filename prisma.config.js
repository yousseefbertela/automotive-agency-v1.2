'use strict';

require('dotenv').config();

module.exports = {
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/prisma',
  },
};
