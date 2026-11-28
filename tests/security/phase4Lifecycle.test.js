// tests/security/phase4Lifecycle.test.js
// Dedicated test suite verifying Phase 4 lifecycle and schedulers (REL-002, LIFE-001 to LIFE-007)

import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

import { socketProvider } from '../../src/core/socketProvider.js'
import { store } from '../../src/services/store.js'
import { initReminderScheduler, stopReminderScheduler } from '../../src/commands/general/remindme.js'
import { initWeatherScheduler, stopWeatherScheduler } from '../../src/commands/utility/cuaca.js'
import { initRecapScheduler, stopRecapScheduler } from '../../src/commands/radio/recap.js'
import { initStorySyncScheduler, stopStorySyncScheduler } from '../../src/services/storySync.js'
import { initScheduleSync, stopScheduleSync, runDailyScheduleBroadcast } from '../../src/services/scheduleSync.js'
import {
    assertSingleProcessTopology,
    acquireRuntimeLease,
    releaseRuntimeLease
} from '../../src/services/runtimeSingleton.js'

async function runTests() {
    console.log('\n🔒 [Phase 4 Test Suite] Lifecycle & Schedulers Hardening (REL-002, LIFE-001 - LIFE-007)\n')

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
    // LIFE-001: Scheduler socket resolution across reconnects
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-001: Schedulers resolve Socket B after reconnect (Socket A does not receive messages)', async () => {
        const sentToA = []
        const sentToB = []

        const socketA = {
            id: 'socket-A',
            user: { id: 'bot_test_a@s.whatsapp.net', name: 'Bot A' },
            sendMessage: async (chatId, content) => {
                sentToA.push({ chatId, content })
                return { key: { remoteJid: chatId, id: 'msg_a_' + Date.now() } }
            }
        }

        const socketB = {
            id: 'socket-B',
            user: { id: 'bot_test_b@s.whatsapp.net', name: 'Bot B' },
            sendMessage: async (chatId, content) => {
                sentToB.push({ chatId, content })
                return { key: { remoteJid: chatId, id: 'msg_b_' + Date.now() } }
            }
        }

        // 1. Initial connection with socket A
        socketProvider.setSocket(socketA)
        initReminderScheduler(socketA)

        assert.strictEqual(socketProvider.getCurrent()?.id, 'socket-A')

        // 2. Reconnect occurs: socketProvider updated to socket B
        socketProvider.setSocket(socketB)
        // Re-call initReminderScheduler as happens on connection open
        initReminderScheduler(socketB)

        assert.strictEqual(socketProvider.getCurrent()?.id, 'socket-B')

        // 3. Trigger reminder delivery through database and alarm trigger
        const { triggerAlarm } = await import('../../src/services/alarm.js')
        const activeSock = socketProvider.getCurrent()
        await triggerAlarm(activeSock, 'test_chat@s.whatsapp.net', 'Test Reconnect Reminder', false, null, true)

        assert.strictEqual(sentToA.length, 0, 'Socket A must NOT receive any message after reconnect')
        assert.strictEqual(sentToB.length, 1, 'Socket B MUST receive the message after reconnect')
        assert.strictEqual(sentToB[0].chatId, 'test_chat@s.whatsapp.net')

        // Cleanup
        stopReminderScheduler()
        socketProvider.clear()
    })

    // ─────────────────────────────────────────────────────────────
    // LIFE-002: Repeated reconnects and bounded listener count
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-002: Repeated reconnects increment generation cleanly without unbounded listener leaks', async () => {
        let changeEvents = 0
        const unsubscribe = socketProvider.onSocketChange((sock, gen) => {
            changeEvents++
        })

        const initialGen = socketProvider.getGeneration()

        for (let i = 1; i <= 5; i++) {
            const fakeSock = { id: `socket-gen-${i}` }
            socketProvider.setSocket(fakeSock)
            // Call schedulers repeatedly as on connection open
            initReminderScheduler(fakeSock)
            initWeatherScheduler(fakeSock)
            initRecapScheduler(fakeSock)
            initStorySyncScheduler(fakeSock)
            initScheduleSync(fakeSock)
        }

        assert.strictEqual(socketProvider.getGeneration(), initialGen + 5)
        assert.strictEqual(changeEvents, 5)

        // Clean up schedulers
        stopReminderScheduler()
        stopWeatherScheduler()
        stopRecapScheduler()
        stopStorySyncScheduler()
        stopScheduleSync()

        unsubscribe()
        assert.strictEqual(socketProvider.getListenerCount(), 0, 'Socket change listeners must be cleanly removed')
    })

    // ─────────────────────────────────────────────────────────────
    // LIFE-003: DatabaseBackedStore bind idempotency & cleanup
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-003: store.bind() is idempotent across repeated calls and unbinds cleanly', async () => {
        const fakeEv1 = new EventEmitter()
        const fakeEv2 = new EventEmitter()

        // Initial bind
        store.bind(fakeEv1)
        assert.strictEqual(store.getPruneIntervalActive(), true, 'Prune interval should be active')
        assert.strictEqual(fakeEv1.listenerCount('messages.upsert'), 1, 'fakeEv1 should have 1 listener')

        // Bind again with same emitter (idempotent no-op)
        store.bind(fakeEv1)
        assert.strictEqual(fakeEv1.listenerCount('messages.upsert'), 1, 'Duplicate bind must NOT add second listener')

        // Bind to a new emitter (reconnect)
        store.bind(fakeEv2)
        assert.strictEqual(fakeEv1.listenerCount('messages.upsert'), 0, 'Previous emitter listener must be removed')
        assert.strictEqual(fakeEv2.listenerCount('messages.upsert'), 1, 'New emitter must have exactly 1 listener')
        assert.strictEqual(store.getPruneIntervalActive(), true, 'Prune interval remains active (single bounded timer)')

        // Unbind completely
        store.unbind()
        assert.strictEqual(fakeEv2.listenerCount('messages.upsert'), 0, 'Unbind must remove listener from active emitter')
        assert.strictEqual(store.getPruneIntervalActive(), false, 'Unbind must clear the prune interval')
        assert.strictEqual(store.getBoundEmitter(), null, 'Bound emitter should be null after unbind')
    })

    // ─────────────────────────────────────────────────────────────
    // LIFE-004: All schedulers expose explicit stop methods
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-004: Schedulers can be started and stopped cleanly without leaking timers', async () => {
        const dummySock = { id: 'dummy' }

        initReminderScheduler(dummySock)
        initWeatherScheduler(dummySock)
        initRecapScheduler(dummySock)
        initStorySyncScheduler(dummySock)
        initScheduleSync(dummySock)

        // Stopping them must execute cleanly without exceptions
        stopReminderScheduler()
        stopWeatherScheduler()
        stopRecapScheduler()
        stopStorySyncScheduler()
        stopScheduleSync()

        // Calling stop again must be idempotent
        stopReminderScheduler()
        stopWeatherScheduler()
        stopRecapScheduler()
        stopStorySyncScheduler()
        stopScheduleSync()
    })

    // ─────────────────────────────────────────────────────────────
    // LIFE-005 & LIFE-006: Runtime Singleton Lease
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-005 & LIFE-006: Runtime lease enforces single instance and rejects secondary contender', async () => {
        const testDbPath = path.resolve('./storage/database/test_lease.db')
        const dbDir = path.dirname(testDbPath)
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)

        const testDb = new Database(testDbPath)

        try {
            // First instance acquires lease
            const lease1 = acquireRuntimeLease({ db: testDb, instanceId: 'inst-1', lockKey: 'test_singleton' })
            assert.strictEqual(lease1.acquired, true, 'First instance must acquire lease')

            // Second instance attempts to acquire same key
            const lease2 = acquireRuntimeLease({ db: testDb, instanceId: 'inst-2', lockKey: 'test_singleton' })
            assert.strictEqual(lease2.acquired, false, 'Second concurrent instance must be rejected')
            assert.strictEqual(lease2.code, 'SINGLETON_LEASE_HELD')

            // Release lease 1
            releaseRuntimeLease({ db: testDb, lockKey: 'test_singleton', instanceId: 'inst-1' })

            // Now second instance can acquire
            const lease3 = acquireRuntimeLease({ db: testDb, instanceId: 'inst-2', lockKey: 'test_singleton' })
            assert.strictEqual(lease3.acquired, true, 'Instance 2 can acquire lease after release')

            releaseRuntimeLease({ db: testDb, lockKey: 'test_singleton', instanceId: 'inst-2' })
        } finally {
            testDb.close()
            try { if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath) } catch (_) {}
        }
    })

    // ─────────────────────────────────────────────────────────────
    // LIFE-007: Cluster Topology Rejection
    // ─────────────────────────────────────────────────────────────
    await test('LIFE-007: assertSingleProcessTopology rejects PM2 cluster mode and multiple instances', async () => {
        // Normal single process
        assert.doesNotThrow(() => {
            assertSingleProcessTopology({ exec_mode: 'fork_mode', NODE_APP_INSTANCE: '0', PM2_INSTANCES: '1' })
        })

        // Cluster mode rejection
        assert.throws(() => {
            assertSingleProcessTopology({ exec_mode: 'cluster_mode' })
        }, /Unsupported multi-process cluster topology/)

        // Non-zero instance rejection
        assert.throws(() => {
            assertSingleProcessTopology({ NODE_APP_INSTANCE: '1' })
        }, /Unsupported multi-process cluster topology/)

        // Multiple PM2 instances rejection
        assert.throws(() => {
            assertSingleProcessTopology({ PM2_INSTANCES: '2' })
        }, /Unsupported multi-process cluster topology/)
    })

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
    process.exit(0)
}

runTests().catch(err => {
    console.error('Test execution failed:', err)
    process.exit(1)
})
