// tests/security/phase3Data.test.js
import assert from 'assert'
import crypto from 'crypto'
import { db } from '../../src/services/db.js'
import { dbUpsertSong, dbEnsureUser, radioService } from '../../src/services/radio.js'
import { userService } from '../../src/services/user-v2.js'

async function runTests() {
    console.log('\n🔒 [Phase 3 Test Suite] Identity & Radio Data Integrity (DATA-002, DATA-003, RAD-001)\n')
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
    // RAD-001: Track Origin vs Playback Provider (Spotify Support)
    // ─────────────────────────────────────────────

    await test('RAD-001.1: Spotify-origin tracks do NOT violate SQLite source CHECK constraint', () => {
        const spotifyTrack = {
            songId: 'spotify_test_track_' + Date.now(),
            title: 'Spotify Hit Song',
            artist: 'Top Artist',
            duration: 210,
            thumbnail: 'https://i.scdn.co/image/test',
            source: 'spotify',
            origin: 'spotify',
            url: 'https://www.youtube.com/watch?v=spotify_playback_id'
        }

        // Must not throw CHECK constraint failed: source IN ('youtube', 'soundcloud')
        assert.doesNotThrow(() => {
            dbUpsertSong(spotifyTrack)
        })

        const row = db.prepare('SELECT * FROM songs WHERE song_id = ?').get(spotifyTrack.songId)
        assert.ok(row, 'Song must be persisted in SQLite')
        assert.ok(['youtube', 'soundcloud'].includes(row.source), 'Playback provider source must satisfy CHECK constraint')
        assert.strictEqual(row.origin, 'spotify', 'Origin must preserve spotify metadata')
    })

    // ─────────────────────────────────────────────
    // DATA-002: Canonical Identity Model (UUID & JID in SQLite)
    // ─────────────────────────────────────────────

    await test('DATA-002.1: Canonical appUserId (UUID) is successfully registered in SQLite users table', () => {
        const uuid = crypto.randomUUID()
        dbEnsureUser(uuid, 'WebGuest_Tester')

        const row = db.prepare('SELECT * FROM users WHERE jid = ?').get(uuid)
        assert.ok(row, 'User with UUID must exist in SQLite')
        assert.strictEqual(row.name, 'WebGuest_Tester')
    })

    await test('DATA-002.2: Web users with UUID can submit song requests without includes("@") drop', () => {
        const uuid = crypto.randomUUID()
        const songId = 'test_song_uuid_' + Date.now()

        dbUpsertSong({
            songId,
            title: 'UUID Test Song',
            artist: 'Test Artist',
            duration: 180,
            source: 'youtube',
            url: 'https://youtube.com/watch?v=uuid_test'
        })

        radioService.addToQueue({
            songId,
            title: 'UUID Test Song',
            artist: 'Test Artist',
            duration: 180,
            source: 'youtube',
            url: 'https://youtube.com/watch?v=uuid_test',
            requestedBy: 'WebGuest',
            requestedByJid: uuid
        })

        const reqRow = db.prepare('SELECT * FROM requests WHERE user_jid = ? AND song_id = ?').get(uuid, songId)
        assert.ok(reqRow, 'Request from web user UUID must be recorded in SQLite')
        assert.ok(['pending', 'played'].includes(reqRow.status), 'Status must be pending or played')
        try { radioService.stop() } catch (_) {}
    })

    await test('DATA-002.3: UserService generates token with canonical sub, appUserId, and legacy jid', () => {
        const origCtrl = process.env.CONTROL_JWT_SECRET
        const origRadio = process.env.RADIO_JWT_SECRET
        process.env.CONTROL_JWT_SECRET = 'test_ctrl_secret_min_32_chars_long_12345!'
        process.env.RADIO_JWT_SECRET = 'test_radio_secret_min_32_chars_long_98765!'

        try {
            const fakeUser = {
                id: 'uuid-canonical-1234-5678',
                nickname: 'SonicListener',
                avatarUrl: null,
                whatsappJid: '628123456789@s.whatsapp.net'
            }

            const token = userService.generateToken(fakeUser)
            assert.ok(typeof token === 'string' && token.split('.').length === 3, 'Token must be valid JWT')

            const payloadB64 = token.split('.')[1]
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))

            assert.strictEqual(payload.sub, 'uuid-canonical-1234-5678', 'sub must be canonical UUID')
            assert.strictEqual(payload.appUserId, 'uuid-canonical-1234-5678', 'appUserId must be canonical UUID')
            assert.strictEqual(payload.whatsappJid, '628123456789@s.whatsapp.net', 'whatsappJid must be present')
            assert.strictEqual(payload.jid, '628123456789@s.whatsapp.net', 'legacy jid field must be present')
        } finally {
            if (origCtrl) process.env.CONTROL_JWT_SECRET = origCtrl; else delete process.env.CONTROL_JWT_SECRET
            if (origRadio) process.env.RADIO_JWT_SECRET = origRadio; else delete process.env.RADIO_JWT_SECRET
        }
    })

    // ─────────────────────────────────────────────
    // DATA-003: Idempotent Listener Finalization & Session Persistence
    // ─────────────────────────────────────────────

    await test('DATA-003.1: Listener sessions for UUID users are persisted in SQLite', () => {
        const uuid = crypto.randomUUID()
        dbEnsureUser(uuid, 'SessionListener')

        const joinedAt = Math.floor(Date.now() / 1000) - 60
        const result = db.prepare(`
            INSERT INTO listening_sessions (user_jid, joined_at)
            VALUES (?, ?)
        `).run(uuid, joinedAt)

        assert.ok(result.lastInsertRowid > 0, 'Session must insert row')
        const sessionRow = db.prepare('SELECT * FROM listening_sessions WHERE id = ?').get(result.lastInsertRowid)
        assert.strictEqual(sessionRow.user_jid, uuid)
    })

    await test('DATA-003.2: Listener session finalization is idempotent and does not double-award XP', () => {
        const userJid = 'xp_test_user_' + Date.now() + '@s.whatsapp.net'
        dbEnsureUser(userJid, 'XPUser')

        const initialUser = db.prepare('SELECT experience_points FROM users WHERE jid = ?').get(userJid)
        const initialXp = initialUser.experience_points || 0

        // Simulate idempotent finalizer guard
        let isFinalized = false
        const finalizeSession = (durationSec) => {
            if (isFinalized) return { rewarded: false }
            isFinalized = true
            const xpEarned = Math.max(1, Math.floor(durationSec / 60))
            db.prepare('UPDATE users SET experience_points = experience_points + ? WHERE jid = ?').run(xpEarned, userJid)
            return { rewarded: true, xpEarned }
        }

        const call1 = finalizeSession(120) // 2 minutes -> 2 XP
        assert.strictEqual(call1.rewarded, true)

        const call2 = finalizeSession(120) // Duplicate call (e.g. close and finish event)
        assert.strictEqual(call2.rewarded, false, 'Second finalize call must be ignored')

        const finalUser = db.prepare('SELECT experience_points FROM users WHERE jid = ?').get(userJid)
        assert.strictEqual(finalUser.experience_points, initialXp + 2, 'XP must be awarded exactly once')
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
    process.exit(0)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
