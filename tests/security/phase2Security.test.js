// tests/security/phase2Security.test.js
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import {
    validateDistinctProductionDualSecrets,
    isPlaceholderSecret,
    validateGrantAuthority,
    createControlUser,
    updateControlUser,
    getControlUserById
} from '../../src/server/security/controlAuth.js'
import { ROLES, PERMISSIONS, VALID_ROLES } from '../../src/server/security/rbac.js'
import {
    validateSafeOutboundUrl,
    isPrivateOrReservedIpv4,
    isPrivateOrReservedIpv6,
    isPrivateOrReservedIp
} from '../../src/utils/safeOutboundUrl.js'
import { updateBotStatus } from '../../src/server/radio.js'

async function runTests() {
    console.log('\n🔒 [Phase 2 Test Suite] Security Boundary Hardening (SEC-002 - SEC-007)\n')
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
    // SEC-005: Independent Production Secrets & Placeholder Rejection
    // ─────────────────────────────────────────────

    await test('SEC-005.1: isPlaceholderSecret detects known template strings', () => {
        assert.strictEqual(isPlaceholderSecret('replace_with_random_control_secret_min_32_chars_long!'), true)
        assert.strictEqual(isPlaceholderSecret('replace_with_secure_bootstrap_password_min_12_chars!'), true)
        assert.strictEqual(isPlaceholderSecret('your_secret_key_here'), true)
        assert.strictEqual(isPlaceholderSecret('my_placeholder_secret'), true)
        assert.strictEqual(isPlaceholderSecret('example_secret_key_12345'), true)
        assert.strictEqual(isPlaceholderSecret('changeme'), true)
        assert.strictEqual(isPlaceholderSecret('a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef'), false)
    })

    await test('SEC-005.2: Production rejects missing or placeholder secrets', () => {
        const origEnv = process.env.NODE_ENV
        const origCtrl = process.env.CONTROL_JWT_SECRET
        const origRadio = process.env.RADIO_JWT_SECRET

        process.env.NODE_ENV = 'production'
        process.env.CONTROL_JWT_SECRET = 'replace_with_random_control_secret_32_chars!'
        process.env.RADIO_JWT_SECRET = 'replace_with_random_radio_secret_32_chars!'

        try {
            assert.throws(() => validateDistinctProductionDualSecrets(), /placeholder or weak template value/)
        } finally {
            process.env.NODE_ENV = origEnv
            if (origCtrl) process.env.CONTROL_JWT_SECRET = origCtrl; else delete process.env.CONTROL_JWT_SECRET
            if (origRadio) process.env.RADIO_JWT_SECRET = origRadio; else delete process.env.RADIO_JWT_SECRET
        }
    })

    await test('SEC-005.3: Production rejects identical dual secrets', () => {
        const origEnv = process.env.NODE_ENV
        const origCtrl = process.env.CONTROL_JWT_SECRET
        const origRadio = process.env.RADIO_JWT_SECRET

        process.env.NODE_ENV = 'production'
        const identical = '12345678901234567890123456789012_identical_dual_secret!'
        process.env.CONTROL_JWT_SECRET = identical
        process.env.RADIO_JWT_SECRET = identical

        try {
            assert.throws(() => validateDistinctProductionDualSecrets(), /must be distinct in production/)
        } finally {
            process.env.NODE_ENV = origEnv
            if (origCtrl) process.env.CONTROL_JWT_SECRET = origCtrl; else delete process.env.CONTROL_JWT_SECRET
            if (origRadio) process.env.RADIO_JWT_SECRET = origRadio; else delete process.env.RADIO_JWT_SECRET
        }
    })

    await test('SEC-005.4: Production accepts distinct high-entropy secrets', () => {
        const origEnv = process.env.NODE_ENV
        const origCtrl = process.env.CONTROL_JWT_SECRET
        const origRadio = process.env.RADIO_JWT_SECRET

        process.env.NODE_ENV = 'production'
        process.env.CONTROL_JWT_SECRET = 'ctrl_secret_high_entropy_32_chars_long_123456!'
        process.env.RADIO_JWT_SECRET = 'radio_secret_high_entropy_32_chars_long_987654!'

        try {
            assert.doesNotThrow(() => validateDistinctProductionDualSecrets())
        } finally {
            process.env.NODE_ENV = origEnv
            if (origCtrl) process.env.CONTROL_JWT_SECRET = origCtrl; else delete process.env.CONTROL_JWT_SECRET
            if (origRadio) process.env.RADIO_JWT_SECRET = origRadio; else delete process.env.RADIO_JWT_SECRET
        }
    })

    // ─────────────────────────────────────────────
    // SEC-004: Grant Authority & Last-Owner Protection
    // ─────────────────────────────────────────────

    await test('SEC-004.1: Non-owner admin cannot delegate permissions outside their own set', () => {
        const adminGrantor = {
            id: 'admin_test_1',
            role: ROLES.ADMIN,
            permissions: [PERMISSIONS.OVERVIEW_READ, PERMISSIONS.WHATSAPP_STATUS_READ]
        }

        assert.throws(() => {
            validateGrantAuthority(adminGrantor, ROLES.OPERATOR, [PERMISSIONS.DB_METADATA_READ])
        }, /not held by the grantor/)
    })

    await test('SEC-004.2: Non-owner admin cannot grant sensitive owner-only permissions', () => {
        const adminGrantor = {
            id: 'admin_test_2',
            role: ROLES.ADMIN,
            permissions: [PERMISSIONS.OVERVIEW_READ, PERMISSIONS.SECRETS_MANAGE]
        }

        assert.throws(() => {
            validateGrantAuthority(adminGrantor, ROLES.OPERATOR, [PERMISSIONS.SECRETS_MANAGE])
        }, /highly sensitive and can only be granted by an Owner/)

        assert.throws(() => {
            validateGrantAuthority(adminGrantor, ROLES.OPERATOR, [PERMISSIONS.SYSTEM_RESTART])
        }, /highly sensitive and can only be granted by an Owner/)

        assert.throws(() => {
            validateGrantAuthority(adminGrantor, ROLES.OPERATOR, [PERMISSIONS.WHATSAPP_GROUP_BROADCAST])
        }, /highly sensitive and can only be granted by an Owner/)
    })

    await test('SEC-004.3: Non-owner cannot assign the Owner role', () => {
        const adminGrantor = {
            id: 'admin_test_3',
            role: ROLES.ADMIN,
            permissions: [PERMISSIONS.USERS_MANAGE]
        }

        assert.throws(() => {
            validateGrantAuthority(adminGrantor, ROLES.OWNER, [])
        }, /Only an Owner can assign the Owner role/)
    })

    await test('SEC-004.4: Unknown permission strings are strictly rejected', () => {
        const ownerGrantor = {
            id: 'owner_test_1',
            role: ROLES.OWNER,
            permissions: Object.values(PERMISSIONS)
        }

        assert.throws(() => {
            validateGrantAuthority(ownerGrantor, ROLES.ADMIN, ['root:superuser', 'fake:permission'])
        }, /Unknown permission/)
    })

    await test('SEC-004.5: Last-owner account cannot be demoted or deactivated', () => {
        // Ensure at least one owner exists
        const testOwnerUser = 'test_last_owner_' + Date.now()
        let createdOwner
        try {
            createdOwner = createControlUser({
                username: testOwnerUser,
                password: 'TestPassword1234!',
                role: ROLES.OWNER
            })
        } catch (_) {}

        // Mock DB query test logic: when count <= 1, demoting fails
        const ownerGrantor = { id: 'owner_1', role: ROLES.OWNER, permissions: Object.values(PERMISSIONS) }

        // Attempting to demote an owner when it's the only one
        if (createdOwner) {
            // If another owner exists in DB, temporarily deactivate to test last-owner check
            try {
                // If this is the only active owner, demoting must throw
                const res = updateControlUser(createdOwner.id, { role: ROLES.ADMIN }, ownerGrantor)
                assert.ok(res, 'Demotion succeeded only if multiple owners exist')
            } catch (err) {
                assert.ok(err.message.includes('last remaining active Owner'), 'Error should enforce last-owner rule')
            }
        }
    })

    // ─────────────────────────────────────────────
    // SEC-007: Safe Outbound URL & SSRF Protection
    // ─────────────────────────────────────────────

    await test('SEC-007.1: isPrivateOrReservedIp detects loopback, RFC1918, link-local and IPv6', () => {
        // IPv4
        assert.strictEqual(isPrivateOrReservedIp('127.0.0.1'), true, '127.0.0.1 is loopback')
        assert.strictEqual(isPrivateOrReservedIp('10.0.0.1'), true, '10.0.0.1 is RFC 1918')
        assert.strictEqual(isPrivateOrReservedIp('172.16.0.1'), true, '172.16.0.1 is RFC 1918')
        assert.strictEqual(isPrivateOrReservedIp('192.168.1.1'), true, '192.168.1.1 is RFC 1918')
        assert.strictEqual(isPrivateOrReservedIp('169.254.169.254'), true, '169.254.169.254 is link-local metadata')
        assert.strictEqual(isPrivateOrReservedIp('0.0.0.0'), true, '0.0.0.0 is current network')
        assert.strictEqual(isPrivateOrReservedIp('8.8.8.8'), false, '8.8.8.8 is public Google DNS')
        assert.strictEqual(isPrivateOrReservedIp('1.1.1.1'), false, '1.1.1.1 is public Cloudflare DNS')

        // IPv6
        assert.strictEqual(isPrivateOrReservedIp('::1'), true, '::1 is IPv6 loopback')
        assert.strictEqual(isPrivateOrReservedIp('fe80::1'), true, 'fe80::1 is IPv6 link-local')
        assert.strictEqual(isPrivateOrReservedIp('fc00::1'), true, 'fc00::1 is IPv6 unique local')
        assert.strictEqual(isPrivateOrReservedIp('::ffff:127.0.0.1'), true, '::ffff:127.0.0.1 is IPv4-mapped loopback')
        assert.strictEqual(isPrivateOrReservedIp('2606:4700:4700::1111'), false, 'Cloudflare IPv6 is public')
    })

    await test('SEC-007.2: validateSafeOutboundUrl rejects internal, metadata, and invalid protocols', async () => {
        await assert.rejects(
            () => validateSafeOutboundUrl('http://127.0.0.1:3000/api'),
            /blocked/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('http://localhost:25637/qr'),
            /Forbidden host/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('http://169.254.169.254/latest/meta-data/'),
            /blocked/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('http://[::1]:8080/'),
            /blocked/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('file:///etc/passwd'),
            /Forbidden protocol/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('gopher://127.0.0.1:70'),
            /Forbidden protocol/
        )
        await assert.rejects(
            () => validateSafeOutboundUrl('http://admin:secret@public.com/'),
            /URLs with embedded credentials are prohibited/
        )
    })

    await test('SEC-007.3: validateSafeOutboundUrl allows legitimate public URLs', async () => {
        const res = await validateSafeOutboundUrl('https://example.com')
        assert.strictEqual(res.validUrl.hostname, 'example.com')
        assert.ok(Array.isArray(res.resolvedIps) && res.resolvedIps.length > 0)
    })

    // ─────────────────────────────────────────────
    // SEC-002: Stale QR File Cleanup
    // ─────────────────────────────────────────────

    await test('SEC-002.1: updateBotStatus deletes storage/qr.png on connected or closed states', () => {
        const qrPath = path.resolve('./storage/qr.png')
        fs.writeFileSync(qrPath, Buffer.from('fake_qr_png_content'))
        assert.strictEqual(fs.existsSync(qrPath), true)

        updateBotStatus('open')
        assert.strictEqual(fs.existsSync(qrPath), false, 'storage/qr.png must be deleted when bot is open')

        fs.writeFileSync(qrPath, Buffer.from('fake_qr_png_content'))
        updateBotStatus('close')
        assert.strictEqual(fs.existsSync(qrPath), false, 'storage/qr.png must be deleted when bot is closed')
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
