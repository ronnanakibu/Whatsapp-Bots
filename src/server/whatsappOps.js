// src/server/whatsappOps.js
// Single-runtime Baileys WhatsApp state, session health, and short-lived QR/pairing tracker.
// Never persists QR strings or pairing codes to SQLite, logs, or disk, and never exposes credentials.

import qrcode from 'qrcode'
import { getSocket } from '../utils/logger.js'
import { redactSensitive } from './security/redaction.js'

export const QR_TTL_MS = 60 * 1000
export const PAIRING_CODE_TTL_MS = 120 * 1000

const STATE_MAP = Object.freeze({
    initializing: 'INITIALIZING',
    init: 'INITIALIZING',
    connecting: 'CONNECTING',
    qr: 'QR_PENDING',
    pairing: 'PAIRING',
    open: 'CONNECTED',
    connected: 'CONNECTED',
    close: 'DISCONNECTED',
    disconnected: 'DISCONNECTED',
    reconnecting: 'RECONNECTING',
    logged_out: 'LOGGED_OUT',
    error: 'ERROR',
    unavailable: 'UNAVAILABLE'
})

const runtimeState = {
    rawState: 'initializing',
    normalizedState: 'INITIALIZING',
    lastEventAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastSessionUpdateAt: null,
    lastDisconnectCode: null,
    lastDisconnectReason: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    qr: null,
    qrExpiresAt: null,
    pairingCode: null,
    pairingExpiresAt: null
}

export function normalizeWhatsAppState(rawState) {
    if (!rawState || typeof rawState !== 'string') return 'UNAVAILABLE'
    return STATE_MAP[rawState.trim().toLowerCase()] || 'UNAVAILABLE'
}

export function maskWhatsAppJid(jid) {
    if (!jid || typeof jid !== 'string') return null
    const local = jid.split('@')[0].split(':')[0]
    if (!local) return null
    if (local.length <= 4) return '****'
    const head = local.slice(0, 4)
    const tail = local.slice(-4)
    return `${head}****${tail}`
}

function clearTransientPairing() {
    runtimeState.qr = null
    runtimeState.qrExpiresAt = null
    runtimeState.pairingCode = null
    runtimeState.pairingExpiresAt = null
}

function expireStaleChallenges(now = Date.now()) {
    if (runtimeState.qr && runtimeState.qrExpiresAt && now >= runtimeState.qrExpiresAt) {
        runtimeState.qr = null
        runtimeState.qrExpiresAt = null
    }
    if (runtimeState.pairingCode && runtimeState.pairingExpiresAt && now >= runtimeState.pairingExpiresAt) {
        runtimeState.pairingCode = null
        runtimeState.pairingExpiresAt = null
    }
}

/**
 * Updates centralized in-memory Baileys runtime state from connection.update transitions.
 * Never writes QR or pairing secrets to disk or logs.
 */
export function recordWhatsAppStateChange(rawState, data = null, meta = {}) {
    const now = Date.now()
    const normalized = normalizeWhatsAppState(rawState)
    runtimeState.rawState = String(rawState || 'unknown')
    runtimeState.normalizedState = normalized
    runtimeState.lastEventAt = now

    if (typeof meta.reconnectCount === 'number') {
        runtimeState.reconnectAttempts = meta.reconnectCount
    }
    if (typeof meta.maxReconnectAttempts === 'number') {
        runtimeState.maxReconnectAttempts = meta.maxReconnectAttempts
    }

    if (normalized === 'QR_PENDING' && typeof data === 'string' && data.trim()) {
        runtimeState.qr = data
        runtimeState.qrExpiresAt = now + QR_TTL_MS
        runtimeState.pairingCode = null
        runtimeState.pairingExpiresAt = null
        runtimeState.lastSessionUpdateAt = now
    } else if (normalized === 'PAIRING' && typeof data === 'string' && data.trim()) {
        runtimeState.pairingCode = data
        runtimeState.pairingExpiresAt = now + PAIRING_CODE_TTL_MS
        runtimeState.qr = null
        runtimeState.qrExpiresAt = null
        runtimeState.lastSessionUpdateAt = now
    } else if (normalized === 'CONNECTED') {
        clearTransientPairing()
        runtimeState.reconnectAttempts = 0
        runtimeState.lastConnectedAt = now
        runtimeState.lastSessionUpdateAt = now
        runtimeState.lastDisconnectCode = null
        runtimeState.lastDisconnectReason = null
    } else if (normalized === 'DISCONNECTED' || normalized === 'LOGGED_OUT' || normalized === 'ERROR') {
        clearTransientPairing()
        runtimeState.lastDisconnectedAt = now
        if (meta.statusCode !== undefined) {
            runtimeState.lastDisconnectCode = meta.statusCode
        }
        if (meta.reason) {
            runtimeState.lastDisconnectReason = redactSensitive(String(meta.reason)).slice(0, 240)
        }
    }
}

export function markSessionCredsUpdated() {
    runtimeState.lastSessionUpdateAt = Date.now()
}

export function getWhatsAppStatusSnapshot(sockOverride = undefined) {
    expireStaleChallenges()
    const sock = sockOverride !== undefined ? sockOverride : getSocket()
    const hasSocket = Boolean(sock)
    const sockUser = sock?.user || null

    // Never infer CONNECTED merely from Node.js process health.
    let effectiveNormalized = runtimeState.normalizedState
    if (effectiveNormalized === 'CONNECTED' && !hasSocket) {
        effectiveNormalized = 'DISCONNECTED'
    }

    const sessionHealth =
        effectiveNormalized === 'CONNECTED'
            ? 'HEALTHY'
            : effectiveNormalized === 'LOGGED_OUT'
                ? 'LOGGED_OUT'
                : effectiveNormalized === 'QR_PENDING' || effectiveNormalized === 'PAIRING'
                    ? 'AWAITING_PAIRING'
                    : effectiveNormalized === 'RECONNECTING' || effectiveNormalized === 'CONNECTING'
                        ? 'RECOVERING'
                        : effectiveNormalized === 'ERROR'
                            ? 'DEGRADED'
                            : hasSocket
                                ? 'INITIALIZING'
                                : 'OFFLINE'

    return {
        rawState: runtimeState.rawState,
        state: effectiveNormalized,
        connected: effectiveNormalized === 'CONNECTED' && hasSocket,
        socketBound: hasSocket,
        identity: sockUser
            ? {
                maskedJid: maskWhatsAppJid(sockUser.id),
                pushName: sockUser.name || null
            }
            : null,
        session: {
            health: sessionHealth,
            authenticated: Boolean(sockUser?.id) && effectiveNormalized === 'CONNECTED',
            lastConnectedAt: runtimeState.lastConnectedAt,
            lastDisconnectedAt: runtimeState.lastDisconnectedAt,
            lastSessionUpdateAt: runtimeState.lastSessionUpdateAt,
            lastDisconnectCode: runtimeState.lastDisconnectCode,
            lastDisconnectReason: runtimeState.lastDisconnectReason
        },
        reconnect: {
            attempts: runtimeState.reconnectAttempts,
            maxAttempts: runtimeState.maxReconnectAttempts
        },
        pairing: {
            active: Boolean(runtimeState.qr || runtimeState.pairingCode),
            mode: runtimeState.qr ? 'qr' : runtimeState.pairingCode ? 'code' : null,
            expiresAt: runtimeState.qrExpiresAt || runtimeState.pairingExpiresAt || null
        },
        lastEventAt: runtimeState.lastEventAt,
        processUptimeSeconds: Math.floor(process.uptime()),
        source: 'baileys:runtime'
    }
}

export async function getPairingSnapshot() {
    const now = Date.now()
    const hadChallengeBeforeCheck = Boolean(runtimeState.qrExpiresAt || runtimeState.pairingExpiresAt)
    const expired = Boolean(
        (runtimeState.qr && runtimeState.qrExpiresAt && now >= runtimeState.qrExpiresAt) ||
        (runtimeState.pairingCode && runtimeState.pairingExpiresAt && now >= runtimeState.pairingExpiresAt)
    )
    expireStaleChallenges(now)

    let qrDataUrl = null
    if (runtimeState.qr) {
        try {
            qrDataUrl = await qrcode.toDataURL(runtimeState.qr)
        } catch {
            qrDataUrl = null
        }
    }

    const expiresAt = runtimeState.qrExpiresAt || runtimeState.pairingExpiresAt || null
    const ttlSeconds = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null

    return {
        state: runtimeState.normalizedState,
        hasQr: Boolean(qrDataUrl),
        qrDataUrl,
        hasPairingCode: Boolean(runtimeState.pairingCode),
        pairingCode: runtimeState.pairingCode,
        expiresAt,
        ttlSeconds,
        expired: expired || (!runtimeState.qr && !runtimeState.pairingCode && hadChallengeBeforeCheck && runtimeState.normalizedState === 'QR_PENDING'),
        timestamp: now
    }
}

export function resetWhatsAppOpsStateForTest() {
    runtimeState.rawState = 'initializing'
    runtimeState.normalizedState = 'INITIALIZING'
    runtimeState.lastEventAt = null
    runtimeState.lastConnectedAt = null
    runtimeState.lastDisconnectedAt = null
    runtimeState.lastSessionUpdateAt = null
    runtimeState.lastDisconnectCode = null
    runtimeState.lastDisconnectReason = null
    runtimeState.reconnectAttempts = 0
    runtimeState.maxReconnectAttempts = 5
    clearTransientPairing()
}
