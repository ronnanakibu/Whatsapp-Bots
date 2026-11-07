/**
 * tests/systematic/adversarialStress.test.js
 * 
 * Empirical Adversarial Challenge Suite for Milestone 1 (Phase 1).
 * Stress tests:
 * 1. Admin (12) & Owner (16) permission barriers against non-admin and non-owner callers.
 * 2. Group-only commands safety in DM.
 * 3. The 9 requireBotAdmin commands safety when bot is not admin.
 * 4. Production database ./storage/database/main.db immutability (SHA-256 verification).
 * 5. Adversarial corner cases: SQL injection, path traversal, shell injection, empty strings, null bytes, oversized payloads.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
    installExitTrap,
    restoreExitTrap,
    createVariantContext,
    backupEnvironment,
    restoreEnvironment,
    cleanupDatabaseFixture,
    OWNER_JID,
    TEST_GROUP_JID,
    TEST_USER_JID
} from './systematicHarness.js'

function getDbHash(dbFile) {
    if (!fs.existsSync(dbFile)) return null
    const buffer = fs.readFileSync(dbFile)
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

describe('Adversarial Stress & Empirical Verification Suite', () => {
    let registryModule
    let dispatcherModule
    let allCommands
    const PROD_DB_PATH = path.resolve('./storage/database/main.db')
    let initialProdDbHash = null

    before(async () => {
        installExitTrap()
        backupEnvironment()

        if (fs.existsSync(PROD_DB_PATH)) {
            initialProdDbHash = getDbHash(PROD_DB_PATH)
        }

        registryModule = await import('../../src/core/registry.js')
        dispatcherModule = await import('../../src/core/dispatcher.js')

        await registryModule.initializeRegistry('./src/commands')
        allCommands = registryModule.getAllCommands()
    })

    after(async () => {
        restoreExitTrap()
        restoreEnvironment()
        await cleanupDatabaseFixture()

        // Verify Production Database was NEVER modified
        if (initialProdDbHash && fs.existsSync(PROD_DB_PATH)) {
            const finalProdDbHash = getDbHash(PROD_DB_PATH)
            assert.equal(
                finalProdDbHash,
                initialProdDbHash,
                'CRITICAL SECURITY VIOLATION: Production database ./storage/database/main.db was modified during test run!'
            )
        }
    })

    test('1. Security Gate: Non-admin users blocked from all 12 Admin & 16 Owner commands', async () => {
        const adminCmds = []
        const ownerCmds = []

        for (const [name, cmd] of allCommands) {
            const primaryPerm = cmd.permissions?.[0] || 'user'
            if (primaryPerm === 'owner') {
                ownerCmds.push(name)
            } else if (primaryPerm === 'admin') {
                adminCmds.push(name)
            }
        }

        // Verify counts match coverage matrix
        assert.equal(ownerCmds.length, 16, `Expected exactly 16 owner commands, got ${ownerCmds.length}: ${ownerCmds.join(', ')}`)
        assert.equal(adminCmds.length, 12, `Expected exactly 12 admin commands, got ${adminCmds.length}: ${adminCmds.join(', ')}`)

        // 1.1 Non-admin in DM attempting Admin commands
        for (const name of adminCmds) {
            const ctx = createVariantContext('USER_DM', name, [])
            const res = await dispatcherModule.dispatchCommand(name, [], ctx, { captureOutput: true, sendToChat: false })
            assert.equal(res.success, false, `Admin cmd .${name} must fail for regular user in DM`)
            assert.equal(res.reason, 'DENIED', `Admin cmd .${name} must be DENIED for regular user in DM`)
        }

        // 1.2 Non-admin in Group attempting Admin commands
        for (const name of adminCmds) {
            const ctx = createVariantContext('USER_GROUP', name, [])
            const res = await dispatcherModule.dispatchCommand(name, [], ctx, { captureOutput: true, sendToChat: false })
            assert.equal(res.success, false, `Admin cmd .${name} must fail for regular user in Group`)
            assert.equal(res.reason, 'DENIED', `Admin cmd .${name} must be DENIED for regular user in Group`)
        }

        // 1.3 Non-admin in DM attempting Owner commands
        for (const name of ownerCmds) {
            const ctx = createVariantContext('USER_DM', name, [])
            const res = await dispatcherModule.dispatchCommand(name, [], ctx, { captureOutput: true, sendToChat: false })
            assert.equal(res.success, false, `Owner cmd .${name} must fail for regular user in DM`)
            assert.equal(res.reason, 'DENIED', `Owner cmd .${name} must be DENIED for regular user in DM`)
        }

        // 1.4 Non-admin in Group attempting Owner commands
        for (const name of ownerCmds) {
            const ctx = createVariantContext('USER_GROUP', name, [])
            const res = await dispatcherModule.dispatchCommand(name, [], ctx, { captureOutput: true, sendToChat: false })
            assert.equal(res.success, false, `Owner cmd .${name} must fail for regular user in Group`)
            assert.equal(res.reason, 'DENIED', `Owner cmd .${name} must be DENIED for regular user in Group`)
        }

        // 1.5 Group Admin in Group attempting Owner-Only commands
        for (const name of ownerCmds) {
            const cmd = allCommands.get(name)
            const perms = cmd.permissions || []
            const isMultiRole = perms.includes('admin')
            if (!isMultiRole) {
                const ctx = createVariantContext('ADMIN_GROUP', name, [])
                const res = await dispatcherModule.dispatchCommand(name, [], ctx, { captureOutput: true, sendToChat: false })
                assert.equal(res.success, false, `Owner-only cmd .${name} must fail for group admin in Group`)
                assert.equal(res.reason, 'DENIED', `Owner-only cmd .${name} must be DENIED for group admin in Group`)
            }
        }
    })

    test('2. Group Guard: Group-only commands fail safely in DM', async () => {
        // Group-only commands: 9 requireBotAdmin commands + commands with explicit group requirements
        const groupOnlyCommands = [
            'add', 'demote', 'grouplink', 'kick', 'kickme', 'mute', 'pin', 'promote', 'unmute',
            'groupinfo', 'listadmin', 'setjadwalgroup'
        ]

        for (const name of groupOnlyCommands) {
            const cmd = allCommands.get(name)
            assert.ok(cmd, `Command ${name} must exist in registry`)

            // Test with regular user in DM
            const userCtx = createVariantContext('USER_DM', name, [])
            const userRes = await dispatcherModule.dispatchCommand(name, [], userCtx, { captureOutput: true, sendToChat: false })

            if (cmd.permissions?.includes('admin') || cmd.permissions?.includes('owner')) {
                assert.equal(userRes.reason, 'DENIED', `Admin group cmd .${name} must be DENIED for regular user in DM`)
            } else {
                const out = (userRes.output || '').toLowerCase()
                const safeFail = userRes.success === false ||
                    userRes.reason === 'BOT_NOT_ADMIN' ||
                    userRes.reason === 'DENIED' ||
                    out.includes('grup') ||
                    out.includes('group')
                assert.ok(safeFail, `Group cmd .${name} executed by regular user in DM must fail safely, got: ${userRes.reason} - ${out}`)
            }

            // Test with bot owner in DM
            const ownerCtx = createVariantContext('OWNER_DM', name, [])
            const ownerRes = await dispatcherModule.dispatchCommand(name, [], ownerCtx, { captureOutput: true, sendToChat: false })
            const ownerOut = (ownerRes.output || '').toLowerCase()

            const safeOwnerFail = ownerRes.success === false ||
                ownerRes.reason === 'BOT_NOT_ADMIN' ||
                ownerOut.includes('grup') ||
                ownerOut.includes('group') ||
                ownerOut.includes('cara pakai') ||
                ownerOut.includes('⚠️') ||
                ownerOut.includes('❌') ||
                ownerRes.reason === 'VALIDATION_FAILED'
            assert.ok(safeOwnerFail, `Group cmd .${name} invoked by owner in DM must fail safely, got: reason=${ownerRes.reason}, out=${ownerOut}`)
        }
    })

    test('3. Bot Admin Guard: Exactly 9 requireBotAdmin commands fail safely when bot is not admin', async () => {
        const expected9Commands = ['add', 'demote', 'grouplink', 'kick', 'kickme', 'mute', 'pin', 'promote', 'unmute']
        const actualBotAdminCommands = []

        for (const [name, cmd] of allCommands) {
            if (cmd.requireBotAdmin) {
                actualBotAdminCommands.push(name)
            }
        }

        actualBotAdminCommands.sort()
        expected9Commands.sort()
        assert.deepEqual(actualBotAdminCommands, expected9Commands, 'requireBotAdmin commands must exactly match the 9 declared commands')

        for (const name of expected9Commands) {
            const ctx = createVariantContext('BOT_NOT_ADMIN', name, ['628999999999@s.whatsapp.net'])
            const res = await dispatcherModule.dispatchCommand(name, ctx.args, ctx, { captureOutput: true, sendToChat: false })

            assert.equal(res.success, false, `Command .${name} must fail when bot is not admin`)
            assert.equal(res.reason, 'BOT_NOT_ADMIN', `Command .${name} must return BOT_NOT_ADMIN reason`)
        }
    })

    test('4. Adversarial Corner Cases: SQL Injection, Shell Injection, Path Traversal & Fuzzing', async () => {
        const attackPayloads = [
            // SQL Injection payloads
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "\" OR \"\"=\"",
            "UNION SELECT * FROM sqlite_master WHERE type='table' --",
            "admin'--",
            // Path traversal payloads
            "../../../../storage/database/main.db",
            "..\\..\\..\\storage\\database\\main.db",
            "/etc/passwd",
            "C:\\Windows\\System32\\calc.exe",
            // Shell / Command injection payloads
            "; rm -rf / ;",
            "| dir",
            "$(whoami)",
            "`id`",
            "& ping -n 1 127.0.0.1 &",
            // Empty / whitespace / zero-width / control chars
            "",
            "   ",
            "\0\0\0",
            "\u200B\u200C\uFEFF",
            "\r\n\t",
            // Format string / regex crasher
            "%s%s%s%s%n%x",
            "((((a+)+)+)+)"
        ]

        // Test representative sample across categories
        const testCommands = ['ping', 'kalkulator', 'qr', 'dl', 'notes', 'help', 'add', 'files']

        for (const cmdName of testCommands) {
            const cmd = allCommands.get(cmdName)
            if (!cmd) continue

            const isOwner = cmd.permissions?.includes('owner')
            const isGroup = cmd.category === 'group' || cmd.requireBotAdmin
            const variantType = isGroup ? 'ADMIN_GROUP' : (isOwner ? 'OWNER_DM' : 'USER_DM')

            for (const payload of attackPayloads) {
                const ctx = createVariantContext(variantType, cmdName, [payload])
                try {
                    const res = await dispatcherModule.dispatchCommand(cmdName, [payload], ctx, {
                        captureOutput: true,
                        sendToChat: false
                    })
                    // Execution must NOT crash process or throw unhandled rejection
                    assert.ok(res !== undefined, `Command .${cmdName} returned undefined for payload: ${payload}`)
                    assert.notEqual(res.reason, 'CRASH', `Command .${cmdName} crashed on payload: ${payload}`)
                } catch (err) {
                    assert.fail(`Command .${cmdName} threw uncaught exception on payload "${payload}": ${err.message}`)
                }
            }
        }
    })

    test('5. Layer 2 Validator: Oversized payloads (> 500 chars) are strictly rejected', async () => {
        const oversizedString = 'A'.repeat(501)
        for (const [name, cmd] of allCommands) {
            const ctx = createVariantContext('OWNER_DM', name, [oversizedString])
            const res = await dispatcherModule.dispatchCommand(name, [oversizedString], ctx, {
                captureOutput: true,
                sendToChat: false
            })
            assert.equal(res.success, false, `Oversized payload on .${name} must be rejected`)
            assert.equal(res.reason, 'VALIDATION_FAILED', `Expected VALIDATION_FAILED on .${name}, got ${res.reason}`)
        }
    })

    test('6. Production Database Integrity: Hash check before and after execution', () => {
        if (initialProdDbHash && fs.existsSync(PROD_DB_PATH)) {
            const currentHash = getDbHash(PROD_DB_PATH)
            assert.equal(currentHash, initialProdDbHash, 'Production database main.db must remain strictly byte-identical')
        }
    })
})
