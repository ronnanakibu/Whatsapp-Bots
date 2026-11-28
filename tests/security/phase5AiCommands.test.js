// tests/security/phase5AiCommands.test.js
// Dedicated test suite verifying Phase 5 AI & Commands Hardening (FUNC-001, CMD-001, ARCH-001, OPS-006)

import assert from 'node:assert'
import axios from 'axios'

import { translateText } from '../../src/commands/utility/translate.js'
import {
    initializeRegistry,
    getCommand,
    getToolSchemas,
    generatePromptToolDefinitions,
    setCommandEnabled,
    setCommandPermissions,
    invalidateRegistryCaches
} from '../../src/core/registry.js'
import { RuntimeOrchestrator, ORCHESTRATOR_STATUS } from '../../src/services/orchestrator/orchestrator.js'
import { buildAiProviderTelemetry } from '../../src/server/telemetry.js'

async function runTests() {
    console.log('\n🔒 [Phase 5 Test Suite] AI, Command Registry & Job Architecture Hardening\n')

    let passed = 0
    let failed = 0

    const test = async (name, fn) => {
        try {
            await fn()
            console.log(`  ✅ PASS: ${name}`)
            passed++
        } catch (err) {
            console.error(`  ❌ FAIL: ${name}`)
            console.error(`     Error: ${err.message}`)
            failed++
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 1. FUNC-001: Translate parameters & query string
    // ─────────────────────────────────────────────────────────────
    await test('FUNC-001.1: translateText validates empty or missing input text', async () => {
        await assert.rejects(
            async () => translateText('', 'en'),
            /Teks yang akan diterjemahkan tidak boleh kosong/
        )
        await assert.rejects(
            async () => translateText(null, 'en'),
            /Teks yang akan diterjemahkan tidak boleh kosong/
        )
    })

    await test('FUNC-001.2: translateText passes proper Google Translate query parameters', async () => {
        // Intercept axios.get to inspect query parameters
        const originalGet = axios.get
        let interceptedUrl = null
        let interceptedParams = null

        try {
            axios.get = async (url, config) => {
                interceptedUrl = url
                interceptedParams = config?.params
                return {
                    status: 200,
                    data: [
                        [
                            ['Hello world', 'Halo dunia', null, null, 1]
                        ],
                        null,
                        'id'
                    ]
                }
            }

            const result = await translateText('Halo dunia', 'en', 'id')
            assert.strictEqual(interceptedUrl, 'https://translate.googleapis.com/translate_a/single')
            assert.deepStrictEqual(interceptedParams, {
                client: 'gtx',
                sl: 'id',
                tl: 'en',
                dt: 't',
                q: 'Halo dunia'
            })
            assert.strictEqual(result.translated, 'Hello world')
            assert.strictEqual(result.detectedLang, 'id')
            assert.strictEqual(result.targetLang, 'en')
        } finally {
            axios.get = originalGet
        }
    })

    // ─────────────────────────────────────────────────────────────
    // 2. CMD-001: Tool schema & prompt cache invalidation
    // ─────────────────────────────────────────────────────────────
    await test('CMD-001.1: Tool schema cache invalidates when command is disabled/enabled', async () => {
        await initializeRegistry()

        const initialSchemas = getToolSchemas({ role: 'user' })
        const pingSchemaBefore = initialSchemas.find(s => s.function?.name === 'ping')
        assert.ok(pingSchemaBefore, 'ping command must initially be present in user tool schemas')

        // Disable ping command
        const disabled = setCommandEnabled('ping', false)
        assert.strictEqual(disabled, true)

        const schemasAfterDisable = getToolSchemas({ role: 'user' })
        const pingSchemaAfter = schemasAfterDisable.find(s => s.function?.name === 'ping')
        assert.strictEqual(pingSchemaAfter, undefined, 'ping command must NOT be present in tool schemas after disable')

        // Re-enable ping command
        const reenabled = setCommandEnabled('ping', true)
        assert.strictEqual(reenabled, true)

        const schemasAfterReenable = getToolSchemas({ role: 'user' })
        const pingSchemaRestored = schemasAfterReenable.find(s => s.function?.name === 'ping')
        assert.ok(pingSchemaRestored, 'ping command must be restored in tool schemas after re-enabling')
    })

    await test('CMD-001.2: Tool schema cache invalidates when command permissions change', async () => {
        const cmd = getCommand('ping')
        const originalPermissions = [...cmd.permissions]

        try {
            // Demote ping from 'user' to 'owner' only
            setCommandPermissions('ping', ['owner'])

            const userSchemas = getToolSchemas({ role: 'user' })
            assert.strictEqual(userSchemas.find(s => s.function?.name === 'ping'), undefined, 'User schemas must exclude owner-only ping')

            const ownerSchemas = getToolSchemas({ role: 'owner' })
            assert.ok(ownerSchemas.find(s => s.function?.name === 'ping'), 'Owner schemas must include ping')
        } finally {
            // Restore
            setCommandPermissions('ping', originalPermissions)
        }
    })

    await test('CMD-001.3: Prompt definitions cache invalidates on command changes', async () => {
        const promptBefore = generatePromptToolDefinitions({ role: 'user' })
        assert.ok(promptBefore.includes('ping'), 'Prompt must initially include ping')

        setCommandEnabled('ping', false)
        const promptAfter = generatePromptToolDefinitions({ role: 'user' })
        assert.strictEqual(promptAfter.includes('**ping**'), false, 'Prompt must exclude disabled ping')

        setCommandEnabled('ping', true)
        const promptRestored = generatePromptToolDefinitions({ role: 'user' })
        assert.ok(promptRestored.includes('**ping**'), 'Prompt must restore ping')
    })

    // ─────────────────────────────────────────────────────────────
    // 3. SEC-001 / Prompt Sanitization: No Unconditional Auto-Cook
    // ─────────────────────────────────────────────────────────────
    await test('SEC-001.5: System prompt definitions do NOT contain unconditional auto-cook instructions', async () => {
        const prompt = generatePromptToolDefinitions({ role: 'user' })
        assert.strictEqual(
            prompt.includes('CRITICAL AUTONOMOUS AUTO-COOK RULE'),
            false,
            'Prompt definitions must NOT contain the legacy unconditional auto-cook rule'
        )
        assert.strictEqual(
            prompt.includes('AUTONOMOUSLY execute the `cook` tool'),
            false,
            'Prompt definitions must NOT force autonomous execution of cook'
        )
    })

    // ─────────────────────────────────────────────────────────────
    // 4. ARCH-001: RuntimeOrchestrator Designation & Telemetry
    // ─────────────────────────────────────────────────────────────
    await test('ARCH-001: RuntimeOrchestrator is clearly designated experimental and advisory', async () => {
        assert.strictEqual(ORCHESTRATOR_STATUS, 'experimental')
        assert.strictEqual(RuntimeOrchestrator.status, 'experimental')
        assert.strictEqual(RuntimeOrchestrator.isExperimental, true)

        const telemetry = buildAiProviderTelemetry()
        assert.strictEqual(telemetry.orchestratorStatus, 'experimental')
        assert.strictEqual(telemetry.enforcementScope, 'advisory')
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
    process.exit(0)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
