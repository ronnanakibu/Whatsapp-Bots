/**
 * tests/orchestrator/challengerStress.test.js
 * 
 * Empirical Stress-Testing Harness by challenger_m2_2 (Circuit Breaker & Failover Stress Challenger)
 * Rigorously probes:
 * 1. Circuit Breaker State Transitions & HALF_OPEN Probe Gating
 * 2. Cooldown & Retry-After Header Parsing with precise timing
 * 3. Failover Execution & Ledger Reconciliation without token double-counting
 * 4. Concurrency Limit Bounds on reservations and sub-agent delegation
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ProviderHealthManager,
    CircuitBreaker,
    CircuitState,
    ErrorCategory,
    ErrorClassifier,
    BudgetManager,
    ConcurrencyLimitExceededError,
    SubAgentDelegationError,
    SCOPE_TYPES,
    SCOPE_STATUS,
    RESERVATION_STATUS
} from '../../src/services/orchestrator/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 1: CIRCUIT BREAKER STATE TRANSITIONS & HALF_OPEN PROBE GATING
// ─────────────────────────────────────────────────────────────────────────────
test('Empirical Probe 1 - Circuit Breaker State Transitions & Probe Gating', async (t) => {
    await t.test('1.1: Consecutive 5xx errors trigger strict transition from HEALTHY to CIRCUIT_OPEN', () => {
        const breaker = new CircuitBreaker('test-provider-5xx', {
            failureThreshold: 3,
            circuitOpenDurationMs: 60000
        });

        assert.equal(breaker.getState(), CircuitState.HEALTHY);
        assert.equal(breaker.canAttempt(), true);

        // Error 1: 500 Internal Server Error
        const err1 = new Error('HTTP 500 Internal Server Error');
        err1.status = 500;
        breaker.recordFailure(err1, 100);
        assert.equal(breaker.getState(), CircuitState.HEALTHY, 'Should remain HEALTHY after 1 error');
        assert.equal(breaker.metrics.consecutiveErrors, 1);
        assert.equal(breaker.canAttempt(), true);

        // Error 2: 503 Service Unavailable
        const err2 = new Error('HTTP 503 Service Unavailable');
        err2.status = 503;
        breaker.recordFailure(err2, 120);
        assert.equal(breaker.getState(), CircuitState.HEALTHY, 'Should remain HEALTHY after 2 errors');
        assert.equal(breaker.metrics.consecutiveErrors, 2);
        assert.equal(breaker.canAttempt(), true);

        // Error 3: 502 Bad Gateway -> reaches threshold (3)
        const err3 = new Error('HTTP 502 Bad Gateway');
        err3.status = 502;
        breaker.recordFailure(err3, 90);
        assert.equal(breaker.getState(), CircuitState.CIRCUIT_OPEN, 'Must trip to CIRCUIT_OPEN at threshold');
        assert.equal(breaker.metrics.consecutiveErrors, 3);
        assert.equal(breaker.canAttempt(), false, 'Must reject requests when CIRCUIT_OPEN');
        assert.ok(breaker.circuitOpenUntil > Date.now(), 'Must set future circuitOpenUntil timestamp');
        assert.equal(breaker.tripCount, 1);

        // Error 4 while already open: remains CIRCUIT_OPEN
        const err4 = new Error('HTTP 504 Gateway Timeout');
        err4.status = 504;
        breaker.recordFailure(err4, 50);
        assert.equal(breaker.getState(), CircuitState.CIRCUIT_OPEN);
        assert.equal(breaker.canAttempt(), false);
    });

    await t.test('1.2: Sliding window error rate trips to CIRCUIT_OPEN after 5 calls with >=50% failures', () => {
        const breaker = new CircuitBreaker('test-window-rate', {
            failureThreshold: 10, // High consecutive threshold so error rate triggers it
            errorRateThreshold: 0.5,
            windowSize: 10
        });

        // Call 1: Success
        breaker.recordSuccess(100);
        // Call 2: Failure (Network)
        const netErr = new Error('ETIMEDOUT');
        netErr.code = 'ETIMEDOUT';
        breaker.recordFailure(netErr, 100);
        // Call 3: Success
        breaker.recordSuccess(100);
        // Call 4: Failure (500)
        const srvErr = new Error('Server Error');
        srvErr.status = 500;
        breaker.recordFailure(srvErr, 100);

        // At 4 calls (2 fails / 4 = 50%), totalCalls < 5, so still HEALTHY
        assert.equal(breaker.getState(), CircuitState.HEALTHY);

        // Call 5: Failure (500) -> 3 fails / 5 calls = 60% error rate >= 50%
        breaker.recordFailure(srvErr, 100);
        assert.equal(breaker.getState(), CircuitState.CIRCUIT_OPEN, 'Error rate >= 50% on 5+ calls must trip circuit');
        assert.equal(breaker.canAttempt(), false);
    });

    await t.test('1.3: HALF_OPEN strictly permits exactly 1 probe slot; concurrent callers are rejected', () => {
        const breaker = new CircuitBreaker('test-halfopen-gating', { halfOpenMaxProbes: 1 });
        breaker.state = CircuitState.HALF_OPEN;

        assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
        assert.equal(breaker.canAttempt(), true, 'canAttempt is true before probe slot is acquired');

        // Request 1 acquires the single probationary probe slot
        const acquiredSlot1 = breaker.acquireProbeSlot();
        assert.equal(acquiredSlot1, true, 'First caller must successfully acquire probe slot');
        assert.equal(breaker.probesInFlight, 1);

        // Concurrent Requests 2, 3, 4, 5 attempt to acquire probe slot
        const acquiredSlot2 = breaker.acquireProbeSlot();
        const acquiredSlot3 = breaker.acquireProbeSlot();
        const acquiredSlot4 = breaker.acquireProbeSlot();
        assert.equal(acquiredSlot2, false, 'Second concurrent caller must be rejected');
        assert.equal(acquiredSlot3, false, 'Third concurrent caller must be rejected');
        assert.equal(acquiredSlot4, false, 'Fourth concurrent caller must be rejected');

        // canAttempt() must now return false because probe slot is occupied
        assert.equal(breaker.canAttempt(), false, 'canAttempt must return false while probe is in flight');
    });

    await t.test('1.4: Probe resolution: success restores HEALTHY; failure immediately re-trips', () => {
        // Scenario A: Probe succeeds
        const breakerA = new CircuitBreaker('test-probe-success', { halfOpenMaxProbes: 1 });
        breakerA.state = CircuitState.HALF_OPEN;
        breakerA.acquireProbeSlot();

        breakerA.recordSuccess(150, { inputTokens: 200, outputTokens: 80 });
        assert.equal(breakerA.getState(), CircuitState.HEALTHY, 'Successful probe must restore state to HEALTHY');
        assert.equal(breakerA.probesInFlight, 0, 'probesInFlight must be reset to 0');
        assert.equal(breakerA.canAttempt(), true, 'canAttempt must be true after recovery');
        assert.equal(breakerA.circuitOpenUntil, 0);

        // Scenario B: Probe fails with 5xx -> re-trips to CIRCUIT_OPEN with exponential backoff
        const breakerB = new CircuitBreaker('test-probe-fail-500', { halfOpenMaxProbes: 1 });
        breakerB.state = CircuitState.HALF_OPEN;
        breakerB.acquireProbeSlot();

        const srvErr = new Error('500 Probe Failed');
        srvErr.status = 500;
        breakerB.recordFailure(srvErr, 200);

        assert.equal(breakerB.getState(), CircuitState.CIRCUIT_OPEN, 'Failed probe must immediately re-trip to CIRCUIT_OPEN');
        assert.equal(breakerB.probesInFlight, 0, 'probesInFlight must be cleared after re-trip');
        assert.equal(breakerB.canAttempt(), false);
        assert.ok(breakerB.circuitOpenUntil > Date.now());

        // Scenario C: Probe fails with 429 -> transitions to COOLDOWN
        const breakerC = new CircuitBreaker('test-probe-fail-429', { halfOpenMaxProbes: 1 });
        breakerC.state = CircuitState.HALF_OPEN;
        breakerC.acquireProbeSlot();

        const rateErr = new Error('429 Rate Limit');
        rateErr.status = 429;
        breakerC.recordFailure(rateErr, 50);

        assert.equal(breakerC.getState(), CircuitState.COOLDOWN, 'Probe failing with 429 must transition to COOLDOWN');
        assert.equal(breakerC.probesInFlight, 0);
        assert.equal(breakerC.canAttempt(), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 2: COOLDOWN & RETRY-AFTER HEADER PARSING ACCURACY
// ─────────────────────────────────────────────────────────────────────────────
test('Empirical Probe 2 - Cooldown & Retry-After Parsing with Precise Duration', async (t) => {
    await t.test('2.1: Parses "retry-after: 5" header and enforces precise cooldown duration', () => {
        const breaker = new CircuitBreaker('test-cooldown-5s');
        const beforeTrip = Date.now();

        const err = new Error('Rate limit exceeded');
        err.status = 429;
        err.headers = { 'retry-after': '5' };

        const classified = breaker.recordFailure(err, 40);
        const afterTrip = Date.now();

        assert.equal(classified.category, ErrorCategory.RATE_LIMIT);
        assert.equal(classified.isRateLimit, true);
        assert.equal(classified.retryAfterMs, 5000, 'Header "5" must parse to exactly 5000ms');

        assert.equal(breaker.getState(), CircuitState.COOLDOWN);
        assert.equal(breaker.canAttempt(), false);

        // Check cooldown timestamp precision: should be [beforeTrip + 5000, afterTrip + 5000]
        assert.ok(breaker.cooldownUntil >= beforeTrip + 5000, `cooldownUntil (${breaker.cooldownUntil}) must be >= ${beforeTrip + 5000}`);
        assert.ok(breaker.cooldownUntil <= afterTrip + 5000 + 100, `cooldownUntil (${breaker.cooldownUntil}) must be <= ${afterTrip + 5000 + 100}`);

        // Status introspection inspection
        const status = breaker.getStatus();
        assert.equal(status.state, CircuitState.COOLDOWN);
        assert.equal(status.cooldown.isActive, true);
        assert.ok(status.cooldown.remainingMs > 4500 && status.cooldown.remainingMs <= 5000);

        // Advance simulated time past cooldown: state must become HALF_OPEN
        breaker.cooldownUntil = Date.now() - 50;
        assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
        assert.equal(breaker.canAttempt(), true);
    });

    await t.test('2.2: Extracts retry-after from varied formats (seconds, ms, Fetch get, Date, regex text)', () => {
        // Format A: Numeric seconds
        const errSec = { status: 429, headers: { 'retry-after': 14 } };
        assert.equal(ErrorClassifier.classify(errSec).retryAfterMs, 14000);

        // Format B: Fetch API headers.get() method
        const errFetch = {
            status: 429,
            headers: {
                get: (key) => (key === 'retry-after' ? '9' : null)
            }
        };
        assert.equal(ErrorClassifier.classify(errFetch).retryAfterMs, 9000);

        // Format C: Explicit retry-after-ms header
        const errMs = { status: 429, headers: { 'retry-after-ms': '18500' } };
        assert.equal(ErrorClassifier.classify(errMs).retryAfterMs, 18500);

        // Format D: HTTP Date format
        const futureDate = new Date(Date.now() + 25000).toUTCString();
        const errDate = { status: 429, headers: { 'retry-after': futureDate } };
        const parsedMs = ErrorClassifier.classify(errDate).retryAfterMs;
        assert.ok(parsedMs >= 23000 && parsedMs <= 26000, `Expected ~25000ms, got ${parsedMs}`);

        // Format E: Regex extraction from error text "wait 16 seconds"
        const errText1 = new Error('Resource quota exceeded; please wait 16 seconds before retrying');
        assert.equal(ErrorClassifier.classify(errText1).retryAfterMs, 16000);

        // Format F: Regex extraction "try again in 7.5s"
        const errText2 = new Error('Too many requests, try again in 7.5s');
        assert.equal(ErrorClassifier.classify(errText2).retryAfterMs, 7500);

        // Format G: Regex extraction "try again in 800ms"
        const errText3 = new Error('Rate limit hit. Try again in 800ms');
        assert.equal(ErrorClassifier.classify(errText3).retryAfterMs, 800);
    });

    await t.test('2.3: ProviderHealthManager excludes providers in COOLDOWN from fallback chain', () => {
        const manager = new ProviderHealthManager({ skipEnvCheck: true });

        // Initially Groq is available
        assert.equal(manager.isAvailable('groq'), true);

        // Put Groq into COOLDOWN with retry-after: 10
        const rateErr = new Error('Groq TPM rate limit');
        rateErr.status = 429;
        rateErr.headers = { 'retry-after': '10' };
        manager.recordFailure('groq', rateErr);

        assert.equal(manager.isAvailable('groq'), false);

        // Fallback chain for Tier 1 must NOT contain Groq
        const chain = manager.getFallbackChain(1);
        const groqCandidate = chain.find(c => c.provider === 'groq');
        assert.equal(groqCandidate, undefined, 'Provider in COOLDOWN must be excluded from active fallback chain');

        // Reset Groq
        manager.getBreaker('groq').reset();
        assert.equal(manager.isAvailable('groq'), true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 3: FAILOVER EXECUTION & LEDGER RECONCILIATION WITHOUT TOKEN DOUBLE-COUNTING
// ─────────────────────────────────────────────────────────────────────────────
test('Empirical Probe 3 - Failover Execution & Ledger Reconciliation Without Double-Counting', async (t) => {
    await t.test('3.1: Simulates failure on primary and success on fallback; verifies reconciliation payload', async () => {
        const manager = new ProviderHealthManager({ skipEnvCheck: true });

        let executionCalls = 0;
        const mockExecute = async (candidate, normalizedContext) => {
            executionCalls++;

            if (candidate.provider === 'groq') {
                // Primary provider fails with 500 error
                const err = new Error('Groq 500 Service Unavailable');
                err.status = 500;
                throw err;
            }

            // Fallback provider (e.g. nvidia or openrouter) succeeds
            return {
                text: 'Response delivered safely by fallback provider',
                model: candidate.model,
                reportedTokens: {
                    inputTokens: 380,
                    outputTokens: 140,
                    totalTokens: 520
                }
            };
        };

        const result = await manager.executeWithFailover('Analyze project architecture', mockExecute, {
            tier: 1,
            requirements: { capabilities: ['text'] },
            messages: [{ role: 'user', content: 'Analyze project architecture' }]
        });

        // 1. Result verification
        assert.equal(result.text, 'Response delivered safely by fallback provider');
        assert.notEqual(result.provider, 'groq', 'Result must come from fallback provider');
        assert.equal(result.attempts.length, 2, 'Must record exactly 2 attempts');

        // 2. Attempt 0: Primary failure inspection
        const attempt0 = result.attempts[0];
        assert.equal(attempt0.provider, 'groq');
        assert.equal(attempt0.status, 'FAILED');
        assert.equal(attempt0.error.category, ErrorCategory.SERVER_ERROR);
        assert.equal(attempt0.tokens.inputTokens, 0, 'Failed attempt must have 0 input tokens');
        assert.equal(attempt0.tokens.outputTokens, 0, 'Failed attempt must have 0 output tokens');

        // 3. Attempt 1: Fallback success inspection
        const attempt1 = result.attempts[1];
        assert.equal(attempt1.status, 'SUCCESS');
        assert.equal(attempt1.error, null);
        assert.equal(attempt1.tokens.inputTokens, 380);
        assert.equal(attempt1.tokens.outputTokens, 140);

        // 4. Reconciliation summary verification (CRITICAL: ZERO TOKEN DOUBLE-COUNTING)
        const recon = result.reconciliation;
        assert.equal(recon.totalApiCalls, 2, 'Total API calls must accurately reflect both attempts (2)');
        assert.equal(recon.failedCalls, 1, 'Failed calls must be 1');
        assert.equal(recon.successfulCalls, 1, 'Successful calls must be 1');
        assert.equal(recon.actualInputTokens, 380, 'Actual input tokens must NOT be double-counted or multiplied');
        assert.equal(recon.actualOutputTokens, 140, 'Actual output tokens must NOT be double-counted or multiplied');
        assert.equal(recon.actualTotalTokens, 520, 'Total tokens must equal input + output');
        assert.ok(recon.totalLatencyMs >= 0);
    });

    await t.test('3.2: Reconciling failover payload into BudgetManager preserves ledger balance', async () => {
        const budget = new BudgetManager();
        const manager = new ProviderHealthManager({ skipEnvCheck: true });

        // Create standard runtime scope
        const scope = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const initialRemaining = budget.getRemaining(scope.scopeId);

        // Step 1: Pre-request reservation for failover task
        const resId = budget.reserve(scope.scopeId, {
            estimatedInputTokens: 800,
            estimatedOutputTokens: 300,
            modelTier: 'TIER_1'
        });

        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 1);
        assert.equal(budget.getScopeInstance(scope.scopeId).reserved.inputTokens, 800);

        // Step 2: Execute with failover
        const mockExecute = async (candidate) => {
            if (candidate.provider === 'groq') {
                const err = new Error('429 Rate Limit');
                err.status = 429;
                throw err;
            }
            return {
                text: 'Success on secondary',
                model: candidate.model,
                reportedTokens: { inputTokens: 450, outputTokens: 180, totalTokens: 630 }
            };
        };

        const execResult = await manager.executeWithFailover('Query', mockExecute, { tier: 1 });

        // Step 3: Atomic Reconciliation using execResult.reconciliation
        const reconPayload = execResult.reconciliation;
        const reconResult = budget.reconcile(scope.scopeId, resId, {
            actualInputTokens: reconPayload.actualInputTokens,
            actualOutputTokens: reconPayload.actualOutputTokens,
            latencyMs: reconPayload.totalLatencyMs,
            provider: execResult.provider,
            model: execResult.model
        });

        // 4. Verify ledger state
        const scopeAfterRecon = budget.getScope(scope.scopeId);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 0, 'In-flight reservation hold must be released');
        assert.equal(budget.getScopeInstance(scope.scopeId).reserved.inputTokens, 0, 'Held input tokens must be released');
        assert.equal(scopeAfterRecon.consumed.inputTokens, 450, 'Consumed tokens must exactly match actual');
        assert.equal(scopeAfterRecon.consumed.outputTokens, 180);
        assert.equal(scopeAfterRecon.consumed.apiCalls, 1);

        const currentRemaining = budget.getRemaining(scope.scopeId);
        assert.equal(
            currentRemaining.inputTokens,
            initialRemaining.inputTokens - 450,
            'Remaining input tokens must be decremented by exactly actual usage'
        );

        budget.destroy();
    });

    await t.test('3.3: Context normalization preserves messages without overflow for small context windows', () => {
        const manager = new ProviderHealthManager({ skipEnvCheck: true });

        const messages = [
            { role: 'system', content: 'Doctrine: strict compliance' },
            { role: 'user', content: 'Turn 1' },
            { role: 'assistant', content: 'Reply 1' },
            { role: 'user', content: 'Turn 2' },
            { role: 'assistant', content: 'Reply 2' },
            { role: 'user', content: 'Turn 3' },
            { role: 'assistant', content: 'Reply 3' },
            { role: 'user', content: 'Turn 4' },
            { role: 'assistant', content: 'Reply 4' },
            { role: 'user', content: 'Turn 5' },
            { role: 'assistant', content: 'Reply 5' }
        ];

        // Provider with small context window (8192 tokens)
        const normalized = manager.preserveAndNormalizeContext(messages, 8192);
        assert.equal(normalized.length, 5, 'Must keep system message + last 4 turns');
        assert.equal(normalized[0].role, 'system', 'System doctrine message must be preserved');
        assert.equal(normalized[normalized.length - 1].content, 'Reply 5', 'Latest message must be preserved');

        // Provider with large context window (131072 tokens)
        const unpruned = manager.preserveAndNormalizeContext(messages, 131072);
        assert.equal(unpruned.length, 11, 'All messages preserved for large context window');
    });

    await t.test('3.4: Non-retryable SAFETY_BLOCK terminates failover immediately without cascading', async () => {
        const manager = new ProviderHealthManager({ skipEnvCheck: true });

        let invocationCount = 0;
        const mockExecute = async () => {
            invocationCount++;
            const err = new Error('Blocked by safety policy');
            err.status = 400;
            throw err;
        };

        await assert.rejects(
            () => manager.executeWithFailover('Unsafe Prompt', mockExecute, { tier: 1 }),
            (err) => {
                assert.ok(err.isProviderExhaustion);
                assert.equal(invocationCount, 1, 'Must abort immediately after 1 attempt on safety block');
                assert.equal(err.attempts[0].error.category, ErrorCategory.SAFETY_BLOCK);
                return true;
            }
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE 4: CONCURRENCY LIMIT BOUNDS (RESERVATION & SUB-AGENT)
// ─────────────────────────────────────────────────────────────────────────────
test('Empirical Probe 4 - Concurrency Limit Bounds Enforcement', async (t) => {
    await t.test('4.1: Reservation concurrency rejects requests exceeding maxConcurrentRequests', () => {
        const budget = new BudgetManager();

        // Create scope with explicit maxConcurrentRequests: 2 and ample apiCalls
        const scope = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, {
            profile: 'micro',
            customLimits: { maxConcurrentRequests: 2, maxApiCalls: 10, maxInputTokens: 50000, maxOutputTokens: 20000 }
        });

        assert.equal(budget.getScope(scope.scopeId).limits.maxConcurrentRequests, 2);

        // Reservation 1: Should succeed
        const res1 = budget.reserve(scope.scopeId, { estimatedInputTokens: 200, estimatedOutputTokens: 100 });
        assert.ok(res1);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 1);

        // Reservation 2: Should succeed
        const res2 = budget.reserve(scope.scopeId, { estimatedInputTokens: 200, estimatedOutputTokens: 100 });
        assert.ok(res2);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 2);

        // Reservation 3: Exceeds maxConcurrentRequests (2) -> MUST throw ConcurrencyLimitExceededError
        assert.throws(
            () => budget.reserve(scope.scopeId, { estimatedInputTokens: 200, estimatedOutputTokens: 100 }),
            (err) => {
                assert.ok(err instanceof ConcurrencyLimitExceededError);
                assert.equal(err.details.current, 2);
                assert.equal(err.details.max, 2);
                assert.equal(err.details.scopeId, scope.scopeId);
                return true;
            },
            'Reservation 3 must be rejected when active reservations == maxConcurrentRequests'
        );

        // Reconcile Reservation 1: active count drops to 1
        budget.reconcile(scope.scopeId, res1, { actualInputTokens: 150, actualOutputTokens: 80 });
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 1);

        // Reservation 3 attempt NOW succeeds
        const res3 = budget.reserve(scope.scopeId, { estimatedInputTokens: 200, estimatedOutputTokens: 100 });
        assert.ok(res3);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 2);

        // Cancel Reservation 2: active count drops to 1
        budget.cancelReservation(scope.scopeId, res2, 'Cancelled test reservation');
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 1);

        // Reservation 4 attempt NOW succeeds
        const res4 = budget.reserve(scope.scopeId, { estimatedInputTokens: 200, estimatedOutputTokens: 100 });
        assert.ok(res4);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 2);

        budget.destroy();
    });

    await t.test('4.2: Sub-agent concurrent delegation limit (max 2) is strictly enforced in runtime', () => {
        const budget = new BudgetManager();
        const parent = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });

        // Delegate child 1: succeeds (1 active)
        const child1 = budget.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
        });
        assert.ok(child1);
        assert.equal(child1.status, SCOPE_STATUS.ACTIVE);

        // Delegate child 2: succeeds (2 active)
        const child2 = budget.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
        });
        assert.ok(child2);
        assert.equal(child2.status, SCOPE_STATUS.ACTIVE);

        // Delegate child 3: Exceeds maxConcurrentSubAgents (2) -> MUST throw ConcurrencyLimitExceededError
        assert.throws(
            () => budget.createChildScope(parent.scopeId, {
                budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
            }),
            (err) => {
                assert.ok(err instanceof ConcurrencyLimitExceededError);
                assert.equal(err.details.current, 2);
                assert.equal(err.details.max, 2);
                return true;
            },
            'Attempting to spawn a 3rd concurrent sub-agent must throw ConcurrencyLimitExceededError'
        );

        // Complete child 1: active sub-agents drops to 1
        budget.completeScope(child1.scopeId);
        assert.equal(budget.getScope(child1.scopeId).status, SCOPE_STATUS.COMPLETED);

        // Spawning child 3 NOW succeeds (cumulative count 3 <= maxSubAgentsPerTask 3)
        const child3 = budget.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
        });
        assert.ok(child3);
        assert.equal(child3.status, SCOPE_STATUS.ACTIVE);

        // Complete child 2: active drops to 1, but cumulative children is now 3
        budget.completeScope(child2.scopeId);

        // Spawning child 4: Exceeds cumulative maxSubAgentsPerTask (3) -> MUST throw SubAgentDelegationError
        assert.throws(
            () => budget.createChildScope(parent.scopeId, {
                budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 }
            }),
            (err) => {
                assert.ok(err instanceof SubAgentDelegationError);
                assert.ok(err.message.includes('Max sub-agents limit'));
                return true;
            },
            'Attempting to spawn a 4th cumulative sub-agent must throw SubAgentDelegationError'
        );

        budget.destroy();
    });
});
