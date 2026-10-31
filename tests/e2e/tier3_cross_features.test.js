/**
 * tests/e2e/tier3_cross_features.test.js
 * 
 * Tier 3: Cross-Feature Combinations & Security Parity
 * Tests cross-layer interactions: prefix routing vs autonomous AI routing parity,
 * zero privilege escalation via AI tool calls, group guard under various bot admin states,
 * and role-based tool schema filtering.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createMockSocket } from './harness/mockSocket.js'
import { createMockContext, OWNER_JID, TEST_USER_JID, TEST_GROUP_JID } from './harness/mockContext.js'
import { ensureCommandsLoaded, getUnifiedRegistry, getUnifiedDispatcher } from './harness/testHelper.js'

describe('Tier 3: Cross-Feature Combinations & Security Parity', () => {
    let registry
    let dispatcher
    let commandsMap

    before(async () => {
        commandsMap = await ensureCommandsLoaded()
        registry = await getUnifiedRegistry()
        dispatcher = await getUnifiedDispatcher()
    })

    test('3.1 Security Parity: AI tool calling by regular user CANNOT bypass owner permissions', async () => {
        const sock = createMockSocket()
        // Regular user prompt triggering AI tool call
        const ctx = createMockContext({
            sock,
            role: 'user',
            sender: TEST_USER_JID,
            body: 'Tolong restart botnya sekarang dong'
        })

        // Simulate AI emitting autonomous tool call for owner command "restart" or "eval"
        const aiToolCall = {
            command: 'eval',
            args: ['process.version']
        }

        const result = await dispatcher.dispatchCommand(
            aiToolCall.command,
            aiToolCall.args,
            ctx,
            { source: 'ai', captureOutput: true }
        )

        // Security check: MUST be denied with DENIED
        assert.equal(result.success, false, 'AI tool calling must not bypass owner permission check')
        assert.equal(result.reason, 'DENIED')
        assert.ok(result.message.includes('khusus owner') || result.message.includes('ditolak'))
    })

    test('3.2 Security Parity: AI tool calling by Owner permits owner command execution', async () => {
        const sock = createMockSocket()
        // Real Owner sender
        const ctx = createMockContext({
            sock,
            role: 'owner',
            sender: OWNER_JID,
            body: 'Coba tes latency bot'
        })

        const aiToolCall = {
            command: 'ping',
            args: []
        }

        const result = await dispatcher.dispatchCommand(
            aiToolCall.command,
            aiToolCall.args,
            ctx,
            { source: 'ai', captureOutput: true }
        )

        assert.equal(result.success, true, `Owner AI tool call failed: ${result.reason}`)
        assert.ok(result.output.includes('Pong!'))
    })

    test('3.3 Group Guard Parity: Command requiring bot admin fails if bot is NOT admin', async () => {
        const sock = createMockSocket()
        // Group where bot is regular member (botIsAdmin: false)
        const ctx = createMockContext({
            sock,
            from: TEST_GROUP_JID,
            isGroup: true,
            role: 'admin', // Sender is admin
            botIsAdmin: false, // BUT BOT IS NOT ADMIN
            body: '.kick @62899999999'
        })

        const kickCmd = registry.getCommand('kick') || registry.getCommand('demote')
        assert.ok(kickCmd, 'Command requiring bot admin must exist')

        // Ensure requireBotAdmin flag is tested
        const originalReq = kickCmd.requireBotAdmin
        kickCmd.requireBotAdmin = true

        try {
            const result = await dispatcher.dispatchCommand(kickCmd.name, ['62899999999@s.whatsapp.net'], ctx)

            assert.equal(result.success, false)
            assert.equal(result.reason, 'BOT_NOT_ADMIN')
            assert.ok(result.message.includes('Bot requires admin') || result.message.includes('admin'))
        } finally {
            kickCmd.requireBotAdmin = originalReq
        }
    })

    test('3.4 Group Guard Parity: Command succeeds when bot AND sender are both admins', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({
            sock,
            from: TEST_GROUP_JID,
            isGroup: true,
            role: 'admin',
            botIsAdmin: true,
            body: '.groupinfo'
        })

        // Test groupinfo or similar group command
        const groupCmd = registry.getCommand('groupinfo')
        if (groupCmd) {
            const result = await dispatcher.dispatchCommand('groupinfo', [], ctx)
            assert.equal(result.success, true)
        }
    })

    test('3.5 Role-Based Tool Schema Filtering: Regular user schemas omit owner tools', async () => {
        const userSchemas = registry.getToolSchemas({ role: 'user' })
        const userToolNames = userSchemas.map(s => s.function.name)

        // Verify owner tools are NOT present in user schema
        assert.ok(!userToolNames.includes('eval'), 'User schema must not expose eval')
        assert.ok(!userToolNames.includes('shutdown'), 'User schema must not expose shutdown')
        assert.ok(!userToolNames.includes('restart'), 'User schema must not expose restart')
        assert.ok(!userToolNames.includes('broadcast'), 'User schema must not expose broadcast')

        // Verify standard tools ARE present
        assert.ok(userToolNames.includes('ping') || userToolNames.includes('help'), 'User schema should include ping or help')
    })

    test('3.6 Parameter Normalization: Accepts object parameters from AI and formats to args', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({
            sock,
            sender: '6288811223344@s.whatsapp.net',
            body: 'Cuaca di Bandung gimana'
        })

        // AI sends structured object argument { city: 'Bandung' }
        const objectArgs = { city: 'Bandung' }

        const result = await dispatcher.dispatchCommand('ping', objectArgs, ctx, {
            source: 'ai',
            captureOutput: true
        })

        assert.equal(result.success, true)
        assert.ok(result.output.includes('Pong!'))
    })

    test('3.7 Disabled Command Parity across AI and Manual: Both rejected uniformly', async () => {
        const sock1 = createMockSocket()
        const sock2 = createMockSocket()
        const ctxManual = createMockContext({ sock: sock1, sender: '6281111222233@s.whatsapp.net', body: '.ping' })
        const ctxAi = createMockContext({ sock: sock2, sender: '6281111222244@s.whatsapp.net', body: 'tes ping' })

        const pingCmd = registry.getCommand('ping')
        const originalStatus = pingCmd.enabled
        pingCmd.enabled = false

        try {
            const resManual = await dispatcher.dispatchCommand('ping', [], ctxManual, { source: 'manual' })
            const resAi = await dispatcher.dispatchCommand('ping', [], ctxAi, { source: 'ai' })

            assert.equal(resManual.success, false)
            assert.equal(resManual.reason, 'DISABLED')
            assert.equal(resAi.success, false)
            assert.equal(resAi.reason, 'DISABLED')
        } finally {
            pingCmd.enabled = originalStatus
        }
    })
})
