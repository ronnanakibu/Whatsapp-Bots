/**
 * tests/e2e/index.test.js
 * 
 * Master test suite aggregator for WABOT2.0 E2E testing (Tiers 1-4).
 * Combines all tiers into a single optimized Node.js test process,
 * sharing the in-memory command registry cache for maximum execution speed.
 */

import './tier1_features.test.js'
import './tier2_boundaries.test.js'
import './tier3_cross_features.test.js'
import './tier4_scenarios.test.js'
