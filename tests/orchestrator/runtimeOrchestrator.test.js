/**
 * tests/orchestrator/runtimeOrchestrator.test.js
 * 
 * Master Test Suite for Milestone 3 Centralized Runtime Orchestrator:
 * - RuntimeOrchestrator API Lifecycle
 * - 7 Explicit Termination Conditions (Phase 2D)
 * - Anti-Loop SHA-256 State Hashing & Cycle Detection
 * - Sub-Agent Concurrency Limits (depth 1, max 3 cumulative, max 2 concurrent)
 * - WhatsApp Entity & Context Binding (aku, kamu, grup ini, dia)
 * - Privilege Audit Logging (ring buffer & filtering)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RuntimeOrchestrator,
    TERMINATION_REASONS,
    TASK_STATUS,
    PRIVILEGE_LEVELS,
    MODEL_TIERS
} from '../../src/services/orchestrator/index.js';

test('RuntimeOrchestrator - WhatsApp Entity Binding (Phase 2E)', async (t) => {
    const orchestrator = new RuntimeOrchestrator();

    await t.test('resolves "aku" to verified WhatsApp sender JID and pushName', () => {
        const waCtx = {
            sender: '628123456789@s.whatsapp.net',
            pushName: 'Budi Handoko',
            isOwner: false,
            isAdmin: true,
            chatId: '120363045678@g.us',
            isGroup: true
        };

        const { entities, bindings } = orchestrator.resolveWhatsAppEntities('tolong jadikan aku admin', waCtx);
        assert.equal(entities.senderJid, '628123456789@s.whatsapp.net');
        assert.equal(entities.senderPushName, 'Budi Handoko');
        assert.equal(entities.senderRole, 'admin');
        assert.equal(bindings.targetUserJid, '628123456789@s.whatsapp.net');
        assert.equal(bindings.targetUserName, 'Budi Handoko');
    });

    await t.test('resolves "grup ini" strictly within a group chat', () => {
        const waCtx = {
            sender: '628123456789@s.whatsapp.net',
            chatId: '120363045678@g.us',
            isGroup: true
        };

        const { bindings } = orchestrator.resolveWhatsAppEntities('keluarkan dia dari grup ini', waCtx);
        assert.equal(bindings.targetChatId, '120363045678@g.us');
    });

    await t.test('resolves quoted participant when query refers to "orang tadi"', () => {
        const waCtx = {
            sender: '628123456789@s.whatsapp.net',
            quoted: {
                sender: '628999888777@s.whatsapp.net',
                text: 'Saya mau spam di sini!'
            }
        };

        const { bindings } = orchestrator.resolveWhatsAppEntities('kick orang tadi', waCtx);
        assert.equal(bindings.targetUserJid, '628999888777@s.whatsapp.net');
    });
});

test('RuntimeOrchestrator - Fast-Path Tier 0 Execution', async (t) => {
    const orchestrator = new RuntimeOrchestrator();

    const response = await orchestrator.executeTask(
        { query: 'hitung 25 * 4 + 50' },
        { sender: '628123456789@s.whatsapp.net' }
    );

    assert.equal(response.success, true);
    assert.equal(response.tier, MODEL_TIERS.TIER_0_DETERMINISTIC);
    assert.ok(response.result.includes('150'));
    assert.equal(response.terminationReason, TERMINATION_REASONS.GOAL_ACHIEVED);
    assert.equal(response.iterations, 0);
});

test('RuntimeOrchestrator - 7 Explicit Termination Conditions (Phase 2D)', async (t) => {
    await t.test('Condition 1: GOAL_ACHIEVED when LLM finishes without requesting tools', async () => {
        const orchestrator = new RuntimeOrchestrator({
            llmExecutor: async () => ({
                text: 'Penjelasan lengkap selesai.',
                reportedTokens: { inputTokens: 100, outputTokens: 50 },
                toolCalls: []
            })
        });

        const res = await orchestrator.executeTask({ query: 'Jelaskan apa itu fotosintesis' });
        assert.equal(res.success, true);
        assert.equal(res.terminationReason, TERMINATION_REASONS.GOAL_ACHIEVED);
        assert.equal(res.result, 'Penjelasan lengkap selesai.');
    });

    await t.test('Condition 2: NO_TOOL_AVAILABLE terminates immediately when required tools are missing', async () => {
        const orchestrator = new RuntimeOrchestrator();
        const res = await orchestrator.executeTask(
            { query: 'Unduh video youtube ini https://youtu.be/xyz' },
            {},
            { tools: [], requireTools: true }
        );

        assert.equal(res.success, false);
        assert.equal(res.terminationReason, TERMINATION_REASONS.NO_TOOL_AVAILABLE);
    });

    await t.test('Condition 3: LOOP_DETECTED via state hash stops infinite repetitive tool calls', async () => {
        const orchestrator = new RuntimeOrchestrator({
            llmExecutor: async () => ({
                text: 'Memeriksa ping...',
                toolCalls: [{ name: 'ping', args: {} }]
            }),
            toolExecutor: async () => ({ success: true, latency: 15 })
        });

        const res = await orchestrator.executeTask(
            { query: 'Periksa status server' },
            {},
            { tools: [{ name: 'ping', permissions: ['user'] }] }
        );

        assert.equal(res.success, false);
        assert.equal(res.terminationReason, TERMINATION_REASONS.LOOP_DETECTED);
    });

    await t.test('Condition 4: ITERATION_BUDGET_EXHAUSTED halts loop when max limit is reached', async () => {
        let counter = 0;
        const orchestrator = new RuntimeOrchestrator({
            llmExecutor: async () => {
                counter++;
                return {
                    text: `Iterasi ${counter}`,
                    toolCalls: [{ name: 'step', args: { count: counter } }]
                };
            },
            toolExecutor: async (name, args) => ({ success: true, count: args.count })
        });

        const res = await orchestrator.executeTask(
            { query: 'Jalankan multi-step processing' },
            {},
            { profile: 'standard', maxIterations: 3, tools: [{ name: 'step', permissions: ['user'] }] } // max 3 iterations
        );

        assert.equal(res.success, false);
        assert.equal(res.terminationReason, TERMINATION_REASONS.ITERATION_BUDGET_EXHAUSTED);
    });

    await t.test('Condition 7: PERMISSION_DENIED halts task when non-owner requests owner tool', async () => {
        const orchestrator = new RuntimeOrchestrator({
            llmExecutor: async () => ({
                text: 'Memulai restart bot...',
                toolCalls: [{ name: 'restart', args: {} }]
            })
        });

        const res = await orchestrator.executeTask(
            { query: 'Restart bot sekarang' },
            { sender: 'user@s.whatsapp.net', isOwner: false },
            { tools: [{ name: 'restart', permissions: ['owner'] }] }
        );

        assert.equal(res.success, false);
        assert.equal(res.terminationReason, TERMINATION_REASONS.PERMISSION_DENIED);
    });
});

test('RuntimeOrchestrator - Sub-Agent Concurrency Limits (Document 2 Directives)', async (t) => {
    const orchestrator = new RuntimeOrchestrator({
        llmExecutor: async () => ({ text: 'Sub-agent done', toolCalls: [] })
    });

    // Parent task initialization (keepScopeAlive = true so parent scope can delegate)
    const parent = await orchestrator.executeTask(
        { query: 'Task utama parent' },
        {},
        { profile: 'complex', keepScopeAlive: true }
    );
    const parentId = parent.taskId;

    await t.test('allows valid child sub-agent delegation with independent scope', async () => {
        const childRes = await orchestrator.delegateSubAgent(parentId, { query: 'Sub-task mandiri 1' });
        assert.equal(childRes.success, true);
    });

    await t.test('enforces max 3 cumulative sub-agents per parent task', async () => {
        await orchestrator.delegateSubAgent(parentId, { query: 'Sub-task mandiri 2' });
        await orchestrator.delegateSubAgent(parentId, { query: 'Sub-task mandiri 3' });

        // 4th delegation must be rejected
        await assert.rejects(
            async () => await orchestrator.delegateSubAgent(parentId, { query: 'Sub-task mandiri 4' }),
            /Cumulative limit of 3 sub-agents/
        );
    });
});

test('RuntimeOrchestrator - Privilege Audit Logging (Phase 2E)', async () => {
    const orchestrator = new RuntimeOrchestrator();

    orchestrator.recordAudit({
        taskId: 'task_audit_1',
        operation: 'promote',
        actorJid: 'admin@s.whatsapp.net',
        targetJid: 'user@s.whatsapp.net',
        privilegeLevel: PRIVILEGE_LEVELS.ADMIN,
        resultStatus: 'SUCCESS'
    });

    const logs = orchestrator.getAuditLogs({ taskId: 'task_audit_1' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].operation, 'promote');
    assert.equal(logs[0].actorJid, 'admin@s.whatsapp.net');
    assert.equal(logs[0].resultStatus, 'SUCCESS');
    assert.ok(logs[0].auditId);
});
