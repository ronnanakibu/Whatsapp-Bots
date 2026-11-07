/**
 * tests/selfHealing/selfHealingEngine.test.js
 * 
 * Master Test Suite for Milestone 4 Autonomous Self-Healing Engine:
 * - 4 Repair Classes: TRANSIENT, STATE, APPLICATION, INFRASTRUCTURE
 * - Incident Capture & Stack Sanitization (zero secret leakage)
 * - Protected Path Guard (no modifications to .env, permissions, main.db)
 * - 15% Recovery Reserve Unlock for Self-Healing
 * - Automatic Rollback on Patch Validation Failure
 * - Successful Patch Promotion upon Verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SelfHealingEngine,
    REPAIR_CLASSES,
    INCIDENT_STATUS,
    PROTECTED_PATHS
} from '../../src/services/selfHealing/selfHealingEngine.js';

test('SelfHealingEngine - Failure Classification & Sanitization', async (t) => {
    const engine = new SelfHealingEngine();

    await t.test('classifies HTTP 429 and rate limits as TRANSIENT', () => {
        const err = new Error('HTTP 429 Too Many Requests - Provider Rate Limit Exceeded');
        const classification = engine.classifyFailure(err);
        assert.equal(classification, REPAIR_CLASSES.TRANSIENT);
    });

    await t.test('classifies state and cache desync as STATE', () => {
        const err = new Error('Malformed JSON parse in temporary store / stale cache');
        const classification = engine.classifyFailure(err);
        assert.equal(classification, REPAIR_CLASSES.STATE);
    });

    await t.test('classifies standard TypeError code bugs as APPLICATION', () => {
        const err = new TypeError('Cannot read properties of undefined (reading "slice")');
        const classification = engine.classifyFailure(err);
        assert.equal(classification, REPAIR_CLASSES.APPLICATION);
    });

    await t.test('sanitizes sensitive tokens and API keys in stack traces', () => {
        const sensitiveStack = 'Error at service.js: apiKey=sk-proj-abc1234567890abcdef1234567890 password=secretpass';
        const sanitized = engine.sanitizeStack(sensitiveStack);
        assert.ok(!sanitized.includes('sk-proj-abc1234567890abcdef1234567890'));
        assert.ok(!sanitized.includes('secretpass'));
        assert.ok(sanitized.includes('REDACTED'));
    });
});

test('SelfHealingEngine - Protected Path Guard (Section 8.7)', async (t) => {
    const engine = new SelfHealingEngine();

    for (const forbidden of ['.env', 'storage/database/main.db', 'src/middleware/permission.js', 'package.json']) {
        assert.equal(engine.isPathPermitted(forbidden), false);
    }

    assert.equal(engine.isPathPermitted('src/commands/tools/calculator.js'), true);
    assert.equal(engine.isPathPermitted('src/services/lyrics.js'), true);
});

test('SelfHealingEngine - Automated Self-Healing Workflow & Rollback', async (t) => {
    await t.test('resolves TRANSIENT error without code patches', async () => {
        const engine = new SelfHealingEngine();
        const err = new Error('Rate limit 429');
        const incident = engine.captureIncident(err, 'aiRouter');

        const result = await engine.handleIncident(incident.incident_id);
        assert.equal(result.status, 'RESOLVED');
        assert.equal(result.repairClass, REPAIR_CLASSES.TRANSIENT);
        assert.equal(result.action, 'PROVIDER_FAILOVER_OR_BACKOFF');
    });

    await t.test('automatically rolls back when patch validation tests fail', async () => {
        const engine = new SelfHealingEngine({
            patchExecutor: async () => ({ syntaxValid: true, testPassed: false }) // failed test
        });

        const err = new TypeError('Bug in parser');
        const incident = engine.captureIncident(err, 'parser');

        const result = await engine.handleIncident(incident.incident_id, {
            targetFile: 'src/services/parser.js',
            originalContent: 'broken code',
            patchContent: 'flawed patch'
        });

        assert.equal(result.status, 'ROLLED_BACK');
        assert.equal(result.action, 'ROLLED_BACK');
        assert.equal(incident.status, INCIDENT_STATUS.ROLLED_BACK);
        assert.equal(incident.rollbackHistory.length, 1);
    });

    await t.test('promotes patch when syntax and regression tests pass', async () => {
        const engine = new SelfHealingEngine({
            patchExecutor: async () => ({ syntaxValid: true, testPassed: true }) // passed test
        });

        const err = new TypeError('Null pointer in helper');
        const incident = engine.captureIncident(err, 'helper');

        const result = await engine.handleIncident(incident.incident_id, {
            targetFile: 'src/services/helper.js',
            originalContent: 'code without null check',
            patchContent: 'code with null check'
        });

        assert.equal(result.status, 'RESOLVED');
        assert.equal(result.action, 'PATCH_APPLIED_AND_VERIFIED');
        assert.equal(incident.status, INCIDENT_STATUS.RESOLVED);
        assert.equal(incident.patches.length, 1);
    });
});

