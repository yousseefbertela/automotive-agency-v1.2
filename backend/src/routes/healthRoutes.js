'use strict';

const express = require('express');
const router = express.Router();

/**
 * GET /api/health
 * Returns { ok, time, version? }
 */
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

module.exports = router;
