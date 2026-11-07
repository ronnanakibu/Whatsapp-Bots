/**
 * tests/systematic/commandCoverage.test.js
 * 
 * Systematic Command Verification Test Suite for WABOT 2.0 v6 (Milestone 1 - Phase 1).
 * Executes each of the 103 commands across 7 security & context variants:
 *   a) Regular user in DM
 *   b) Regular user in Group
 *   c) Group Admin in Group
 *   d) Bot Owner in Group and DM
 *   e) Bot without Group-Admin rights (for the 9 requireBotAdmin commands)
 *   f) Missing / invalid parameters (Layer 2 parameter validation & error handling)
 *   g) Disabled command state (Layer 1 enabled check)
 * 
 * Enforces zero live external API calls, SQLite isolation, and process.exit safety.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
    installExitTrap,
    restoreExitTrap,
    installNetworkShield,
    restoreNetworkShield,
    shieldCommandExecution,
    createVariantContext,
    backupEnvironment,
    restoreEnvironment,
    cleanupDatabaseFixture,
    getBenignArgs,
    detectExternalDependencies
} from './systematicHarness.js'

describe('Milestone 1: Systematic Command Verification Suite (103 Commands)', () => {
    let registryModule
    let dispatcherModule
    let allCommands

    before(async () => {
        installExitTrap()
        installNetworkShield()
        backupEnvironment()

        registryModule = await import('../../src/core/registry.js')
        dispatcherModule = await import('../../src/core/dispatcher.js')

        await registryModule.initializeRegistry('./src/commands')
        allCommands = registryModule.getAllCommands()
    })

    after(async () => {
        restoreNetworkShield()
        restoreExitTrap()
        restoreEnvironment()
        await cleanupDatabaseFixture()
    })

    test('Registry Census: Exactly 103 unique canonical commands loaded', () => {
        assert.equal(allCommands.size, 103, `Expected exactly 103 canonical commands, found ${allCommands.size}`)
    })

    test('All 103 Commands Systematic Variant Execution', async (t) => {
        for (const [name, cmd] of allCommands) {
            await t.test(`Command [${cmd.category}] .${name}`, async () => {
                const isExternal = detectExternalDependencies(cmd.filePath) !== 'None (Internal/Offline)'
                let restoreShield = null
                if (isExternal) {
                    restoreShield = shieldCommandExecution(cmd, 'Requires External API / Credentials')
                }

                try {
                    const permission = cmd.permissions?.[0] || 'user'
                    const isOwnerCmd = cmd.permissions?.includes('owner') || permission === 'owner'
                    const isAdminCmd = cmd.permissions?.includes('admin') || permission === 'admin'
                    const isOwnerOnlyCmd = isOwnerCmd && !isAdminCmd
                    const isGroupOnly = Boolean(cmd.requireBotAdmin) || cmd.category === 'group'

                // ── Variant g: Disabled Command State (Layer 1) ──
                cmd.enabled = false
                const disabledCtx = createVariantContext('OWNER_DM', name, [])
                const disRes = await dispatcherModule.dispatchCommand(name, [], disabledCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                assert.equal(disRes.success, false, `Disabled command .${name} must not succeed`)
                assert.equal(disRes.reason, 'DISABLED', `Disabled command .${name} must return DISABLED reason`)
                cmd.enabled = true

                // ── Variant f1: Invalid Parameter Validation (Layer 2) ──
                const invalidCtx = createVariantContext('INVALID_PARAMS', name)
                const valRes = await dispatcherModule.dispatchCommand(name, invalidCtx.args, invalidCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                assert.equal(valRes.success, false, `Invalid parameters on .${name} must fail validation`)
                assert.equal(valRes.reason, 'VALIDATION_FAILED', `Invalid parameters on .${name} must return VALIDATION_FAILED`)

                // ── Variant a: Regular User in DM ──
                const userDmCtx = createVariantContext('USER_DM', name, [])
                const userDmRes = await dispatcherModule.dispatchCommand(name, [], userDmCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                if (isOwnerCmd) {
                    assert.equal(userDmRes.reason, 'DENIED', `Owner command .${name} must be DENIED for regular user in DM`)
                } else if (isAdminCmd) {
                    assert.equal(userDmRes.reason, 'DENIED', `Admin command .${name} must be DENIED for regular user in DM`)
                } else if (isGroupOnly && userDmRes.success === false) {
                    assert.ok(
                        userDmRes.reason === 'DENIED' || userDmRes.reason === 'BOT_NOT_ADMIN' || (userDmRes.output && userDmRes.output.includes('grup')),
                        `Group command .${name} in DM should indicate group requirement`
                    )
                }

                // ── Variant b: Regular User in Group ──
                const userGroupCtx = createVariantContext('USER_GROUP', name, [])
                const userGroupRes = await dispatcherModule.dispatchCommand(name, [], userGroupCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                if (isOwnerCmd) {
                    assert.equal(userGroupRes.reason, 'DENIED', `Owner command .${name} must be DENIED for regular user in group`)
                } else if (isAdminCmd) {
                    assert.equal(userGroupRes.reason, 'DENIED', `Admin command .${name} must be DENIED for regular user in group`)
                }

                // ── Variant c: Group Admin in Group ──
                const adminGroupCtx = createVariantContext('ADMIN_GROUP', name, [])
                const adminGroupRes = await dispatcherModule.dispatchCommand(name, [], adminGroupCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                if (isOwnerOnlyCmd) {
                    assert.equal(adminGroupRes.reason, 'DENIED', `Owner-only command .${name} must be DENIED for group admin`)
                } else {
                    assert.notEqual(adminGroupRes.reason, 'DENIED', `Command .${name} must not be DENIED for group admin`)
                }

                // ── Variant e: Bot Without Group-Admin Rights (Layer 4) ──
                if (cmd.requireBotAdmin) {
                    const noAdminCtx = createVariantContext('BOT_NOT_ADMIN', name, [])
                    const noAdminRes = await dispatcherModule.dispatchCommand(name, [], noAdminCtx, {
                        captureOutput: true,
                        sendToChat: false
                    })
                    assert.equal(noAdminRes.success, false, `Bot without admin rights must fail on .${name}`)
                    assert.equal(noAdminRes.reason, 'BOT_NOT_ADMIN', `Expected BOT_NOT_ADMIN on .${name}`)
                }

                // ── Variant d: Bot Owner Execution in DM & Group ──
                // For internal commands, execute benign args; for external commands, execute empty args to verify permission without live network calls
                const isExternal = detectExternalDependencies(cmd.filePath) !== 'None (Internal/Offline)'
                const testArgs = isExternal ? [] : getBenignArgs(cmd)

                const ownerDmCtx = createVariantContext('OWNER_DM', name, testArgs)
                const ownerDmRes = await dispatcherModule.dispatchCommand(name, ownerDmCtx.args, ownerDmCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                assert.notEqual(ownerDmRes.reason, 'DENIED', `Owner must never be DENIED in DM on .${name}`)

                const ownerGroupCtx = createVariantContext('OWNER_GROUP', name, testArgs)
                const ownerGroupRes = await dispatcherModule.dispatchCommand(name, ownerGroupCtx.args, ownerGroupCtx, {
                    captureOutput: true,
                    sendToChat: false
                })
                assert.notEqual(ownerGroupRes.reason, 'DENIED', `Owner must never be DENIED in group on .${name}`)

                // ── Variant f2: Missing Arguments Error Handling ──
                const compiled = registryModule.compileParameters(cmd)
                if (compiled.required && compiled.required.length > 0) {
                    const emptyCtx = createVariantContext(isGroupOnly ? 'ADMIN_GROUP' : 'OWNER_DM', name, [])
                    const emptyRes = await dispatcherModule.dispatchCommand(name, [], emptyCtx, {
                        captureOutput: true,
                        sendToChat: false
                    })
                    // When required args are missing, command should gracefully guide user or catch handled error
                    const out = (emptyRes.output || '').toLowerCase()
                    const hasUsageOrError = out.includes('cara pakai') ||
                        out.includes('contoh') ||
                        out.includes('usage') ||
                        out.includes('⚠️') ||
                        out.includes('❌') ||
                        out.includes('masukkan') ||
                        out.includes('tag') ||
                        out.includes('panduan') ||
                        out.includes('ketik') ||
                        out.includes('format') ||
                        emptyRes.reason === 'VALIDATION_FAILED' ||
                        emptyRes.success === false
                    assert.ok(hasUsageOrError, `Command .${name} with missing required args must handle error gracefully`)
                }
            } finally {
                if (restoreShield) restoreShield()
            }
        })
    }
})
})
