/**
 * tests/orchestrator/contextEngine.test.js
 * 
 * Comprehensive Unit Test Suite for ContextEngine
 * Tests:
 * - Intent extraction across 9 canonical domains with WhatsApp entity binding
 * - Multi-stage semantic tool schema pruning (103 commands down to top 5-8, 0 for chat)
 * - Role permission filtering (user vs admin vs owner)
 * - Conversation history pruning, tool result compaction & rollup summarization
 * - End-to-end buildOptimizedContext() telemetry & token savings
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ContextEngine
} from '../../src/services/orchestrator/index.js';

// Mock command catalog for registry tool testing
const mockCommands = [
    { name: 'ping', category: 'tools', description: 'Cek latency bot', permissions: ['user'], enabled: true, usage: '.ping' },
    { name: 'uptime', category: 'tools', description: 'Cek bot uptime', permissions: ['user'], enabled: true, usage: '.uptime' },
    { name: 'cuaca', category: 'tools', description: 'Info cuaca kota', permissions: ['user'], enabled: true, usage: '.cuaca <kota>', tags: ['cuaca', 'weather', 'suhu'] },
    { name: 'dl', category: 'downloader', description: 'Download media TikTok / IG / YouTube', permissions: ['user'], enabled: true, usage: '.dl <url>', tags: ['download', 'tiktok', 'instagram', 'youtube'] },
    { name: 'sticker', category: 'media', description: 'Konversi gambar ke stiker', permissions: ['user'], enabled: true, usage: '.s', tags: ['stiker', 'sticker'] },
    { name: 'kick', category: 'group', description: 'Keluarkan member dari grup', permissions: ['admin'], enabled: true, usage: '.kick @user', requireBotAdmin: true },
    { name: 'promote', category: 'group', description: 'Jadikan member sebagai admin', permissions: ['admin'], enabled: true, usage: '.promote @user', requireBotAdmin: true },
    { name: 'eval', category: 'owner', description: 'Evaluasi ekspresi JavaScript', permissions: ['owner'], enabled: true, usage: '.eval <code>' },
    { name: 'cook', category: 'engineering', description: 'Racik dynamic skill baru', permissions: ['user'], enabled: true, usage: '.cook <prompt>', tags: ['cook', 'racik', 'dynamicskill'] },
    { name: 'rangkum', category: 'ai', description: 'Ringkas obrolan grup', permissions: ['user'], enabled: true, usage: '.rangkum <jumlah>', tags: ['rangkum', 'ringkas'] }
];

test('ContextEngine - Fast Token Estimation Heuristic', async (t) => {
    const engine = new ContextEngine();

    await t.test('estimates token counts for strings, arrays, and objects', () => {
        const text = 'Halo dunia, ini adalah pengujian estimasi token untuk WABOT 2.0.';
        const tokens = engine.estimateTokenCount(text);
        assert.ok(tokens > 10 && tokens < 30);

        const messages = [
            { role: 'system', content: 'You are an AI assistant.' },
            { role: 'user', content: 'Hello there!' }
        ];
        const arrayTokens = engine.estimateTokenCount(messages);
        assert.ok(arrayTokens > 10 && arrayTokens < 30);

        const empty = engine.estimateTokenCount('');
        assert.equal(empty, 0);
    });
});

test('ContextEngine - Intent Extraction & WhatsApp Entity Binding', async (t) => {
    const engine = new ContextEngine();

    await t.test('extracts canonical domains and action types accurately', () => {
        const dlIntent = engine.extractTaskIntent('tolong unduh video tiktok ini https://vt.tiktok.com/ZSjX/');
        assert.ok(dlIntent.domains.includes('downloader'));
        assert.equal(dlIntent.actionType, 'command_execution');

        const engIntent = engine.extractTaskIntent('ada syntax error di handler message.js tolong perbaiki');
        assert.ok(engIntent.domains.includes('engineering'));
        assert.equal(engIntent.actionType, 'code_engineering');

        const sumIntent = engine.extractTaskIntent('tolong ringkas obrolan 50 chat terakhir');
        assert.equal(sumIntent.actionType, 'summarization');

        const chatIntent = engine.extractTaskIntent('ceritakan dongeng kancil dan buaya');
        assert.equal(chatIntent.actionType, 'qa_conversation');
    });

    await t.test('binds WhatsApp entities (sender JID, chatId, mentions, media, url)', () => {
        const mockCtx = {
            sender: '628991111111@s.whatsapp.net',
            chatId: '12036302@g.us',
            isGroup: true,
            type: 'imageMessage'
        };

        const intent = engine.extractTaskIntent('bikinin stiker dari foto ini ya bot @6285172013920', mockCtx);
        assert.equal(intent.entities.senderJid, '628991111111@s.whatsapp.net');
        assert.equal(intent.entities.chatId, '12036302@g.us');
        assert.equal(intent.entities.isGroup, true);
        assert.equal(intent.entities.hasMedia, true);
        assert.ok(intent.entities.mentions.includes('6285172013920@s.whatsapp.net'));
    });
});

test('ContextEngine - Multi-Stage Semantic Tool Schema Pruning', async (t) => {
    const engine = new ContextEngine();

    await t.test('prunes pure conversation down to 0 tools (maximum token savings)', () => {
        const intent = engine.extractTaskIntent('selamat pagi bot, apa kabar hari ini?');
        const result = engine.pruneTools(mockCommands, intent, { role: 'user', allowEmpty: true });

        assert.equal(result.selectedCount, 0);
        assert.equal(result.tools.length, 0);
        assert.ok(result.tokenSavings > 0);
    });

    await t.test('selects only relevant tools for downloader task', () => {
        const intent = engine.extractTaskIntent('unduh video tiktok ini dong https://tiktok.com/xyz');
        const result = engine.pruneTools(mockCommands, intent, { role: 'user', topK: 3 });

        assert.ok(result.selectedCount >= 1);
        const toolNames = result.tools.map(t => t.function?.name || t.name);
        assert.ok(toolNames.includes('dl'));
        // Unrelated tools should be pruned
        assert.equal(toolNames.includes('ping'), false);
        assert.equal(toolNames.includes('kick'), false);
    });

    await t.test('enforces role permission boundaries during tool pruning', () => {
        const intent = engine.extractTaskIntent('kick member yang bikin rusuh');

        // Regular user requesting kick -> kick tool must be filtered out
        const userResult = engine.pruneTools(mockCommands, intent, { role: 'user', isGroup: true });
        const userTools = userResult.tools.map(t => t.function?.name || t.name);
        assert.equal(userTools.includes('kick'), false);

        // Group admin requesting kick -> kick tool is permitted
        const adminResult = engine.pruneTools(mockCommands, intent, { role: 'admin', isGroup: true, botIsAdmin: true });
        const adminTools = adminResult.tools.map(t => t.function?.name || t.name);
        assert.ok(adminTools.includes('kick'));
    });

    await t.test('formats schemas for OpenAI, hermes_prompt, and raw', () => {
        const intent = engine.extractTaskIntent('cek cuaca hari ini');

        const openaiResult = engine.pruneTools(mockCommands, intent, { format: 'openai' });
        assert.ok(openaiResult.tools[0].function);

        const hermesResult = engine.pruneTools(mockCommands, intent, { format: 'hermes_prompt' });
        assert.equal(typeof hermesResult.tools, 'string');
        assert.ok(hermesResult.tools.includes('cuaca'));
    });
});

test('ContextEngine - History Pruning, Tool Compaction & Summarization', async (t) => {
    const engine = new ContextEngine({ maxHistoryTokens: 150, maxMessageChars: 120 });

    await t.test('compacts verbose JSON tool execution dumps into short summaries', () => {
        const history = [
            {
                role: 'assistant',
                content: '{"executeCommand": true, "command": "cuaca", "args": ["Jakarta", "today"]}'
            }
        ];

        const pruned = engine.pruneHistory(history);
        assert.ok(pruned[0].content.includes('[Tool Invocation: cuaca args: ["Jakarta","today"]]'));
    });

    await t.test('truncates oversized messages with head/tail preservation', () => {
        const longText = 'A'.repeat(300);
        const history = [{ role: 'user', content: longText }];

        const pruned = engine.pruneHistory(history, { maxMessageChars: 80 });
        assert.ok(pruned[0].content.length < 150);
        assert.ok(pruned[0].content.includes('omitted for brevity'));
    });

    await t.test('rolls up older turns into synthetic summary when token budget exceeded', () => {
        const longDialogue = [];
        for (let i = 1; i <= 10; i++) {
            longDialogue.push({ role: 'user', content: `Pertanyaan pengguna nomor ${i} tentang topik teknologi dan sains.` });
            longDialogue.push({ role: 'assistant', content: `Jawaban asisten nomor ${i} memberikan penjelasan panjang lebar.` });
        }

        const pruned = engine.pruneHistory(longDialogue, { maxTokens: 80, keepLastN: 4 });
        assert.ok(pruned.length <= 5); // 1 synthetic summary + 4 recent turns
        assert.equal(pruned[0].role, 'system');
        assert.ok(pruned[0].content.includes('Prior Conversation Context'));
    });
});

test('ContextEngine - End-to-End buildOptimizedContext()', async (t) => {
    const engine = new ContextEngine();

    const result = await engine.buildOptimizedContext('120363@g.us', 'unduh video tiktok https://tiktok.com/test', {
        ctx: { isGroup: true, sender: '62811@s.whatsapp.net' },
        tools: mockCommands,
        history: [{ role: 'user', content: 'Halo' }, { role: 'assistant', content: 'Halo! Ada yang bisa dibantu?' }]
    });

    assert.ok(result.taskIntent);
    assert.ok(result.prunedTools);
    assert.ok(result.prunedHistory);
    assert.ok(result.telemetry);
    assert.ok(result.telemetry.totalEstimatedTokens > 0);
    assert.ok(result.telemetry.toolsPrunedCount > 0);
});
