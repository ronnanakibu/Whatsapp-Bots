// src/services/runtimeSingleton.js
// Single-writer runtime topology assertion and atomic SQLite singleton lease.

import crypto from 'crypto'
import os from 'os'

const LEASE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS runtime_singleton_lease (
        lock_key TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL
    )
`

let activeLease = null
let leaseLost = false
let heartbeatTimer = null

/**
 * Rejects multi-worker PM2 cluster mode so Baileys and per-conversation locks run in a single process.
 */
export function assertSingleProcessTopology(env = process.env) {
    const execMode = String(env?.exec_mode || '').toLowerCase()
    const nodeAppInstance = Number(env?.NODE_APP_INSTANCE)
    const pm2Instances = Number(env?.PM2_INSTANCES)

    if (
        execMode === 'cluster_mode' ||
        (Number.isFinite(nodeAppInstance) && nodeAppInstance > 0) ||
        (Number.isFinite(pm2Instances) && pm2Instances > 1)
    ) {
        const err = new Error(
            `Unsupported multi-process cluster topology (exec_mode=${env?.exec_mode || 'unset'}, NODE_APP_INSTANCE=${env?.NODE_APP_INSTANCE ?? 'unset'}, PM2_INSTANCES=${env?.PM2_INSTANCES ?? 'unset'}). Run RonnBot in single-instance fork mode.`
        )
        err.code = 'UNSUPPORTED_CLUSTER_TOPOLOGY'
        throw err
    }
}

/**
 * Checks whether a local OS PID is currently alive.
 */
export function isPidAlive(pid) {
    const numPid = Number(pid)
    if (!Number.isInteger(numPid) || numPid <= 0) return false
    try {
        process.kill(numPid, 0)
        return true
    } catch (err) {
        if (err?.code === 'EPERM') return true
        return false
    }
}

/**
 * Refreshes the SQLite heartbeat for the active singleton lease; marks lease lost if overwritten or removed.
 */
export function verifyRuntimeLeaseHeartbeat() {
    if (!activeLease?.db || !activeLease?.instanceId) return true
    try {
        const nowSec = Math.floor(Date.now() / 1000)
        const result = activeLease.db
            .prepare('UPDATE runtime_singleton_lease SET heartbeat_at = ? WHERE lock_key = \'primary\' AND instance_id = ?')
            .run(nowSec, activeLease.instanceId)
        if (result.changes === 0) {
            leaseLost = true
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer)
                heartbeatTimer = null
            }
            return false
        }
        return true
    } catch (_) {
        leaseLost = true
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
        }
        return false
    }
}

/**
 * Acquires the single-writer SQLite runtime lease atomically, refusing split-brain ownership.
 */
export function acquireRuntimeLease({
    db,
    instanceId = crypto.randomUUID(),
    pid = process.pid,
    hostname = os.hostname(),
    heartbeatIntervalMs = 15000
} = {}) {
    if (!db) {
        return { acquired: false, code: 'SINGLETON_DB_UNAVAILABLE', holder: null }
    }

    db.exec(LEASE_TABLE_SQL)
    const nowSec = Math.floor(Date.now() / 1000)

    const tx = db.transaction(() => {
        const existing = db.prepare('SELECT * FROM runtime_singleton_lease WHERE lock_key = \'primary\'').get()
        if (!existing) {
            db.prepare(`
                INSERT INTO runtime_singleton_lease (lock_key, instance_id, pid, hostname, started_at, heartbeat_at)
                VALUES ('primary', ?, ?, ?, ?, ?)
            `).run(instanceId, pid, hostname, nowSec, nowSec)
            return { acquired: true, instanceId, pid, hostname }
        }

        if (existing.instance_id === instanceId) {
            db.prepare('UPDATE runtime_singleton_lease SET heartbeat_at = ? WHERE lock_key = \'primary\' AND instance_id = ?')
                .run(nowSec, instanceId)
            return { acquired: true, instanceId, pid, hostname }
        }

        if (existing.hostname !== hostname) {
            return {
                acquired: false,
                code: 'SINGLETON_LEASE_REMOTE_HOST',
                holder: existing
            }
        }

        if (isPidAlive(existing.pid)) {
            return {
                acquired: false,
                code: 'SINGLETON_LEASE_HELD',
                holder: existing
            }
        }

        db.prepare(`
            UPDATE runtime_singleton_lease
            SET instance_id = ?, pid = ?, hostname = ?, started_at = ?, heartbeat_at = ?
            WHERE lock_key = 'primary'
        `).run(instanceId, pid, hostname, nowSec, nowSec)

        return {
            acquired: true,
            recoveredFromPid: existing.pid,
            instanceId,
            pid,
            hostname
        }
    })

    const outcome = tx.immediate()
    if (!outcome.acquired) return outcome

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
    activeLease = { db, instanceId, pid, hostname }
    leaseLost = false

    if (Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(() => {
            verifyRuntimeLeaseHeartbeat()
        }, heartbeatIntervalMs)
        heartbeatTimer.unref?.()
    }

    return outcome
}

/**
 * Returns false once an acquired singleton lease has been detected as lost.
 */
export function isRuntimeLeaseHealthy() {
    return !leaseLost
}

/**
 * Releases the SQLite singleton lease owned by this process on graceful shutdown.
 */
export function releaseRuntimeLease() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
    if (activeLease?.db && activeLease?.instanceId) {
        try {
            activeLease.db
                .prepare('DELETE FROM runtime_singleton_lease WHERE lock_key = \'primary\' AND instance_id = ?')
                .run(activeLease.instanceId)
        } catch (_) {}
    }
    activeLease = null
}

/**
 * Resets in-memory singleton lease tracking state (for isolated test suites only).
 */
export function resetRuntimeLeaseStateForTest() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }
    activeLease = null
    leaseLost = false
}
