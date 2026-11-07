/**
 * tests/orchestrator/budgetManager.test.js
 * 
 * Comprehensive Unit Test Suite for BudgetManager & Dual-Scope Resource Governance
 * Tests:
 * - Dual-scope domain isolation (DEVELOPMENT vs RUNTIME)
 * - 5 concrete budget profiles & limits
 * - 15% recovery reserve locking & authorized release
 * - 7-step atomic reservation & reconciliation lifecycle
 * - Sub-agent delegation constraints (depth 1, max 3 cumulative, max 2 concurrent, refund on finish)
 * - Zero silent overruns & custom error types
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BudgetManager,
    SCOPE_DOMAINS,
    SCOPE_TYPES,
    SCOPE_STATUS,
    RESERVE_RELEASE_REASONS,
    BUDGET_PROFILES,
    BudgetError,
    BudgetExceededError,
    ScopeExhaustedError,
    ReserveLockedError,
    BudgetDomainViolationError,
    SubAgentDelegationError,
    ReservationNotFoundError,
    ConcurrencyLimitExceededError,
    ExecutionTimeoutError
} from '../../src/services/orchestrator/index.js';

test('BudgetManager - Dual-Scope Domain Isolation', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('correctly maps scopes to DEVELOPMENT and RUNTIME domains', () => {
        const devScope = manager.createScope(SCOPE_TYPES.DEVELOPMENT_SESSION);
        assert.equal(devScope.domain, SCOPE_DOMAINS.DEVELOPMENT);

        const runtimeScope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK);
        assert.equal(runtimeScope.domain, SCOPE_DOMAINS.RUNTIME);

        const selfHealingScope = manager.createScope(SCOPE_TYPES.SELF_HEALING_TASK);
        assert.equal(selfHealingScope.domain, SCOPE_DOMAINS.RUNTIME);
    });

    await t.test('rejects cross-domain child sub-agent delegation', () => {
        const devScope = manager.createScope(SCOPE_TYPES.DEVELOPMENT_SESSION, { profile: 'complex' });

        assert.throws(
            () => manager.createChildScope(devScope.scopeId, { scopeType: SCOPE_TYPES.RUNTIME_SUBAGENT }),
            BudgetDomainViolationError
        );
    });

    await t.test('global telemetry cleanly segregates by domain without co-mingling', () => {
        const devScope = manager.createScope(SCOPE_TYPES.DEVELOPMENT_SESSION, { profile: 'standard' });
        const resId = manager.reserve(devScope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });
        manager.reconcile(devScope.scopeId, resId, { actualInputTokens: 400, actualOutputTokens: 150 });

        const telemetry = manager.getGlobalTelemetry();
        assert.ok(telemetry.byDomain.development.inputTokens >= 400);
        assert.equal(telemetry.byDomain.runtime.inputTokens, 0);
    });
});

test('BudgetManager - 5 Concrete Budget Profiles & Configuration', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    for (const [profileName, profileSpec] of Object.entries(BUDGET_PROFILES)) {
        await t.test(`profile "${profileName}" instantiates with correct limits`, () => {
            const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: profileName });
            assert.equal(scope.limits.maxInputTokens, profileSpec.maxInputTokens);
            assert.equal(scope.limits.maxOutputTokens, profileSpec.maxOutputTokens);
            assert.equal(scope.limits.maxApiCalls, profileSpec.maxApiCalls);
            assert.equal(scope.limits.maxToolCalls, profileSpec.maxToolCalls);
            assert.equal(scope.limits.maxAgentLoopIterations, profileSpec.maxAgentLoopIterations);
            assert.equal(scope.limits.maxRetries, profileSpec.maxRetries);
            assert.equal(scope.limits.maxExecutionDurationMs, profileSpec.maxExecutionDurationMs);
            assert.equal(scope.limits.recoveryReservePercent, 0.15);
        });
    }

    await t.test('throws for unknown budget profile name', () => {
        assert.throws(
            () => manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'non-existent-profile' }),
            BudgetError
        );
    });
});

test('BudgetManager - 15% Recovery Reserve Mechanics', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('initial reserve is locked and prevents penetration', () => {
        // standard profile: 8000 max input tokens, 15% reserve = 1200 tokens, operational = 6800
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const remaining = manager.getRemaining(scope.scopeId);

        assert.equal(remaining.isReserveLocked, true);
        assert.equal(remaining.inputTokens, 6800);
        assert.equal(remaining.reserveBuffer.inputTokens, 1200);

        // Requesting 7000 tokens penetrates the 1200 reserve buffer -> must throw ReserveLockedError
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 7000, estimatedOutputTokens: 100 }),
            ReserveLockedError
        );
    });

    await t.test('releaseReserve rejects invalid reasons', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });

        assert.throws(
            () => manager.releaseReserve(scope.scopeId, 'UNAUTHORIZED_REASON'),
            BudgetError
        );
    });

    await t.test('releaseReserve unlocks 15% buffer for RECOVERY or ROLLBACK', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });

        // Unlocking with valid reason
        const unlockedRemaining = manager.releaseReserve(scope.scopeId, {
            reason: RESERVE_RELEASE_REASONS.RECOVERY,
            caller: 'self_healing_test'
        });

        assert.equal(unlockedRemaining.isReserveLocked, false);
        assert.equal(unlockedRemaining.inputTokens, 8000); // Now full 8000 available

        // Now 7000 token reservation must succeed without error
        const resId = manager.reserve(scope.scopeId, { estimatedInputTokens: 7000, estimatedOutputTokens: 100 });
        assert.ok(resId);
    });
});

test('BudgetManager - 7-Step Atomic Reservation & Reconciliation Lifecycle', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('estimates tokens accurately using multilingual heuristic', () => {
        const shortText = 'Halo apa kabar?';
        const estimated = manager.estimateTokens(shortText);
        assert.ok(estimated > 0 && estimated < 20);
    });

    await t.test('places atomic hold and reconciles actual usage', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const beforeRemaining = manager.getRemaining(scope.scopeId);

        // Step 4: Reserve hold
        const resId = manager.reserve(scope.scopeId, {
            estimatedInputTokens: 1000,
            estimatedOutputTokens: 500,
            modelTier: 'TIER_1',
            provider: 'groq'
        });

        const heldRemaining = manager.getRemaining(scope.scopeId);
        assert.equal(heldRemaining.inputTokens, beforeRemaining.inputTokens - 1000);
        assert.equal(heldRemaining.outputTokens, beforeRemaining.outputTokens - 500);
        assert.equal(heldRemaining.apiCalls, beforeRemaining.apiCalls - 1);

        // Step 6 & 7: Reconcile actual usage (actual: 800 input, 300 output)
        const result = manager.reconcile(scope.scopeId, resId, {
            actualInputTokens: 800,
            actualOutputTokens: 300,
            latencyMs: 420
        });

        assert.equal(result.actual.inputTokens, 800);
        assert.equal(result.actual.outputTokens, 300);
        assert.equal(result.deltaInput, -200); // 200 excess hold released
        assert.ok(result.costUsd > 0);

        const afterRemaining = manager.getRemaining(scope.scopeId);
        assert.equal(afterRemaining.inputTokens, beforeRemaining.inputTokens - 800);
        assert.equal(afterRemaining.outputTokens, beforeRemaining.outputTokens - 300);
    });

    await t.test('cancelling reservation restores held tokens', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const initialTokens = manager.getRemaining(scope.scopeId).inputTokens;

        const resId = manager.reserve(scope.scopeId, { estimatedInputTokens: 1500, estimatedOutputTokens: 500 });
        assert.equal(manager.getRemaining(scope.scopeId).inputTokens, initialTokens - 1500);

        const cancelled = manager.cancelReservation(scope.scopeId, resId, 'Abort pre-flight');
        assert.equal(cancelled, true);
        assert.equal(manager.getRemaining(scope.scopeId).inputTokens, initialTokens);
    });

    await t.test('reconciling unknown or already reconciled reservation throws', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const resId = manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });

        manager.reconcile(scope.scopeId, resId, { actualInputTokens: 400, actualOutputTokens: 150 });

        assert.throws(
            () => manager.reconcile(scope.scopeId, resId, { actualInputTokens: 400, actualOutputTokens: 150 }),
            ReservationNotFoundError
        );
    });
});

test('BudgetManager - Concurrency & Execution Limits', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('enforces max concurrent requests', () => {
        // standard profile has maxConcurrentRequests: 1
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const res1 = manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });

        // Second concurrent request must throw ConcurrencyLimitExceededError
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
            ConcurrencyLimitExceededError
        );

        // After reconciling res1, another request is permitted
        manager.reconcile(scope.scopeId, res1, { actualInputTokens: 500, actualOutputTokens: 200 });
        const res2 = manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });
        assert.ok(res2);
    });

    await t.test('enforces agent loop iteration and tool call limits', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'micro' }); // maxIterations: 2, maxToolCalls: 1

        manager.recordIteration(scope.scopeId);
        manager.recordIteration(scope.scopeId);
        assert.throws(() => manager.recordIteration(scope.scopeId), BudgetExceededError);

        manager.recordToolCall(scope.scopeId, 1);
        assert.throws(() => manager.recordToolCall(scope.scopeId, 1), BudgetExceededError);
    });
});

test('BudgetManager - Sub-Agent Delegation Constraints & Refunds', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('enforces max delegation depth 1', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });
        const child = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
        });

        // Child is at depth 1; child spawning another sub-agent must be rejected
        assert.throws(
            () => manager.createChildScope(child.scopeId, { budgetAllocation: { inputTokens: 500, outputTokens: 200, apiCalls: 1 } }),
            SubAgentDelegationError
        );
    });

    await t.test('enforces max 3 cumulative sub-agents per parent task', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'engineering' });

        const c1 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });
        manager.completeScope(c1.scopeId);

        const c2 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });
        manager.completeScope(c2.scopeId);

        const c3 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });
        manager.completeScope(c3.scopeId);

        // Attempting 4th child must throw SubAgentDelegationError
        assert.throws(
            () => manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } }),
            SubAgentDelegationError
        );
    });

    await t.test('enforces max 2 concurrent active sub-agents', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'engineering' });

        const c1 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });
        const c2 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });

        // 3rd concurrent active child must throw ConcurrencyLimitExceededError
        assert.throws(
            () => manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } }),
            ConcurrencyLimitExceededError
        );

        // Completing c1 frees a concurrent slot
        manager.completeScope(c1.scopeId);
        const c3 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 } });
        assert.ok(c3);
    });

    await t.test('refunds unspent child budget back to parent on completion', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });
        const initialParentInput = manager.getRemaining(parent.scopeId).inputTokens;

        // Allocate 3000 tokens to child
        const child = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 3000, outputTokens: 500, apiCalls: 2 }
        });

        // Parent remaining should reflect hold
        assert.equal(manager.getRemaining(parent.scopeId).inputTokens, initialParentInput - 3000);

        // Child spends only 1000 tokens
        const resId = manager.reserve(child.scopeId, { estimatedInputTokens: 1000, estimatedOutputTokens: 200 });
        manager.reconcile(child.scopeId, resId, { actualInputTokens: 1000, actualOutputTokens: 200 });

        // Child completes: 2000 unspent tokens must be refunded to parent
        manager.completeScope(child.scopeId);

        const finalParentInput = manager.getRemaining(parent.scopeId).inputTokens;
        assert.equal(finalParentInput, initialParentInput - 1000); // 2000 refunded, 1000 used
    });
});
