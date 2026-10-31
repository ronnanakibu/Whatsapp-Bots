/**
 * tests/e2e/runAll.js
 * 
 * Standalone Master Test Runner for WABOT2.0 E2E Testing Suite (Tiers 1-4).
 * Executes the full aggregated master test suite via Node.js native test runner.
 */

import { spawn } from 'child_process'
import path from 'path'

console.log('='.repeat(72))
console.log('   WABOT2.0 Autonomous AI Operating System — E2E Master Test Suite')
console.log('='.repeat(72))
console.log(`Node.js Version: ${process.version}`)
console.log(`Platform       : ${process.platform}`)
console.log(`Environment    : ${process.env.NODE_ENV || 'test'}`)
console.log(`Test Aggregator: tests/e2e/index.test.js`)
console.log('Tiers Included :')
console.log('  - Tier 1: Feature Coverage (Happy Path)')
console.log('  - Tier 2: Boundary & Corner Cases')
console.log('  - Tier 3: Cross-Feature Combinations & Security Parity')
console.log('  - Tier 4: Real-World Scenarios & Full Message Lifecycle')
console.log('='.repeat(72) + '\n')

const startTime = Date.now()

const child = spawn(process.execPath, [
    '--test',
    '--test-force-exit',
    '--test-timeout=60000',
    'tests/e2e/index.test.js'
], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', BOT_PREFIX: '.', AUTO_READ: 'false' },
    stdio: ['ignore', 'inherit', 'inherit']
})

child.on('close', (code) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log('\n' + '='.repeat(72))
    if (code === 0) {
        console.log(`✅ ALL 33 E2E TESTS (TIERS 1-4) PASSED IN ${elapsed}s (Exit Code: ${code})`)
        console.log('='.repeat(72))
        process.exit(0)
    } else {
        console.error(`❌ E2E MASTER TEST SUITE FAILED (Exit Code: ${code}) IN ${elapsed}s`)
        console.log('='.repeat(72))
        process.exit(code || 1)
    }
})
