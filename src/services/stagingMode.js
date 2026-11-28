// src/services/stagingMode.js
// Explicit Staging-Safe Runtime Mode, Isolation Guardrails & Non-Network WhatsApp Simulation Adapter.

import crypto from 'node:crypto'
import path from 'node:path'

const WEAK_SECRETS = new Set([
    'ronnbot-default-jwt-secret-key-123456!',
    'ronnbot_default_jwt_secret_key_123456!',
    'make_this_a_long_random_hash',
    'secret',
    'changeme',
    'default'
])

function isTruthyFlag(val) {
    const norm = String(val || '').trim().toLowerCase()
    return norm === '1' || norm === 'true' || norm === 'yes'
}

function normalizeForContainment(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase()
}

export function isStagingMode(env = process.env) {
    const runtimeMode = String(env?.RONNBOT_RUNTIME_MODE || '').trim().toLowerCase()
    return runtimeMode === 'staging' || isTruthyFlag(env?.RONNBOT_STAGE_SAFE_MODE)
}

export function isStageSafeMode(env = process.env) {
    return isStagingMode(env)
}

/**
 * Enforces strict resource, port, storage, and dual-secret isolation whenever staging mode is enabled.
 */
export function assertStagingIsolation(env = process.env) {
    if (!isStagingMode(env)) {
        return { ok: true, mode: 'production', safeMode: false }
    }

    const dbPath = String(env?.DB_PATH || '').trim()
    if (!dbPath) {
        const err = new Error('FATAL: RONNBOT_STAGE_SAFE_MODE requires an explicit isolated DB_PATH.')
        err.code = 'STAGING_MISSING_DB_PATH'
        throw err
    }

    const prodDbDefault = normalizeForContainment(path.resolve('./storage/database/main.db'))
    const resolvedDb = normalizeForContainment(path.resolve(dbPath))
    const sessionPath = String(env?.SESSION_PATH || '').trim()
    const storagePaths = [
        dbPath,
        resolvedDb,
        sessionPath,
        String(env?.MEDIA_DIR || '').trim(),
        String(env?.STORAGE_DIR || '').trim()
    ].filter(Boolean)

    for (const candidate of storagePaths) {
        if (normalizeForContainment(candidate).includes('/root/ronn.wa')) {
            const err = new Error(`FATAL: Staging path collision with production /root/ronn.wa detected (${candidate}).`)
            err.code = 'STAGING_PROD_PATH_COLLISION'
            throw err
        }
    }

    if (resolvedDb === prodDbDefault) {
        const err = new Error('FATAL: Staging DB_PATH cannot target default repository storage/database/main.db.')
        err.code = 'STAGING_DEFAULT_DB_COLLISION'
        throw err
    }

    const effectivePort = String(env?.PORT || env?.RADIO_PORT || '').trim()
    if (effectivePort === '3067') {
        const err = new Error('FATAL: Staging backend cannot bind production port 3067.')
        err.code = 'STAGING_PROD_PORT_COLLISION'
        throw err
    }

    const ctrlSecret = String(env?.CONTROL_JWT_SECRET || '').trim()
    const radioSecret = String(env?.RADIO_JWT_SECRET || '').trim()
    if (ctrlSecret.length < 16 || WEAK_SECRETS.has(ctrlSecret)) {
        const err = new Error('FATAL: Staging mode requires a strong CONTROL_JWT_SECRET (>= 16 chars).')
        err.code = 'STAGING_WEAK_CONTROL_SECRET'
        throw err
    }
    if (radioSecret.length < 16 || WEAK_SECRETS.has(radioSecret)) {
        const err = new Error('FATAL: Staging mode requires a strong RADIO_JWT_SECRET (>= 16 chars).')
        err.code = 'STAGING_WEAK_RADIO_SECRET'
        throw err
    }
    if (ctrlSecret === radioSecret) {
        const err = new Error('FATAL: Staging CONTROL_JWT_SECRET and RADIO_JWT_SECRET must be distinct.')
        err.code = 'STAGING_IDENTICAL_SECRETS'
        throw err
    }

    return {
        ok: true,
        mode: 'staging',
        safeMode: true,
        port: effectivePort || '3068',
        dbPath
    }
}

/**
 * Non-network simulation adapter for isolated Inbox / Takeover tests; disabled outside staging-safe mode.
 */
export function createStagingWhatsAppAdapter(env = process.env) {
    if (!isStageSafeMode(env)) {
        const err = new Error('FATAL: Staging WhatsApp simulation adapter cannot be used outside RONNBOT_STAGE_SAFE_MODE.')
        err.code = 'STAGING_ADAPTER_FORBIDDEN_IN_PROD'
        throw err
    }

    const sentLog = []
    return {
        isStagingAdapter: true,
        mode: 'STAGING_SIMULATION',
        user: null,
        async sendMessage(jid, content = {}) {
            if (sentLog.length >= 200) sentLog.shift()
            const record = {
                simulated: true,
                mode: 'STAGING_SIMULATION',
                key: {
                    id: `staging-sim-${crypto.randomUUID()}`,
                    remoteJid: jid,
                    fromMe: true
                },
                timestamp: Date.now(),
                contentPreview: typeof content?.text === 'string' ? content.text.slice(0, 120) : '[media]'
            }
            sentLog.push(record)
            return record
        },
        getSimulatedMessages() {
            return [...sentLog]
        }
    }
}
