/**
 * tests/e2e/tier2_boundaries.test.js
 * 
 * Tier 2: Boundary & Corner Cases
 * Tests edge conditions, security filters, input sanitization, permission restrictions,
 * cooldown enforcement, and resilience against adversarial inputs.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createMockSocket } from './harness/mockSocket.js'
import { createMockContext, OWNER_JID, TEST_USER_JID, TEST_GROUP_JID } from './harness/mockContext.js'
import { ensureCommandsLoaded, getUnifiedRegistry, getUnifiedDispatcher } from './harness/testHelper.js'
import { resetCooldown } from '../../src/middleware/cooldown.js'

describe('Tier 2: Boundary & Corner Cases', () => {
    let registry
    let dispatcher
    let commandsMap

    before(async () => {
        commandsMap = await ensureCommandsLoaded()
        registry = await getUnifiedRegistry()
        dispatcher = await getUnifiedDispatcher()
    })

    test('2.1 Argument Length Boundary: Arguments exceeding 500 characters trigger validation failure', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.ping' })
        const longArg = 'a'.repeat(501)

        const result = await dispatcher.dispatchCommand('ping', [longArg], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'VALIDATION_FAILED')
        assert.ok(result.message.includes('terlalu panjang'), `Expected length error, got: ${result.message}`)
        
        // Assert warning reaction was delivered
        assert.ok(sock.getReactions().some(r => r.reaction === '⚠️'), 'Should react with ⚠️')
        assert.ok(sock.getLastMessage().content.text.includes('Gagal Validasi'))
    })

    test('2.2 Command Injection Boundary: Backtick and template literal injection rejected', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.ping' })
        const injection = '${process.exit(1)}'

        const result = await dispatcher.dispatchCommand('ping', [injection], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'VALIDATION_FAILED')
        assert.ok(result.message.includes('tidak diizinkan'), `Expected disallowed characters, got: ${result.message}`)
        assert.ok(sock.getReactions().some(r => r.reaction === '⚠️'))
    })

    test('2.3 Unknown Command Boundary: Non-existent command returns NOT_FOUND', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.nonexistent_xyz_command_1234' })

        const result = await dispatcher.dispatchCommand('nonexistent_xyz_command_1234', [], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'NOT_FOUND')
        assert.ok(result.message.includes('Unknown command'))
    })

    test('2.4 Empty Command Boundary: Empty or null command name safely handled', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '' })

        const result = await dispatcher.dispatchCommand('', [], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'NOT_FOUND')
    })

    test('2.5 Disabled Command Boundary: Disabled commands are blocked at Layer 1', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.ping' })
        const pingCmd = registry.getCommand('ping')
        
        // Temporarily disable command
        const originalStatus = pingCmd.enabled
        pingCmd.enabled = false

        try {
            const result = await dispatcher.dispatchCommand('ping', [], ctx)

            assert.equal(result.success, false)
            assert.equal(result.reason, 'DISABLED')
            assert.ok(sock.getReactions().some(r => r.reaction === '🚫'), 'Should react with 🚫')
            assert.ok(sock.getLastMessage().content.text.includes('dinonaktifkan'))
        } finally {
            pingCmd.enabled = originalStatus
        }
    })

    test('2.6 Permission Boundary (Admin): Regular user invoking admin command is denied', async () => {
        const sock = createMockSocket()
        // Regular user in a group chat attempting admin command
        const ctx = createMockContext({
            sock,
            from: TEST_GROUP_JID,
            isGroup: true,
            role: 'user',
            body: '.kick @62811111111'
        })

        // Find an admin command
        const adminCmd = registry.getCommand('kick') || registry.getCommand('demote')
        assert.ok(adminCmd, 'Admin command must exist in registry')

        const result = await dispatcher.dispatchCommand(adminCmd.name, ['62811111111@s.whatsapp.net'], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'DENIED')
        assert.ok(result.message.includes('khusus admin') || result.message.includes('ditolak'))
        assert.ok(sock.getReactions().some(r => r.reaction === '🚫'))
    })

    test('2.7 Permission Boundary (Owner): Regular user invoking owner command is denied', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({
            sock,
            role: 'user', // Regular user
            body: '.eval console.log("pwn")'
        })

        const ownerCmd = registry.getCommand('eval') || registry.getCommand('restart') || registry.getCommand('shutdown')
        assert.ok(ownerCmd, 'Owner command must exist in registry')

        const result = await dispatcher.dispatchCommand(ownerCmd.name, ['1+1'], ctx)

        assert.equal(result.success, false)
        assert.equal(result.reason, 'DENIED')
        assert.ok(result.message.includes('khusus owner') || result.message.includes('ditolak'))
        assert.ok(sock.getReactions().some(r => r.reaction === '🚫'))
    })

    test('2.8 Cooldown Boundary: Rapid subsequent execution triggers COOLDOWN', async () => {
        const sock = createMockSocket()
        const sender = '6289912345678@s.whatsapp.net'
        resetCooldown(sender, 'ping')

        const ctx1 = createMockContext({ sock, sender, body: '.ping' })
        const ctx2 = createMockContext({ sock, sender, body: '.ping' })

        // First execution succeeds
        const res1 = await dispatcher.dispatchCommand('ping', [], ctx1)
        assert.equal(res1.success, true)

        // Immediate second execution fails on cooldown
        const res2 = await dispatcher.dispatchCommand('ping', [], ctx2)
        assert.equal(res2.success, false)
        assert.equal(res2.reason, 'COOLDOWN')
        assert.ok(res2.message.includes('Cooldown active'))
        assert.ok(sock.getReactions().some(r => r.reaction === '⏳'))
        assert.ok(sock.getLastMessage().content.text.includes('Cooldown'))
    })

    test('2.9 Cooldown Reset Boundary: resetCooldown clears restriction immediately', async () => {
        const sock = createMockSocket()
        const sender = '6289955443322@s.whatsapp.net'
        resetCooldown(sender, 'ping')

        const ctx1 = createMockContext({ sock, sender, body: '.ping' })
        await dispatcher.dispatchCommand('ping', [], ctx1)

        // Reset cooldown
        resetCooldown(sender, 'ping')

        // Second call now succeeds
        const ctx2 = createMockContext({ sock, sender, body: '.ping' })
        const res2 = await dispatcher.dispatchCommand('ping', [], ctx2)
        assert.equal(res2.success, true)
    })

    test('2.10 Special Characters Boundary: Unicode, emoji, and formatting preserve integrity', async () => {
        const sock = createMockSocket()
        const sender = '6289933221100@s.whatsapp.net'
        const ctx = createMockContext({ sock, sender, body: '.ping' })

        const complexArgs = ['🌟 Testing_123 #@!', 'Kota: Jakarta (WIB)', 'Quotes: "hello" & \'world\'']
        const result = await dispatcher.dispatchCommand('ping', complexArgs, ctx)

        assert.equal(result.success, true)
        assert.equal(sock.getLastMessage().content.text, 'Pong!')
    })
})
