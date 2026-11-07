/**
 * tests/orchestrator/modelTierRouter.test.js
 * 
 * Comprehensive Unit Test Suite for ModelTierRouter (Tier 0-3)
 * Tests:
 * - Tier 0 deterministic rule engine (safe arithmetic, system uptime/ping/clock, creator recognition, direct regex commands)
 * - Zero LLM tokens & 0 API calls for Tier 0
 * - Task complexity classification (trivial, simple, moderate, complex, engineering)
 * - Cheapest-first routing (Tier 1 -> Tier 2 -> Tier 3)
 * - Dynamic budget reconciliation & tier downgrade
 * - Dynamic escalation from failed lower tiers
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ModelTierRouter,
    MODEL_TIERS,
    TASK_COMPLEXITY,
    TIER_CONFIGS
} from '../../src/services/orchestrator/index.js';

test('ModelTierRouter - Tier 0 Deterministic Engine', async (t) => {
    const router = new ModelTierRouter();

    await t.test('evaluates safe arithmetic expressions without eval()', () => {
        const math1 = router.checkTier0Deterministic('hitung 25 * 4 + 10');
        assert.ok(math1);
        assert.equal(math1.type, 'math');
        assert.equal(math1.calculation.result, 110);

        const math2 = router.checkTier0Deterministic('kalkulator: (100 - 20) / 4');
        assert.ok(math2);
        assert.equal(math2.calculation.result, 20);

        const math3 = router.checkTier0Deterministic('sqrt(144) + 8');
        assert.ok(math3);
        assert.equal(math3.calculation.result, 20);

        // Division by zero safely returns null
        const divZero = router.checkTier0Deterministic('hitung 10 / 0');
        assert.equal(divZero, null);
    });

    await t.test('handles bot uptime, ping, and clock queries in Tier 0', () => {
        const uptime = router.checkTier0Deterministic('uptime');
        assert.ok(uptime);
        assert.equal(uptime.type, 'system_uptime');
        assert.ok(uptime.text.includes('Bot Uptime'));

        const ping = router.checkTier0Deterministic('ping');
        assert.ok(ping);
        assert.equal(ping.type, 'system_ping');
        assert.ok(ping.text.includes('Pong'));

        const clock = router.checkTier0Deterministic('jam berapa');
        assert.ok(clock);
        assert.equal(clock.type, 'system_time');
        assert.ok(clock.text.includes('WIB'));
    });

    await t.test('recognizes creator Bang Rony with owner vs user parity', () => {
        // From Owner
        const ownerQuery = router.checkTier0Deterministic('siapa aku', { isOwner: true, isGroup: false });
        assert.ok(ownerQuery);
        assert.equal(ownerQuery.type, 'identity_owner');
        assert.ok(ownerQuery.text.includes('Bang Rony'));

        // From Regular User
        const userQuery = router.checkTier0Deterministic('kamu kenal aku', { isOwner: false, pushName: 'Budi' });
        assert.ok(userQuery);
        assert.equal(userQuery.type, 'identity_user');
        assert.ok(userQuery.text.includes('Bang Rony'));

        // Creator inquiry in Group
        const creatorGroup = router.checkTier0Deterministic('siapa yang bikin kamu', { isGroup: true });
        assert.ok(creatorGroup);
        assert.equal(creatorGroup.type, 'identity_creator');
        assert.ok(creatorGroup.mentions.length > 0);
    });

    await t.test('matches direct regex commands (.ping, rangkum, cuaca, dl)', () => {
        const cmd1 = router.checkTier0Deterministic('.menu');
        assert.ok(cmd1);
        assert.equal(cmd1.type, 'direct_command');
        assert.equal(cmd1.command, 'menu');

        const cmd2 = router.checkTier0Deterministic('rangkum 50 pesan terakhir');
        assert.ok(cmd2);
        assert.equal(cmd2.command, 'rangkum');
        assert.equal(cmd2.args[0], '50');

        const cmd3 = router.checkTier0Deterministic('cek cuaca di Surabaya hari ini');
        assert.ok(cmd3);
        assert.equal(cmd3.command, 'cuaca');
        assert.ok(cmd3.args[0].toLowerCase().includes('surabaya'));

        const cmd4 = router.checkTier0Deterministic('unduh https://www.tiktok.com/@user/video/123456');
        assert.ok(cmd4);
        assert.equal(cmd4.command, 'dl');
        assert.ok(cmd4.args[0].includes('tiktok.com'));
    });

    await t.test('caches deterministic calculations in LRU cache', () => {
        router.checkTier0Deterministic('hitung 99 * 3');
        const cached = router.checkTier0Deterministic('hitung 99 * 3');
        assert.ok(cached);
        assert.equal(cached.source, 'lru_cache');
    });
});

test('ModelTierRouter - Complexity Classification & Cheapest-First Routing', async (t) => {
    const router = new ModelTierRouter();

    await t.test('classifies task complexities accurately', () => {
        const engineeringTask = {
            rawPrompt: 'TypeError: Cannot read properties of undefined at dispatcher.js:42',
            domains: ['engineering'],
            actionType: 'code_engineering'
        };
        assert.equal(router.classifyComplexity(engineeringTask), TASK_COMPLEXITY.ENGINEERING);

        const complexTask = {
            rawPrompt: 'Buatkan analisa mendalam dan perbandingan arsitektur microservices vs monolith',
            domains: ['ai'],
            actionType: 'qa_conversation'
        };
        assert.equal(router.classifyComplexity(complexTask), TASK_COMPLEXITY.COMPLEX);

        const simpleTask = {
            rawPrompt: 'Apa ibu kota negara Indonesia?',
            domains: [],
            actionType: 'qa_conversation'
        };
        assert.equal(router.classifyComplexity(simpleTask), TASK_COMPLEXITY.SIMPLE);
    });

    await t.test('routes simple query to Tier 1 (Lightweight)', () => {
        const decision = router.routeTask({
            rawPrompt: 'Jelaskan apa itu fotosintesis secara singkat',
            domains: []
        });

        assert.equal(decision.tier, MODEL_TIERS.TIER_1_LIGHTWEIGHT);
        assert.equal(decision.isDeterministic, false);
        assert.ok(decision.model);
        assert.ok(decision.fallbackChain.length > 0);
        assert.ok(decision.estimatedCost < 0.001); // Cheap!
    });

    await t.test('routes complex query to Tier 2 (General Reasoning)', () => {
        const decision = router.routeTask({
            rawPrompt: 'Bandingkan pro dan kontra implementasi GraphQL dibanding REST API dalam skala enterprise',
            domains: ['ai']
        });

        assert.equal(decision.tier, MODEL_TIERS.TIER_2_GENERAL_REASONING);
        assert.ok(decision.model);
        assert.ok(decision.maxTokens >= 2048);
    });

    await t.test('routes self-healing/diagnostic query to Tier 3 (Specialist Engineering)', () => {
        const decision = router.routeTask({
            rawPrompt: 'SyntaxError: Unexpected token export in file src/core/registry.js:52. Need patch and reproduction test.',
            domains: ['engineering'],
            actionType: 'code_engineering'
        });

        assert.equal(decision.tier, MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING);
        assert.ok(decision.model);
        assert.ok(decision.maxTokens >= 4096);
    });

    await t.test('forced tier override takes precedence', () => {
        const decision = router.routeTask(
            { rawPrompt: 'Simple prompt' },
            { forceTier: MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING }
        );
        assert.equal(decision.tier, MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING);
    });
});

test('ModelTierRouter - Budget Constraint Downgrade & Dynamic Escalation', async (t) => {
    const router = new ModelTierRouter();

    await t.test('downgrades Tier 3 to Tier 2 when remaining budget is constrained', () => {
        const mockBudgetScope = {
            getRemaining: () => ({ inputTokens: 1200, tokens: 1200 }) // < 2000 tokens left
        };

        const decision = router.routeTask(
            {
                rawPrompt: 'Self-healing diagnostic error stack trace',
                domains: ['engineering'],
                actionType: 'code_engineering'
            },
            { budgetScope: mockBudgetScope }
        );

        // Downgraded to Tier 2 to respect remaining budget
        assert.equal(decision.tier, MODEL_TIERS.TIER_2_GENERAL_REASONING);
    });

    await t.test('escalateTier escalates from Tier 1 to Tier 2 to Tier 3', () => {
        const tier1Decision = router.routeTask({ rawPrompt: 'Test prompt' });
        assert.equal(tier1Decision.tier, MODEL_TIERS.TIER_1_LIGHTWEIGHT);

        const tier2Decision = router.escalateTier(tier1Decision, 'Model response failed validation');
        assert.equal(tier2Decision.tier, MODEL_TIERS.TIER_2_GENERAL_REASONING);
        assert.equal(tier2Decision.escalatedFrom, MODEL_TIERS.TIER_1_LIGHTWEIGHT);

        const tier3Decision = router.escalateTier(tier2Decision, 'Reasoning depth insufficient');
        assert.equal(tier3Decision.tier, MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING);
        assert.equal(tier3Decision.escalatedFrom, MODEL_TIERS.TIER_2_GENERAL_REASONING);

        // Escalation beyond Tier 3 must throw error
        assert.throws(
            () => router.escalateTier(tier3Decision, 'Max tier reached'),
            /Cannot escalate beyond Tier 3/
        );
    });
});
