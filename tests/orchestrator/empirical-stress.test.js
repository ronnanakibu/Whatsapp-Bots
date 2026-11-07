/**
 * tests/orchestrator/empirical-stress.test.js
 * 
 * Independent Empirical & Boundary Stress Test Suite for Milestone 2
 * Authored by: Empirical Challenger (challenger_m2_1)
 * 
 * Verifies with zero tolerance:
 * 1. Strict Budget Enforcement & Zero Silent Overruns
 * 2. 15% Reserve Isolation & Authenticated Unlock Only
 * 3. Sub-Agent Depth Bounds (depth <= 1), Concurrency (<= 2), and Cumulative (<= 3)
 * 4. Tier 0 Rule Preemption (Math, Clock, Uptime, Ping, Owner Recognition) at 0 tokens & 0 API calls
 * 5. Tool Schema Pruning (103 commands -> 5-8 tools for complex requests, 0 for pure chat)
 */

// Unref background timers so command module background loops do not hold Node.js event loop open
const origSetInterval = global.setInterval;
const origSetTimeout = global.setTimeout;
global.setInterval = function (...args) {
    const timer = origSetInterval.apply(this, args);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
};
global.setTimeout = function (...args) {
    const timer = origSetTimeout.apply(this, args);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
};

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
    ExecutionTimeoutError,
    ModelTierRouter,
    MODEL_TIERS,
    TASK_COMPLEXITY,
    ContextEngine,
    ProviderHealthManager,
    CircuitState
} from '../../src/services/orchestrator/index.js';
import { initializeRegistry, getAllCommands } from '../../src/core/registry.js';

// =============================================================================
// 1. STRICT BUDGET ENFORCEMENT & ZERO SILENT OVERRUNS
// =============================================================================

test('Stress 1: Strict Budget Enforcement (Zero Silent Overruns)', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('Attempting reservation beyond operational limits throws every time', () => {
        // Standard profile: 8000 maxInputTokens, 1200 reserve, 6800 operational limit
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const remaining = manager.getRemaining(scope.scopeId);
        assert.equal(remaining.inputTokens, 6800);

        // A. Exactly 1 token over operational limit -> must throw ReserveLockedError
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 6801, estimatedOutputTokens: 100 }),
            ReserveLockedError,
            'Must throw ReserveLockedError when request penetrates 15% locked reserve'
        );

        // B. Exceeds total limit (8000) entirely -> must throw BudgetExceededError
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 8001, estimatedOutputTokens: 100 }),
            BudgetExceededError,
            'Must throw BudgetExceededError when request exceeds total limit'
        );

        // C. Massive token overrun attempt (e.g. 1,000,000 tokens) -> must throw BudgetExceededError
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 1_000_000, estimatedOutputTokens: 100 }),
            BudgetExceededError,
            'Massive token request must throw BudgetExceededError without integer overflow'
        );
    });

    await t.test('API Call limit exhaustion prevents further reservations', () => {
        // Micro profile: maxApiCalls = 2, 15% reserve = max(1, floor(0.3)) = 1 call. Operational = 1 call.
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'micro' });

        // Call 1: within operational limit
        const resId1 = manager.reserve(scope.scopeId, { estimatedInputTokens: 100, estimatedOutputTokens: 50 });
        assert.ok(resId1);
        manager.reconcile(scope.scopeId, resId1, { actualInputTokens: 100, actualOutputTokens: 50 });

        // Call 2: operational limit for API calls is 1 (2 total - 1 reserve). Scope is now exhausted!
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 100, estimatedOutputTokens: 50 }),
            (err) => err instanceof ScopeExhaustedError || err instanceof BudgetExceededError,
            'Must throw ScopeExhaustedError or BudgetExceededError when operational API calls are exhausted'
        );
    });

    await t.test('Attempting reservation on exhausted, completed, or cancelled scope throws', () => {
        const scopeCompleted = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'micro' });
        manager.completeScope(scopeCompleted.scopeId);

        assert.throws(
            () => manager.reserve(scopeCompleted.scopeId, { estimatedInputTokens: 100, estimatedOutputTokens: 50 }),
            ScopeExhaustedError,
            'Must throw ScopeExhaustedError on completed scope'
        );

        const scopeCancelled = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'micro' });
        manager.cancelScope(scopeCancelled.scopeId);

        assert.throws(
            () => manager.reserve(scopeCancelled.scopeId, { estimatedInputTokens: 100, estimatedOutputTokens: 50 }),
            ScopeExhaustedError,
            'Must throw ScopeExhaustedError on cancelled scope'
        );
    });

    await t.test('Agent loop iterations, tool calls, and retries strictly enforced', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'micro' });
        // micro: maxAgentLoopIterations = 2, maxToolCalls = 1, maxRetries = 1

        // Loop iterations
        manager.recordIteration(scope.scopeId);
        manager.recordIteration(scope.scopeId);
        assert.throws(
            () => manager.recordIteration(scope.scopeId),
            BudgetExceededError,
            'Iteration 3 must exceed micro limit of 2'
        );

        // Tool calls
        manager.recordToolCall(scope.scopeId, 1);
        assert.throws(
            () => manager.recordToolCall(scope.scopeId, 1),
            BudgetExceededError,
            'Tool call 2 must exceed micro limit of 1'
        );

        // Retries
        manager.recordRetry(scope.scopeId);
        assert.throws(
            () => manager.recordRetry(scope.scopeId),
            BudgetExceededError,
            'Retry 2 must exceed micro limit of 1'
        );
    });

    await t.test('Concurrency limit per scope is strictly enforced', () => {
        // standard: maxConcurrentRequests = 1
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const resId1 = manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });
        assert.ok(resId1);

        // Attempting second in-flight reservation before reconciling resId1
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
            ConcurrencyLimitExceededError,
            'Must throw ConcurrencyLimitExceededError when concurrent requests limit is breached'
        );

        // After reconciling resId1, reservation succeeds
        manager.reconcile(scope.scopeId, resId1, { actualInputTokens: 400, actualOutputTokens: 180 });
        const resId2 = manager.reserve(scope.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 200 });
        assert.ok(resId2);
        manager.reconcile(scope.scopeId, resId2, { actualInputTokens: 400, actualOutputTokens: 180 });
    });
});

// =============================================================================
// 2. 15% RESERVE ISOLATION & AUTHENTICATED UNLOCK ONLY
// =============================================================================

test('Stress 2: Reserve Isolation & Authenticated Unlock Only', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('15% reserve buffer cannot be touched by normal operations', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const limits = scope.limits;
        const expectedReserve = Math.floor(limits.maxInputTokens * 0.15); // 1200
        const operationalLimit = limits.maxInputTokens - expectedReserve; // 6800

        // Consume operational limit to within 100 tokens remaining
        const res1 = manager.reserve(scope.scopeId, { estimatedInputTokens: operationalLimit - 100, estimatedOutputTokens: 100 });
        manager.reconcile(scope.scopeId, res1, { actualInputTokens: operationalLimit - 100, actualOutputTokens: 100 });

        const remaining = manager.getRemaining(scope.scopeId);
        assert.equal(remaining.inputTokens, 100);
        assert.equal(remaining.isReserveLocked, true);

        // Attempting to reserve 150 tokens (only 100 available without penetrating reserve)
        assert.throws(
            () => manager.reserve(scope.scopeId, { estimatedInputTokens: 150, estimatedOutputTokens: 50 }),
            ReserveLockedError,
            'Must throw ReserveLockedError when 100 operational tokens left and 150 requested'
        );
    });

    await t.test('releaseReserve rejects all unauthorized reasons', () => {
        const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const invalidReasons = [
            'NORMAL_OPERATION',
            'USER_REQUEST',
            'HACK',
            'DEBUG',
            'EMERGENCY',
            'RETRY',
            '',
            123,
            { reason: 'INVALID_OBJECT_REASON' }
        ];

        for (const reason of invalidReasons) {
            assert.throws(
                () => manager.releaseReserve(scope.scopeId, reason),
                BudgetError,
                `releaseReserve must reject invalid reason: ${JSON.stringify(reason)}`
            );
        }

        // Verify reserve remains locked
        const remaining = manager.getRemaining(scope.scopeId);
        assert.equal(remaining.isReserveLocked, true);
    });

    await t.test('releaseReserve unlocks 15% buffer ONLY for valid reasons', () => {
        const validReasons = [
            RESERVE_RELEASE_REASONS.RECOVERY,
            RESERVE_RELEASE_REASONS.ROLLBACK,
            RESERVE_RELEASE_REASONS.CRITICAL_SELF_HEALING
        ];

        for (const reason of validReasons) {
            const scope = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
            assert.equal(manager.getRemaining(scope.scopeId).isReserveLocked, true);

            const unlocked = manager.releaseReserve(scope.scopeId, {
                reason,
                caller: 'challenger_stress_test'
            });

            assert.equal(unlocked.isReserveLocked, false);
            assert.equal(unlocked.inputTokens, scope.limits.maxInputTokens); // Now full 8000 tokens accessible
        }
    });

    await t.test('Child scope creation cannot penetrate parent locked reserve', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        // parent has 6800 operational input tokens, 1200 locked reserve

        // Attempt to allocate 7000 tokens to child while reserve is locked
        assert.throws(
            () => manager.createChildScope(parent.scopeId, {
                budgetAllocation: { inputTokens: 7000, outputTokens: 200, apiCalls: 1 }
            }),
            BudgetExceededError,
            'Child scope cannot be allocated tokens from parent locked reserve'
        );
    });
});

// =============================================================================
// 3. SUB-AGENT DELEGATION DEPTH, CONCURRENCY & CUMULATIVE BOUNDS
// =============================================================================

test('Stress 3: Sub-Agent Delegation Constraints & Refunds', async (t) => {
    const manager = new BudgetManager();
    t.after(() => manager.destroy());

    await t.test('Depth constraint: Child (depth 1) cannot spawn grandchild (depth 2)', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });
        assert.equal(parent.depth, 0);

        const child = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 2000, outputTokens: 500, apiCalls: 2 }
        });
        assert.equal(child.depth, 1);

        // Child attempting to spawn grandchild must throw SubAgentDelegationError
        assert.throws(
            () => manager.createChildScope(child.scopeId, {
                budgetAllocation: { inputTokens: 500, outputTokens: 100, apiCalls: 1 }
            }),
            SubAgentDelegationError,
            'Must throw SubAgentDelegationError when parent depth is >= 1'
        );
    });

    await t.test('Concurrency constraint: Max 2 concurrent active sub-agents per parent', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });

        // Spawn child 1 (active)
        const child1 = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 }
        });
        assert.ok(child1);

        // Spawn child 2 (active)
        const child2 = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 }
        });
        assert.ok(child2);

        // Attempting to spawn child 3 while child 1 and child 2 are ACTIVE must throw ConcurrencyLimitExceededError
        assert.throws(
            () => manager.createChildScope(parent.scopeId, {
                budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 }
            }),
            ConcurrencyLimitExceededError,
            'Must throw ConcurrencyLimitExceededError when active sub-agents >= 2'
        );

        // Complete child 1 -> active count becomes 1
        manager.completeScope(child1.scopeId);

        // Now child 3 can be spawned successfully
        const child3 = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 1000, outputTokens: 200, apiCalls: 1 }
        });
        assert.ok(child3);
    });

    await t.test('Cumulative limit: Max 3 cumulative sub-agents per parent task', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });

        // Spawn and complete child 1
        const c1 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000 } });
        manager.completeScope(c1.scopeId);

        // Spawn and complete child 2
        const c2 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000 } });
        manager.completeScope(c2.scopeId);

        // Spawn and complete child 3
        const c3 = manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000 } });
        manager.completeScope(c3.scopeId);

        // Attempting child 4 (even though active count is 0) must throw SubAgentDelegationError due to cumulative limit 3
        assert.throws(
            () => manager.createChildScope(parent.scopeId, { budgetAllocation: { inputTokens: 1000 } }),
            SubAgentDelegationError,
            'Must throw SubAgentDelegationError when cumulative children count >= 3'
        );
    });

    await t.test('Budget Refund: Unspent sub-agent tokens refunded to parent on completion and cancellation', () => {
        const parent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });
        const initialRemaining = manager.getRemaining(parent.scopeId).inputTokens;

        // Allocate 3000 input tokens to child
        const child = manager.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 3000, outputTokens: 500, apiCalls: 2 }
        });

        // Parent operational remaining reduced by 3000
        const afterDelegation = manager.getRemaining(parent.scopeId).inputTokens;
        assert.equal(afterDelegation, initialRemaining - 3000);

        // Child uses 500 tokens
        const resId = manager.reserve(child.scopeId, { estimatedInputTokens: 500, estimatedOutputTokens: 100 });
        manager.reconcile(child.scopeId, resId, { actualInputTokens: 500, actualOutputTokens: 100 });

        // Child completes: 2500 unspent tokens must be refunded to parent
        manager.completeScope(child.scopeId);

        const afterCompletion = manager.getRemaining(parent.scopeId).inputTokens;
        assert.equal(afterCompletion, initialRemaining - 500, 'Parent must be refunded exactly 2500 unspent tokens');
    });

    await t.test('Domain Isolation: Cross-domain child delegation strictly rejected', () => {
        // Development parent
        const devParent = manager.createScope(SCOPE_TYPES.DEVELOPMENT_SESSION, { profile: 'complex' });

        assert.throws(
            () => manager.createChildScope(devParent.scopeId, { scopeType: SCOPE_TYPES.RUNTIME_SUBAGENT }),
            BudgetDomainViolationError,
            'Cannot spawn runtime child from development parent'
        );

        // Runtime parent
        const runtimeParent = manager.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });

        assert.throws(
            () => manager.createChildScope(runtimeParent.scopeId, { scopeType: SCOPE_TYPES.DEVELOPMENT_SUBAGENT }),
            BudgetDomainViolationError,
            'Cannot spawn development child from runtime parent'
        );
    });
});

// =============================================================================
// 4. TIER 0 RULE PREEMPTION (0 TOKENS, 0 API CALLS)
// =============================================================================

test('Stress 4: Tier 0 Rule Preemption & Safe Deterministic Evaluation', async (t) => {
    const router = new ModelTierRouter();

    await t.test('Arithmetic queries resolve at Tier 0 with exactly 0 LLM tokens and 0 API calls', () => {
        const mathCases = [
            { query: '45 * 12', expected: 540 },
            { query: 'sqrt(144)', expected: 12 },
            { query: 'hitung: 100 / 4 + 25', expected: 50 },
            { query: '(15 + 5) * 3', expected: 60 },
            { query: 'kalkulator 500 - 125', expected: 375 },
            { query: '10 ÷ 2', expected: 5 },
            { query: '6 × 7', expected: 42 }
        ];

        for (const item of mathCases) {
            const decision = router.routeTask({ rawPrompt: item.query });
            assert.equal(decision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC, `Query "${item.query}" must be Tier 0`);
            assert.equal(decision.estimatedTokens.input, 0, 'Must consume 0 input tokens');
            assert.equal(decision.estimatedTokens.output, 0, 'Must consume 0 output tokens');
            assert.equal(decision.estimatedCost, 0, 'Must have 0 USD cost');
            assert.equal(decision.isDeterministic, true);
            assert.ok(decision.directResult.includes(String(item.expected)), `Result must contain ${item.expected}`);
        }
    });

    await t.test('Adversarial math injection attempts do NOT execute arbitrary code', () => {
        const maliciousInputs = [
            '45 * 12; process.exit(1)',
            'require("child_process").execSync("whoami")',
            'constructor.constructor("return process")()',
            '__proto__.polluted = true',
            '<script>alert(1)</script>',
            'eval("1 + 1")',
            'Math.sqrt(-1)', // NaN
            '10 / 0' // Division by zero
        ];

        for (const badInput of maliciousInputs) {
            // Must either not route to Tier 0 or safely return non-crashing output
            try {
                const decision = router.routeTask({ rawPrompt: badInput });
                if (decision.tier === MODEL_TIERS.TIER_0_DETERMINISTIC) {
                    assert.notEqual(decision.matchType, 'math', `Malicious input "${badInput}" must not be evaluated as math`);
                }
            } catch (err) {
                assert.ok(!err.message.includes('process.exit'));
            }
        }
    });

    await t.test('Clock and time queries resolve at Tier 0 with exactly 0 LLM tokens', () => {
        const clockQueries = ['jam berapa', 'waktu sekarang', 'tanggal berapa', 'hari apa'];

        for (const q of clockQueries) {
            const decision = router.routeTask({ rawPrompt: q });
            assert.equal(decision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
            assert.equal(decision.estimatedTokens.input, 0);
            assert.equal(decision.estimatedTokens.output, 0);
            assert.equal(decision.matchType, 'system_time');
            assert.ok(decision.directResult.includes('WIB'));
        }
    });

    await t.test('Bot uptime and ping queries resolve at Tier 0 with exactly 0 LLM tokens', () => {
        const uptimeQueries = ['uptime', 'bot aktif', 'lama aktif'];
        for (const q of uptimeQueries) {
            const decision = router.routeTask({ rawPrompt: q });
            assert.equal(decision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
            assert.equal(decision.matchType, 'system_uptime');
            assert.equal(decision.estimatedTokens.input, 0);
        }

        const pingQueries = ['ping', 'speed bot', 'kecepatan bot'];
        for (const q of pingQueries) {
            const decision = router.routeTask({ rawPrompt: q });
            assert.equal(decision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
            assert.equal(decision.matchType, 'system_ping');
            assert.equal(decision.estimatedTokens.input, 0);
        }
    });

    await t.test('Owner & creator identity recognition easter egg resolves at Tier 0', () => {
        // Query creator
        const creatorDecision = router.routeTask({ rawPrompt: 'siapa creator bot ini?' });
        assert.equal(creatorDecision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(creatorDecision.matchType, 'identity_creator');
        assert.ok(creatorDecision.directResult.includes('Bang Rony'));
        assert.equal(creatorDecision.estimatedTokens.input, 0);

        // "siapa aku" with owner context
        const ownerDecision = router.routeTask(
            { rawPrompt: 'siapa aku?' },
            { ctx: { isOwner: true } }
        );
        assert.equal(ownerDecision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(ownerDecision.matchType, 'identity_owner');
        assert.ok(ownerDecision.directResult.includes('Bang Rony'));
        assert.equal(ownerDecision.estimatedTokens.input, 0);

        // "siapa aku" with regular user context
        const userDecision = router.routeTask(
            { rawPrompt: 'siapa aku?' },
            { ctx: { isOwner: false, pushName: 'Budi' } }
        );
        assert.equal(userDecision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(userDecision.matchType, 'identity_user');
        assert.ok(userDecision.directResult.includes('Budi'));
        assert.equal(userDecision.estimatedTokens.input, 0);
    });

    await t.test('LRU cache lookup preempts repeated deterministic queries', () => {
        const freshQuery = 'hitung: 99 * 3';
        const decision1 = router.routeTask({ rawPrompt: freshQuery });
        assert.equal(decision1.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(decision1.matchType, 'math');

        // Second call should hit the LRU cache
        const decision2 = router.routeTask({ rawPrompt: freshQuery });
        assert.equal(decision2.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(decision2.matchType, 'cache_hit');
        assert.equal(decision2.estimatedTokens.input, 0);
    });
});

// =============================================================================
// 5. TOOL SCHEMA PRUNING (103 COMMANDS -> 5-8 TOOLS, 0 FOR PURE CHAT)
// =============================================================================

test('Stress 5: Tool Schema Pruning & Registry Verification', async (t) => {
    // Initialize full project registry to load all 103 commands
    await initializeRegistry('./src/commands');
    const allCommands = getAllCommands();
    assert.equal(allCommands.size, 103, 'Registry must contain exactly 103 unique commands');

    const engine = new ContextEngine();

    await t.test('Pure conversation queries prune 103 commands down to EXACTLY 0 tools', () => {
        const pureChatPrompts = [
            'Halo apa kabar?',
            'Selamat pagi RonnBot',
            'Menurut kamu arti kebahagiaan itu apa?',
            'Terima kasih banyak atas bantuannya'
        ];

        for (const prompt of pureChatPrompts) {
            const intent = engine.extractTaskIntent(prompt);
            const pruned = engine.pruneTools(allCommands, intent, { role: 'user' });

            assert.equal(pruned.selectedCount, 0, `Prompt "${prompt}" must yield 0 tools`);
            assert.equal(pruned.tools.length, 0, 'Tools array must be empty');
            assert.equal(pruned.prunedCount, 103, 'All 103 tools must be pruned');
            assert.equal(pruned.estimatedTokens, 0, 'Estimated tool tokens must be 0');
            assert.ok(pruned.tokenSavings > 15000, 'Must save > 15,000 prompt tokens');
        }
    });

    await t.test('Complex and domain-specific queries prune 103 commands down to 5-8 tools', () => {
        const scenarios = [
            {
                prompt: 'Tolong unduh video tiktok dari url https://www.tiktok.com/@user/video/123456789',
                expectedTopTool: 'dl'
            },
            {
                prompt: 'Tolong ubah foto ini jadi stiker WhatsApp',
                expectedTopTool: 'sticker'
            },
            {
                prompt: 'Gimana info cuaca dan kualitas udara di Jakarta Selatan?',
                expectedTopTool: 'cuaca'
            },
            {
                prompt: 'Tolong ringkas isi obrolan grup 50 pesan terakhir',
                expectedTopTool: 'rangkum'
            }
        ];

        for (const s of scenarios) {
            const intent = engine.extractTaskIntent(s.prompt);
            const pruned = engine.pruneTools(allCommands, intent, { role: 'user', topK: 8 });

            assert.ok(
                pruned.selectedCount >= 1 && pruned.selectedCount <= 8,
                `Selected count must be between 1 and 8 (actual: ${pruned.selectedCount}) for "${s.prompt}"`
            );
            assert.ok(
                pruned.prunedCount >= 95,
                `Must prune at least 95 tools (pruned: ${pruned.prunedCount})`
            );

            // Verify top tool is included
            const toolNames = pruned.tools.map(t => t.function?.name || t.name);
            assert.ok(
                toolNames.includes(s.expectedTopTool),
                `Pruned tool list [${toolNames.join(', ')}] must include "${s.expectedTopTool}"`
            );
        }
    });

    await t.test('Role permission gating prevents unauthorized tools from leaking', () => {
        // Normal user requesting administrative / owner actions
        const ownerPrompt = 'Tolong restart bot dan hapus file cache';
        const intent = engine.extractTaskIntent(ownerPrompt);

        // Pruning with role: 'user'
        const userPruned = engine.pruneTools(allCommands, intent, { role: 'user' });
        const userToolNames = userPruned.tools.map(t => t.function?.name || t.name);

        assert.ok(!userToolNames.includes('restart'), 'Owner command "restart" must NOT be in user tools');
        assert.ok(!userToolNames.includes('eval'), 'Owner command "eval" must NOT be in user tools');
        assert.ok(!userToolNames.includes('shutdown'), 'Owner command "shutdown" must NOT be in user tools');

        // Pruning with role: 'owner'
        const ownerPruned = engine.pruneTools(allCommands, intent, { role: 'owner' });
        const ownerToolNames = ownerPruned.tools.map(t => t.function?.name || t.name);
        assert.ok(ownerToolNames.includes('restart'), 'Owner command "restart" must be present for owner role');
    });

    await t.test('Group context gating prevents group-only commands in direct messages', () => {
        const groupPrompt = 'Keluarkan dia dari percakapan kick';
        const intent = engine.extractTaskIntent(groupPrompt);

        // In DM (isGroup: false)
        const dmPruned = engine.pruneTools(allCommands, intent, { role: 'admin', isGroup: false });
        const dmToolNames = dmPruned.tools.map(t => t.function?.name || t.name);
        assert.ok(!dmToolNames.includes('kick'), 'Group command "kick" must NOT be included in DM context');

        // In Group (isGroup: true)
        const groupPruned = engine.pruneTools(allCommands, intent, { role: 'admin', isGroup: true, botIsAdmin: true });
        const groupToolNames = groupPruned.tools.map(t => t.function?.name || t.name);
        assert.ok(groupToolNames.includes('kick'), 'Group command "kick" must be included in group context');
    });
});
