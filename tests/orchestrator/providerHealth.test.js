/**
 * tests/orchestrator/providerHealth.test.js
 * 
 * Comprehensive Unit Test Suite for ProviderHealthManager, CircuitBreaker & Intelligent Failover
 * Tests:
 * - Error classification & retry-after extraction
 * - Rolling latency EMA, P95, and windowed metrics
 * - 4-state circuit breaker state machine (HEALTHY, COOLDOWN, CIRCUIT_OPEN, HALF_OPEN)
 * - Probe token gating in HALF_OPEN
 * - Zero false claims on provider catalog
 * - Context normalization & preservation
 * - Transparent failover execution with atomic reconciliation payload
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ProviderHealthManager,
    CircuitBreaker,
    CircuitState,
    ErrorCategory,
    ErrorClassifier,
    PROVIDER_CATALOG
} from '../../src/services/orchestrator/index.js';

test('ProviderHealth - Error Classification & Retry-After Parsing', async (t) => {
    await t.test('classifies HTTP 429 and text rate limits correctly', () => {
        const err1 = new Error('Rate limit reached');
        err1.status = 429;
        err1.headers = { 'retry-after': '12' };

        const c1 = ErrorClassifier.classify(err1);
        assert.equal(c1.category, ErrorCategory.RATE_LIMIT);
        assert.equal(c1.isRateLimit, true);
        assert.equal(c1.isRetryable, true);
        assert.equal(c1.retryAfterMs, 12000);

        const err2 = new Error('resource_exhausted: try again in 5.5s');
        const c2 = ErrorClassifier.classify(err2);
        assert.equal(c2.category, ErrorCategory.RATE_LIMIT);
        assert.equal(c2.retryAfterMs, 5500);
    });

    await t.test('classifies context length overflow as CONTEXT_OVERFLOW', () => {
        const err = new Error('maximum context length is 8192 tokens, but your prompt is 9500 tokens');
        err.status = 400;

        const c = ErrorClassifier.classify(err);
        assert.equal(c.category, ErrorCategory.CONTEXT_OVERFLOW);
        assert.equal(c.isRetryable, true); // Retryable when pruned
    });

    await t.test('classifies auth, safety, network, and server errors accurately', () => {
        const authErr = new Error('Invalid API Key provided');
        authErr.status = 401;
        assert.equal(ErrorClassifier.classify(authErr).category, ErrorCategory.AUTH_ERROR);
        assert.equal(ErrorClassifier.classify(authErr).isRetryable, false);

        const safetyErr = new Error('Response blocked by content moderation safety policy');
        assert.equal(ErrorClassifier.classify(safetyErr).category, ErrorCategory.SAFETY_BLOCK);
        assert.equal(ErrorClassifier.classify(safetyErr).isRetryable, false);

        const netErr = new Error('Connect timeout ETIMEDOUT');
        netErr.code = 'ETIMEDOUT';
        assert.equal(ErrorClassifier.classify(netErr).category, ErrorCategory.NETWORK_ERROR);
        assert.equal(ErrorClassifier.classify(netErr).isRetryable, true);

        const srvErr = new Error('Internal Server Error');
        srvErr.status = 503;
        assert.equal(ErrorClassifier.classify(srvErr).category, ErrorCategory.SERVER_ERROR);
        assert.equal(ErrorClassifier.classify(srvErr).isRetryable, true);
    });
});

test('ProviderHealth - 4-State Circuit Breaker State Transitions', async (t) => {
    await t.test('transitions from HEALTHY to COOLDOWN on 429 and honors timer', () => {
        const breaker = new CircuitBreaker('test-groq', { baseCooldownMs: 100 });
        assert.equal(breaker.getState(), CircuitState.HEALTHY);
        assert.equal(breaker.canAttempt(), true);

        // Encounter 429 with 50ms retry-after
        const err = new Error('Rate limit 429');
        err.status = 429;
        err.headers = { 'retry-after-ms': '50' };

        breaker.recordFailure(err, 20);
        assert.equal(breaker.getState(), CircuitState.COOLDOWN);
        assert.equal(breaker.canAttempt(), false);

        // Advance simulated time past cooldown
        breaker.cooldownUntil = Date.now() - 10;
        assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
    });

    await t.test('gates probationary probes in HALF_OPEN (1 probe max)', () => {
        const breaker = new CircuitBreaker('test-nvidia');
        breaker.state = CircuitState.HALF_OPEN;

        // First probe acquires slot
        assert.equal(breaker.acquireProbeSlot(), true);

        // Second probe is rejected while first is in flight
        assert.equal(breaker.acquireProbeSlot(), false);
        assert.equal(breaker.canAttempt(), false);

        // Probe succeeds -> transitions to HEALTHY
        breaker.recordSuccess(150, { inputTokens: 100, outputTokens: 50 });
        assert.equal(breaker.getState(), CircuitState.HEALTHY);
        assert.equal(breaker.canAttempt(), true);
    });

    await t.test('probe failure in HALF_OPEN immediately re-trips circuit', () => {
        const breaker = new CircuitBreaker('test-gemini');
        breaker.state = CircuitState.HALF_OPEN;
        breaker.acquireProbeSlot();

        const srvErr = new Error('500 Service Unavailable');
        srvErr.status = 500;
        breaker.recordFailure(srvErr, 100);

        assert.equal(breaker.getState(), CircuitState.CIRCUIT_OPEN);
        assert.equal(breaker.canAttempt(), false);
    });

    await t.test('consecutive failures trip to CIRCUIT_OPEN', () => {
        const breaker = new CircuitBreaker('test-openrouter', { failureThreshold: 3 });

        const srvErr = new Error('502 Bad Gateway');
        srvErr.status = 502;

        breaker.recordFailure(srvErr, 100);
        assert.equal(breaker.getState(), CircuitState.HEALTHY);

        breaker.recordFailure(srvErr, 100);
        assert.equal(breaker.getState(), CircuitState.HEALTHY);

        breaker.recordFailure(srvErr, 100);
        assert.equal(breaker.getState(), CircuitState.CIRCUIT_OPEN);
    });
});

test('ProviderHealth - Metrics, EMA Latency & Zero False Claims', async (t) => {
    await t.test('correctly calculates EMA and P95 latency', () => {
        const breaker = new CircuitBreaker('test-metrics');
        breaker.recordSuccess(100);
        breaker.recordSuccess(200);
        breaker.recordSuccess(300);

        const stats = breaker.metrics.getLatencyStats();
        assert.ok(stats.ema > 0);
        assert.equal(stats.min, 100);
        assert.equal(stats.max, 300);
        assert.ok(stats.p95 >= 200);
    });

    await t.test('catalog verifies zero false claims across all providers', () => {
        for (const [id, meta] of Object.entries(PROVIDER_CATALOG)) {
            assert.equal(
                meta.isFreeOrUnlimited,
                false,
                `Provider ${id} must NOT falsely claim to be free or unlimited`
            );
            assert.ok(meta.name);
            assert.ok(meta.candidateModels.length > 0);
        }
    });
});

test('ProviderHealth - Context Normalization & Intelligent Failover', async (t) => {
    const manager = new ProviderHealthManager({ skipEnvCheck: true });

    await t.test('normalizes messages for bounded context windows', () => {
        const longHistory = [
            { role: 'system', content: 'Doctrine' },
            { role: 'user', content: 'Turn 1' },
            { role: 'assistant', content: 'Reply 1' },
            { role: 'user', content: 'Turn 2' },
            { role: 'assistant', content: 'Reply 2' },
            { role: 'user', content: 'Turn 3' },
            { role: 'assistant', content: 'Reply 3' },
            { role: 'user', content: 'Turn 4' },
            { role: 'assistant', content: 'Reply 4' },
            { role: 'user', content: 'Turn 5' }
        ];

        // For large context (128k), preserves all
        const unpruned = manager.preserveAndNormalizeContext(longHistory, 131072);
        assert.equal(unpruned.length, 10);

        // For small context (8k), prunes to system message + last 4 turns
        const pruned = manager.preserveAndNormalizeContext(longHistory, 8192);
        assert.equal(pruned.length, 5);
        assert.equal(pruned[0].role, 'system');
        assert.equal(pruned[4].content, 'Turn 5');
    });

    await t.test('executeWithFailover handles provider failure and reconciles attempts', async () => {
        // Mock execute function: provider 1 fails with 429, provider 2 succeeds
        let attemptCount = 0;
        const mockExecute = async (candidate, context) => {
            attemptCount++;
            if (candidate.provider === 'groq') {
                const err = new Error('Groq 429 Rate limit');
                err.status = 429;
                throw err;
            }
            return {
                text: 'Generated reply from fallback provider',
                model: candidate.model,
                reportedTokens: { inputTokens: 150, outputTokens: 80, totalTokens: 230 }
            };
        };

        const result = await manager.executeWithFailover('Test Query', mockExecute, {
            tier: 1,
            requirements: { capabilities: ['text'] },
            messages: [{ role: 'user', content: 'Hello' }]
        });

        assert.equal(result.text, 'Generated reply from fallback provider');
        assert.ok(result.attempts.length >= 2);
        assert.equal(result.attempts[0].status, 'FAILED');
        assert.equal(result.attempts[1].status, 'SUCCESS');

        // Verify reconciliation payload is structured for BudgetManager
        const recon = result.reconciliation;
        assert.equal(recon.totalApiCalls, result.attempts.length);
        assert.equal(recon.failedCalls, 1);
        assert.equal(recon.successfulCalls, 1);
        assert.equal(recon.actualInputTokens, 150);
        assert.equal(recon.actualOutputTokens, 80);
        assert.ok(recon.totalLatencyMs >= 0);
    });

    await t.test('executeWithFailover aborts on non-retryable SAFETY_BLOCK', async () => {
        const mockExecute = async () => {
            throw new Error('Blocked by safety policy');
        };

        await assert.rejects(
            () => manager.executeWithFailover('Blocked Query', mockExecute, { tier: 1 }),
            (err) => {
                assert.ok(err.isProviderExhaustion);
                // Should stop after 1 attempt instead of hammering all other providers
                assert.equal(err.attempts.length, 1);
                assert.equal(err.attempts[0].error.category, ErrorCategory.SAFETY_BLOCK);
                return true;
            }
        );
    });
});
