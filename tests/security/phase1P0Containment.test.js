// tests/security/phase1P0Containment.test.js
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { dynamicSkills, BUILTIN_HANDLERS } from '../../src/services/dynamicSkills.js'
import { migrateArchivesToTelegram } from '../../start.js'

async function runTests() {
    console.log('\n🔒 [Phase 1 Test Suite] P0 Containment (SEC-001, DATA-001, REL-001)\n')
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

    // ─────────────────────────────────────────────
    // SEC-001: Dynamic Skills Execution Containment
    // ─────────────────────────────────────────────

    await test('SEC-001.1: Dynamic skills execution is disabled by default in production', async () => {
        const originalEnv = process.env.ENABLE_DYNAMIC_SKILL_EXECUTION
        delete process.env.ENABLE_DYNAMIC_SKILL_EXECUTION

        try {
            const dynamicSkill = {
                id: 'untrusted_custom_eval',
                name: 'Arbitrary Skill',
                code: 'async () => "pwned"'
            }
            const result = await dynamicSkills.executeSkill(dynamicSkill, {})
            assert.ok(typeof result === 'string', 'Result should be string')
            assert.ok(result.includes('SEC-001'), 'Result should reference SEC-001 security policy')
        } finally {
            if (originalEnv !== undefined) process.env.ENABLE_DYNAMIC_SKILL_EXECUTION = originalEnv
        }
    })

    await test('SEC-001.2: AI Router silent mode returns null for non-builtin skill when execution disabled', async () => {
        const originalEnv = process.env.ENABLE_DYNAMIC_SKILL_EXECUTION
        delete process.env.ENABLE_DYNAMIC_SKILL_EXECUTION

        try {
            const dynamicSkill = {
                id: 'untrusted_custom_eval',
                name: 'Arbitrary Skill',
                code: 'async () => "pwned"'
            }
            const result = await dynamicSkills.executeSkill(dynamicSkill, {}, { silent: true })
            assert.strictEqual(result, null, 'Silent mode should return null so AI Router falls through')
        } finally {
            if (originalEnv !== undefined) process.env.ENABLE_DYNAMIC_SKILL_EXECUTION = originalEnv
        }
    })

    await test('SEC-001.3: Builtin handlers execute safely without arbitrary VM', async () => {
        assert.ok(BUILTIN_HANDLERS['bot_groups_count'], 'bot_groups_count handler should exist')
        assert.ok(BUILTIN_HANDLERS['bot_system_specs'], 'bot_system_specs handler should exist')

        const groupsSkill = { id: 'bot_groups_count', name: 'Groups' }
        const resGroups = await dynamicSkills.executeSkill(groupsSkill, {})
        assert.ok(typeof resGroups === 'string', 'Should return formatted text')
        assert.ok(resGroups.includes('grup WhatsApp aktif'), 'Should output group count info')

        const specsSkill = { id: 'bot_system_specs', name: 'Specs' }
        const resSpecs = await dynamicSkills.executeSkill(specsSkill, {})
        assert.ok(typeof resSpecs === 'string', 'Should return formatted text')
        assert.ok(resSpecs.includes('STATUS SISTEM'), 'Should output specs info')
    })

    await test('SEC-001.4: Sandbox does NOT expose raw sock, db, store, process, or fs when opt-in enabled', async () => {
        const originalEnv = process.env.ENABLE_DYNAMIC_SKILL_EXECUTION
        process.env.ENABLE_DYNAMIC_SKILL_EXECUTION = 'true'

        try {
            const probeSkill = {
                id: 'probe_leak',
                name: 'Probe Sandbox Leaks',
                code: `async (ctx, bundle) => {
                    return JSON.stringify({
                        hasSock: typeof bundle.sock !== 'undefined' || typeof sock !== 'undefined',
                        hasDb: typeof bundle.db !== 'undefined' || typeof db !== 'undefined',
                        hasStore: typeof bundle.store !== 'undefined' || typeof store !== 'undefined',
                        hasProcess: typeof process !== 'undefined',
                        hasIntrospection: typeof bundle.introspection?.getGroupsCount === 'function'
                    });
                }`
            }

            const raw = await dynamicSkills.executeSkill(probeSkill, {})
            const parsed = JSON.parse(raw)

            assert.strictEqual(parsed.hasSock, false, 'sock must NOT be leaked')
            assert.strictEqual(parsed.hasDb, false, 'db must NOT be leaked')
            assert.strictEqual(parsed.hasStore, false, 'store must NOT be leaked')
            assert.strictEqual(parsed.hasProcess, false, 'process must NOT be leaked')
            assert.strictEqual(parsed.hasIntrospection, true, 'safe introspection should be present')
        } finally {
            if (originalEnv !== undefined) process.env.ENABLE_DYNAMIC_SKILL_EXECUTION = originalEnv
            else delete process.env.ENABLE_DYNAMIC_SKILL_EXECUTION
        }
    })

    // ─────────────────────────────────────────────
    // DATA-001 / REL-001: Archive Migration Data Preservation
    // ─────────────────────────────────────────────

    const fixtureDir = path.resolve('./storage/media/viewonce')
    const testFile = path.join(fixtureDir, 'viewonce_test_fixture.jpg')
    const manifestPath = path.resolve('./storage/media/migration_manifest.json')

    const ensureFixture = () => {
        if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true })
        fs.writeFileSync(testFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]))
    }

    const cleanupFixture = () => {
        try { if (fs.existsSync(testFile)) fs.unlinkSync(testFile) } catch {}
        try { if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath) } catch {}
    }

    await test('DATA-001.1: Files are preserved when Telegram credentials are missing', async () => {
        ensureFixture()
        const oldToken = process.env.TELEGRAM_BOT_TOKEN
        const oldChannel = process.env.TELEGRAM_CHANNEL_ID
        delete process.env.TELEGRAM_BOT_TOKEN
        delete process.env.TELEGRAM_CHANNEL_ID

        try {
            await migrateArchivesToTelegram()
            assert.ok(fs.existsSync(testFile), 'Fixture file must NOT be deleted when env vars are missing')
        } finally {
            if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken
            if (oldChannel) process.env.TELEGRAM_CHANNEL_ID = oldChannel
            cleanupFixture()
        }
    })

    await test('DATA-001.2: Files are preserved on Telegram API error response', async () => {
        ensureFixture()
        const oldToken = process.env.TELEGRAM_BOT_TOKEN
        const oldChannel = process.env.TELEGRAM_CHANNEL_ID
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token'
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel'

        const originalFetch = globalThis.fetch
        globalThis.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ ok: false, description: 'Bad Request: chat not found' })
        })

        try {
            await migrateArchivesToTelegram()
            assert.ok(fs.existsSync(testFile), 'Fixture file must NOT be deleted when Telegram returns error')
        } finally {
            globalThis.fetch = originalFetch
            if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken
            else delete process.env.TELEGRAM_BOT_TOKEN
            if (oldChannel) process.env.TELEGRAM_CHANNEL_ID = oldChannel
            else delete process.env.TELEGRAM_CHANNEL_ID
            cleanupFixture()
        }
    })

    await test('DATA-001.3: Files are preserved on network/fetch exception', async () => {
        ensureFixture()
        const oldToken = process.env.TELEGRAM_BOT_TOKEN
        const oldChannel = process.env.TELEGRAM_CHANNEL_ID
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token'
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel'

        const originalFetch = globalThis.fetch
        globalThis.fetch = async () => {
            throw new Error('ETIMEDOUT: Connection failed')
        }

        try {
            await migrateArchivesToTelegram()
            assert.ok(fs.existsSync(testFile), 'Fixture file must NOT be deleted when fetch throws')
        } finally {
            globalThis.fetch = originalFetch
            if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken
            else delete process.env.TELEGRAM_BOT_TOKEN
            if (oldChannel) process.env.TELEGRAM_CHANNEL_ID = oldChannel
            else delete process.env.TELEGRAM_CHANNEL_ID
            cleanupFixture()
        }
    })

    await test('DATA-001.4: File is deleted ONLY on verified 200 OK + data.ok + message_id', async () => {
        ensureFixture()
        const oldToken = process.env.TELEGRAM_BOT_TOKEN
        const oldChannel = process.env.TELEGRAM_CHANNEL_ID
        process.env.TELEGRAM_BOT_TOKEN = 'mock_token'
        process.env.TELEGRAM_CHANNEL_ID = 'mock_channel'

        const originalFetch = globalThis.fetch
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: { message_id: 12345 } })
        })

        try {
            await migrateArchivesToTelegram()
            assert.strictEqual(fs.existsSync(testFile), false, 'Fixture file should be unlinked after verified upload')
            assert.ok(fs.existsSync(manifestPath), 'Manifest should be created')
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
            assert.strictEqual(manifest['viewonce_test_fixture.jpg']?.status, 'completed')
            assert.strictEqual(manifest['viewonce_test_fixture.jpg']?.messageId, 12345)
        } finally {
            globalThis.fetch = originalFetch
            if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken
            else delete process.env.TELEGRAM_BOT_TOKEN
            if (oldChannel) process.env.TELEGRAM_CHANNEL_ID = oldChannel
            else delete process.env.TELEGRAM_CHANNEL_ID
            cleanupFixture()
        }
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
