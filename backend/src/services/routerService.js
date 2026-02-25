'use strict';

const { routeScenario, normalizeVin } = require('../workflows/router');

/**
 * Routes scenarios to existing workflow/scraper logic.
 * Re-exports from workflows/router for service-layer use.
 */
module.exports = { routeScenario, normalizeVin };
