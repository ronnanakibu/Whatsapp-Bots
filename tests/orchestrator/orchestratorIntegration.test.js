/**
 * tests/orchestrator/orchestratorIntegration.test.js
 * 
 * Master End-to-End Integration Test Suite for Milestone 2 Orchestration
 * Verifies the seamless, cohesive interaction of:
 * - config.js (Profiles & Domains)
 * - budgetManager.js (7-Step Lifecycle & Reserve Buffer)
 * - providerHealth.js (Circuit Breaker & Intelligent Failover)
 * - modelTierRouter.js (Tier 0-3 Routing & Escalation)
 * - contextEngine.js (Intent Extraction & Tool Pruning)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BudgetManager,
    ProviderHealthManager,
    ModelTierRouter,
    ContextEngine,
    SCOPE_DOMAINS,
    SCOPE_TYPES,
    SCOPE_STATUS,
    MODEL_TIERS,
    RESERVE_RELEASE_REASONS,
    CircuitState
} from '../../src/services/orchestrator/index.js';

test('Orchestrator Integration - End-to-End Autonomous Request Lifecycle', async (t) => {
    const budget = new BudgetManager();
    const health = new ProviderHealthManager({ skipEnvCheck: true });
    const router = new ModelTierRouter();
    const context = new ContextEngine();

    t.after(() => budget.destroy());

    // Mock command registry
    const registryTools = [
        { name: 'dl', category: 'downloader', description: 'Download media from URL', permissions: ['user'], enabled: true, usage: '.dl <url>' },
        { name: 'cuaca', category: 'tools', description: 'Cek cuaca kota', permissions: ['user'], enabled: true, usage: '.cuaca <kota>' },
        { name: 'ping', category: 'tools', description: 'Cek ping bot', permissions: ['user'], enabled: true, usage: '.ping' },
        { name: 'kick', category: 'group', description: 'Kick member grup', permissions: ['admin'], enabled: true, usage: '.kick @user' }
    ];

    await t.test('Tier 0 request resolves with 0 LLM tokens and 0 API calls', async () => {
        const scope = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const userPrompt = 'hitung 15 * 8 + 30';

        // Intent & Routing
        const intent = context.extractTaskIntent(userPrompt);
        const decision = router.routeTask(intent, { budgetScope: scope, providerHealth: health });

        assert.equal(decision.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
        assert.equal(decision.isDeterministic, true);
        assert.equal(decision.estimatedTokens.input, 0);
        assert.equal(decision.estimatedTokens.output, 0);
        assert.ok(decision.directResult.includes('150'));

        // Zero reservations needed; complete scope
        budget.completeScope(scope.scopeId);
        const telemetry = budget.getTelemetry(scope.scopeId);
        assert.equal(telemetry.consumed.inputTokens, 0);
        assert.equal(telemetry.consumed.apiCalls, 0);
    });

    await t.test('Tier 1 request executes full 7-step lifecycle with tool pruning and reconciliation', async () => {
        // Step 1: Create scope
        const scope = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'standard' });
        const userPrompt = 'bagaimana cara unduh video tiktok yang aman dan etis?';

        // Step 2: Context engineering & tool pruning
        const optimizedContext = await context.buildOptimizedContext('chat_123@s.whatsapp.net', userPrompt, {
            tools: registryTools,
            role: 'user'
        });

        assert.ok(optimizedContext.taskIntent.domains.includes('downloader'));
        assert.equal(optimizedContext.prunedTools.length, 1);
        assert.equal(optimizedContext.prunedTools[0].function.name, 'dl');

        // Step 3: Model Tier Routing (selects cheapest capable tier)
        const decision = router.routeTask(optimizedContext.taskIntent, {
            budgetScope: scope,
            providerHealth: health
        });

        assert.equal(decision.tier, MODEL_TIERS.TIER_2_GENERAL_REASONING); // Command execution / tool loop -> Tier 2
        assert.ok(decision.model);

        // Step 4: Reserve resources
        const estTokens = decision.estimatedTokens;
        const resId = budget.reserve(scope.scopeId, {
            estimatedInputTokens: estTokens.input,
            estimatedOutputTokens: estTokens.output,
            modelTier: 'TIER_2',
            provider: decision.provider,
            model: decision.model
        });

        assert.ok(resId);
        assert.equal(budget.getTelemetry(scope.scopeId).reservations.active, 1);

        // Step 5: Execute with Provider Failover
        const mockExecute = async (candidate, normalizedContext) => {
            return {
                text: 'Berhasil mendownload video: [Media Stream Object]',
                model: candidate.model,
                reportedTokens: { inputTokens: 420, outputTokens: 110, totalTokens: 530 }
            };
        };

        const execResult = await health.executeWithFailover(userPrompt, mockExecute, {
            tier: decision.tier,
            requirements: { capabilities: ['text'] },
            messages: [{ role: 'user', content: userPrompt }]
        });

        assert.equal(execResult.attempts.length, 1);
        assert.equal(execResult.attempts[0].status, 'SUCCESS');

        // Step 6 & 7: Reconcile usage & update budget
        const recon = budget.reconcile(scope.scopeId, resId, {
            actualInputTokens: execResult.reconciliation.actualInputTokens,
            actualOutputTokens: execResult.reconciliation.actualOutputTokens,
            latencyMs: execResult.latencyMs,
            provider: execResult.provider,
            model: execResult.model
        });

        assert.equal(recon.actual.inputTokens, 420);
        assert.equal(recon.actual.outputTokens, 110);
        assert.ok(recon.costUsd > 0);

        // Complete scope
        budget.completeScope(scope.scopeId);
        const finalSummary = budget.getScope(scope.scopeId);
        assert.equal(finalSummary.status, SCOPE_STATUS.COMPLETED);
        assert.equal(finalSummary.consumed.inputTokens, 420);
        assert.equal(finalSummary.consumed.apiCalls, 1);
    });

    await t.test('Sub-agent delegation workflow with budget refunding', async () => {
        const parent = budget.createScope(SCOPE_TYPES.RUNTIME_TASK, { profile: 'complex' });
        const initialParentTokens = budget.getRemaining(parent.scopeId).inputTokens;

        // Parent delegates sub-agent for complex analysis
        const child = budget.createChildScope(parent.scopeId, {
            budgetAllocation: { inputTokens: 4000, outputTokens: 1000, apiCalls: 2 }
        });

        assert.equal(child.depth, 1);
        assert.equal(child.parentScopeId, parent.scopeId);

        // Child reserves and executes request
        const resId = budget.reserve(child.scopeId, {
            estimatedInputTokens: 1500,
            estimatedOutputTokens: 500
        });

        budget.reconcile(child.scopeId, resId, {
            actualInputTokens: 1200,
            actualOutputTokens: 400,
            latencyMs: 300
        });

        // Child terminates successfully; unspent (4000 - 1200 = 2800 input tokens) returned to parent
        budget.completeScope(child.scopeId);

        const parentAfterChild = budget.getRemaining(parent.scopeId);
        assert.equal(parentAfterChild.inputTokens, initialParentTokens - 1200);

        budget.completeScope(parent.scopeId);
    });

    await t.test('Critical self-healing recovery reserve unlock flow', async () => {
        const healScope = budget.createScope(SCOPE_TYPES.SELF_HEALING_TASK, { profile: 'critical-recovery' });
        const remaining = budget.getRemaining(healScope.scopeId);

        // 15% reserve initially locked
        assert.equal(remaining.isReserveLocked, true);

        // Emergency rollback action unlocks reserve
        const unlocked = budget.releaseReserve(healScope.scopeId, {
            reason: RESERVE_RELEASE_REASONS.ROLLBACK,
            caller: 'selfHealingEngine'
        });

        assert.equal(unlocked.isReserveLocked, false);
        assert.equal(unlocked.inputTokens, healScope.limits.maxInputTokens);

        // Execute recovery reservation
        const resId = budget.reserve(healScope.scopeId, {
            estimatedInputTokens: 10000,
            estimatedOutputTokens: 2000
        });
        assert.ok(resId);

        budget.reconcile(healScope.scopeId, resId, { actualInputTokens: 9500, actualOutputTokens: 1800 });
        budget.completeScope(healScope.scopeId);
    });
});
