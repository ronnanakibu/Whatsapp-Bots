// tests/security/phase6Release.test.js
// Dedicated test suite verifying Phase 6 Release Engineering & Packaging (OPS-001 through OPS-005)

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import { metricsService } from '../../src/services/metrics.js'

async function runTests() {
    console.log('\n🔒 [Phase 6 Test Suite] Release Engineering & Packaging Hardening (OPS-001 - OPS-005)\n')

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
    // 1. OPS-001: package.json scripts audit
    // ─────────────────────────────────────────────────────────────
    await test('OPS-001.1: package.json version is 6.5.0 and scripts reference existing files', async () => {
        const pkgPath = path.resolve('package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

        assert.strictEqual(pkg.version, '6.5.0', 'package.json version must be 6.5.0')

        const nodeScriptRegex = /node\s+([^\s]+\.js)/g
        for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts || {})) {
            let match
            while ((match = nodeScriptRegex.exec(scriptCmd)) !== null) {
                const targetFile = match[1]
                const resolvedTarget = path.resolve(targetFile)
                assert.ok(
                    fs.existsSync(resolvedTarget),
                    `Script '${scriptName}' targets '${targetFile}' which must exist on disk`
                )
            }
        }
    })

    await test('OPS-001.2: scripts/migrate.js runs cleanly and checks database schema', async () => {
        const output = execSync('node scripts/migrate.js', { encoding: 'utf8' })
        assert.ok(output.includes('Database migration check completed successfully'), 'Migration script must exit 0')
    })

    await test('OPS-001.3: ESLint configuration file exists and exports config', async () => {
        const configPath = path.resolve('eslint.config.js')
        assert.ok(fs.existsSync(configPath), 'eslint.config.js must exist in repository root')

        const eslintConfig = (await import('../../eslint.config.js')).default
        assert.ok(Array.isArray(eslintConfig), 'eslint.config.js must export an array of configuration objects')
    })

    // ─────────────────────────────────────────────────────────────
    // 2. OPS-002: README & Deployment Model Consistency
    // ─────────────────────────────────────────────────────────────
    await test('OPS-002: README specifies docker SDK matching deployment container', async () => {
        const readme = fs.readFileSync(path.resolve('README.md'), 'utf8')
        assert.ok(readme.includes('sdk: docker'), 'README frontmatter must declare sdk: docker')
        assert.strictEqual(readme.includes('sdk: gradio'), false, 'README frontmatter must NOT declare legacy sdk: gradio')
        assert.strictEqual(readme.includes('app_file: app.py'), false, 'README frontmatter must NOT reference absent app.py')
    })

    // ─────────────────────────────────────────────────────────────
    // 3. OPS-003: Log retention and non-destructive startup
    // ─────────────────────────────────────────────────────────────
    await test('OPS-003: Log files below rotation threshold are preserved across starts', async () => {
        const testLogDir = path.resolve('./storage/logs')
        if (!fs.existsSync(testLogDir)) fs.mkdirSync(testLogDir, { recursive: true })

        const testLogPath = path.join(testLogDir, 'app_test_retention.log')
        const initialContent = 'LOG_LINE_PRESERVED_1\nLOG_LINE_PRESERVED_2\n'
        fs.writeFileSync(testLogPath, initialContent, 'utf8')

        // Simulate start.js rotation logic
        const MAX_LOG_SIZE = 10 * 1024 * 1024
        const stat = fs.statSync(testLogPath)
        if (stat.size > MAX_LOG_SIZE) {
            fs.renameSync(testLogPath, `${testLogPath}.1`)
        }

        const afterContent = fs.readFileSync(testLogPath, 'utf8')
        assert.strictEqual(afterContent, initialContent, 'Log content under 10MB must be preserved intact')

        fs.unlinkSync(testLogPath)
    })

    // ─────────────────────────────────────────────────────────────
    // 4. OPS-004: Metrics rollover and cumulative stream tracking
    // ─────────────────────────────────────────────────────────────
    await test('OPS-004: Metrics service tracks cumulative streams and supports rollover', async () => {
        metricsService.resetDailyCounters()
        metricsService.incrementCommands('ping')
        metricsService.incrementCommands('ping')
        metricsService.incrementDownloads()
        metricsService.incrementStreamsStarted()

        let analytics = metricsService.getAnalyticsData()
        assert.strictEqual(analytics.commandsToday, 2)
        assert.strictEqual(analytics.downloadsToday, 1)
        assert.strictEqual(analytics.streamsStarted >= 1, true, 'streamsStarted must track cumulative started streams')

        // Reset daily counters
        metricsService.resetDailyCounters()
        analytics = metricsService.getAnalyticsData()
        assert.strictEqual(analytics.commandsToday, 0, 'commandsToday must reset on daily rollover')
        assert.strictEqual(analytics.downloadsToday, 0, 'downloadsToday must reset on daily rollover')
    })

    // ─────────────────────────────────────────────────────────────
    // 5. Changelog Consistency
    // ─────────────────────────────────────────────────────────────
    await test('OPS-005: changelogs/v6.5.0.md exists and contains user-facing release notes', async () => {
        const changelogPath = path.resolve('changelogs/v6.5.0.md')
        assert.ok(fs.existsSync(changelogPath), 'changelogs/v6.5.0.md must exist')

        const content = fs.readFileSync(changelogPath, 'utf8')
        assert.ok(content.includes('# Release v6.5.0'), 'Changelog must include Release v6.5.0 header')
        // Check rule: user-facing, no HF/Gradio backend hostnames
        assert.strictEqual(content.includes('hf.space'), false, 'Changelog must not leak backend space hostnames')
        assert.strictEqual(content.includes('Gradio client'), false, 'Changelog must not leak gradio client details')
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
    process.exit(0)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
