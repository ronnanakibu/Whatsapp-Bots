// src/services/inbox.js
// Durable SQLite WhatsApp Inbox store, Baileys ingestion & send adapter,
// idempotent manual messaging, safe private media storage, and unread/receipt tracking.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { AsyncLocalStorage } from 'async_hooks'
import { db } from './db.js'
import { eventBus } from '../events/bus.js'
import { unwrapMessage } from '../utils/message.js'
import { logger } from '../utils/logger.js'
import { redactSensitive } from '../server/security/redaction.js'
import { recordAudit } from '../server/security/controlAuth.js'
import { isRuntimeLeaseHealthy } from './runtimeSingleton.js'

export const INBOX_MAX_TEXT_LENGTH = 4096
export const INBOX_MAX_MEDIA_BYTES = 10 * 1024 * 1024 // 10 MB conservative upload cap

const STATUS_RANK = Object.freeze({
    UNKNOWN: 0,
    QUEUED: 1,
    SENDING: 2,
    SENT: 3,
    DELIVERED: 4,
    READ: 5,
    FAILED: 9,
    REVOKED: 10
})

const SUPPORTED_PN_REGEX = /^\d{6,20}@s\.whatsapp\.net$/
const SUPPORTED_LID_REGEX = /^\d{6,25}@lid$/
const SUPPORTED_GROUP_REGEX = /^\d{5,25}(?:-\d{1,15})?@g\.us$/

// Track message IDs originated from Control Center manual sends so Baileys hook/upsert preserves CONTROL_CENTER source
const controlOriginatedIds = new Set()
// Track per-send context async correlation for sock.sendMessage wrapper
const activeManualSendChats = new Map()
// Per-conversation serialization mutex (single-process Baileys runtime)
const conversationLocks = new Map()
const conversationLockMeta = new Map()
export const MAX_CONVERSATION_QUEUE_DEPTH = 32
// AsyncLocalStorage for propagating generation-start control version across async AI/command flows
const automationContextStorage = new AsyncLocalStorage()
// Overridable only in isolated tests (TAKEOVER-10 fail-closed verification)
let controlDbOverride = null

export const AUTOMATION_STATES = Object.freeze({
    BOT_ACTIVE: 'BOT_ACTIVE',
    HUMAN_TAKEOVER: 'HUMAN_TAKEOVER'
})

export const SUPPRESSION_OUTCOMES = Object.freeze({
    ALLOWED: 'ALLOWED',
    SUPPRESSED_TAKEOVER: 'SUPPRESSED_TAKEOVER',
    SUPPRESSED_STALE_VERSION: 'SUPPRESSED_STALE_VERSION',
    SUPPRESSED_CONTROL_UNAVAILABLE: 'SUPPRESSED_CONTROL_UNAVAILABLE',
    SUPPRESSED_CONTEXT_MISMATCH: 'SUPPRESSED_CONTEXT_MISMATCH'
})

// ─────────────────────────────────────────────
// ADDITIVE SQLITE SCHEMA INITIALIZATION
// ─────────────────────────────────────────────

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS inbox_conversations (
            chat_jid TEXT PRIMARY KEY,
            chat_type TEXT NOT NULL CHECK(chat_type IN ('dm', 'lid', 'group')),
            display_name TEXT,
            last_message_id TEXT,
            last_message_preview TEXT,
            last_message_source TEXT,
            last_message_direction TEXT,
            last_message_at INTEGER,
            first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
            history_available_from INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_conv_last_msg ON inbox_conversations(last_message_at DESC);

        CREATE TABLE IF NOT EXISTS inbox_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_jid TEXT NOT NULL,
            message_id TEXT NOT NULL,
            sender_jid TEXT,
            sender_name TEXT,
            direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
            source TEXT NOT NULL CHECK(source IN ('CONTACT', 'BOT', 'CONTROL_CENTER', 'SYSTEM')),
            message_type TEXT NOT NULL,
            body_text TEXT,
            media_id TEXT,
            media_mime TEXT,
            media_filename TEXT,
            quoted_message_id TEXT,
            delivery_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(delivery_status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REVOKED', 'UNKNOWN')),
            control_user_id TEXT,
            wa_timestamp INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(chat_jid, message_id),
            FOREIGN KEY(chat_jid) REFERENCES inbox_conversations(chat_jid) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_msg_timeline ON inbox_messages(chat_jid, wa_timestamp DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_inbox_msg_id ON inbox_messages(message_id);

        CREATE TABLE IF NOT EXISTS inbox_read_state (
            control_user_id TEXT NOT NULL,
            chat_jid TEXT NOT NULL,
            last_read_msg_row_id INTEGER NOT NULL DEFAULT 0,
            last_read_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY(control_user_id, chat_jid),
            FOREIGN KEY(chat_jid) REFERENCES inbox_conversations(chat_jid) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS inbox_idempotency (
            idempotency_key TEXT NOT NULL,
            control_user_id TEXT NOT NULL,
            chat_jid TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
            message_id TEXT,
            response_json TEXT,
            error_message TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY(control_user_id, idempotency_key)
        );

        CREATE TABLE IF NOT EXISTS inbox_media (
            media_id TEXT PRIMARY KEY,
            chat_jid TEXT NOT NULL,
            message_id TEXT,
            storage_filename TEXT NOT NULL UNIQUE,
            original_name TEXT,
            mime_type TEXT NOT NULL,
            media_kind TEXT NOT NULL CHECK(media_kind IN ('image', 'video', 'audio', 'document')),
            size_bytes INTEGER NOT NULL,
            uploaded_by TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS inbox_takeovers (
            chat_jid TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'BOT_ACTIVE' CHECK(state IN ('BOT_ACTIVE', 'HUMAN_TAKEOVER')),
            owner_user_id TEXT,
            owner_username TEXT,
            owner_role TEXT,
            reason TEXT,
            suppressed_count INTEGER NOT NULL DEFAULT 0,
            expires_at INTEGER,
            activated_at INTEGER,
            released_at INTEGER,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY(chat_jid) REFERENCES inbox_conversations(chat_jid) ON DELETE CASCADE
        );
    `)

    const takeoverCols = db.prepare('PRAGMA table_info(inbox_takeovers)').all()
    if (!takeoverCols.some((col) => col.name === 'version')) {
        db.exec('ALTER TABLE inbox_takeovers ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
    }
} catch (err) {
    logger.error('[Inbox/DB] Failed to initialize inbox tables:', err.message)
}

// ─────────────────────────────────────────────
// IDENTITY, SANITIZATION & MEDIA HELPERS
// ─────────────────────────────────────────────

export function normalizeChatJid(rawJid = '') {
    if (typeof rawJid !== 'string') return ''
    const trimmed = rawJid.trim()
    if (!trimmed) return ''
    const [localPart, domain] = trimmed.split('@')
    if (!localPart || !domain) return ''
    const cleanLocal = domain === 'g.us' ? localPart : localPart.split(':')[0]
    return `${cleanLocal}@${domain}`
}

export function isSupportedInboxJid(rawJid = '') {
    const jid = normalizeChatJid(rawJid)
    if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) {
        return false
    }
    return SUPPORTED_PN_REGEX.test(jid) || SUPPORTED_LID_REGEX.test(jid) || SUPPORTED_GROUP_REGEX.test(jid)
}

export function getChatType(chatJid) {
    if (chatJid.endsWith('@g.us')) return 'group'
    if (chatJid.endsWith('@lid')) return 'lid'
    return 'dm'
}

export function maskJidLabel(jid = '') {
    const clean = normalizeChatJid(jid)
    if (!clean) return 'Unknown'
    const [local, domain] = clean.split('@')
    if (domain === 'g.us') return clean
    if (local.length <= 4) return `****@${domain}`
    return `${local.slice(0, 4)}****${local.slice(-4)}@${domain}`
}

function sanitizePreview(text = '', messageType = 'text') {
    const clean = redactSensitive(String(text || '')).replace(/\s+/g, ' ').trim()
    if (clean) return clean.slice(0, 140)
    return `[${messageType}]`
}

function getMediaStorageDir() {
    const dir = path.resolve(process.env.INBOX_MEDIA_DIR || './storage/media/inbox')
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    return dir
}

export function resolveSafeMediaPath(storageFilename) {
    if (!storageFilename || typeof storageFilename !== 'string') return null
    if (!/^[a-f0-9-]{8,80}\.[a-z0-9]{2,5}$/i.test(storageFilename)) return null
    const baseDir = getMediaStorageDir()
    const resolved = path.resolve(baseDir, storageFilename)
    const relative = path.relative(baseDir, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return resolved
}

export function detectMagicMediaType(buffer, originalName = '', declaredMime = '') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null

    const ext = path.extname(originalName).toLowerCase()
    const lowerMime = String(declaredMime || '').toLowerCase()

    // Block unsafe active/script/markup formats unconditionally
    if (ext === '.svg' || ext === '.html' || ext === '.htm' || ext === '.js' || lowerMime.includes('svg') || lowerMime.includes('html')) {
        return null
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        if (ext && ext !== '.png') return null
        return { kind: 'image', mime: 'image/png', ext: '.png' }
    }

    // JPEG: FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        if (ext && ext !== '.jpg' && ext !== '.jpeg') return null
        return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' }
    }

    // WEBP: RIFF....WEBP
    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        if (ext && ext !== '.webp') return null
        return { kind: 'image', mime: 'image/webp', ext: '.webp' }
    }

    // PDF: %PDF-
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        if (ext && ext !== '.pdf') return null
        return { kind: 'document', mime: 'application/pdf', ext: '.pdf' }
    }

    // MP4: ....ftyp
    if (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        if (ext && ext !== '.mp4') return null
        return { kind: 'video', mime: 'video/mp4', ext: '.mp4' }
    }

    // OGG: OggS
    if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
        if (ext && ext !== '.ogg') return null
        return { kind: 'audio', mime: 'audio/ogg; codecs=opus', ext: '.ogg' }
    }

    // MP3: ID3 or MPEG sync frame
    if (
        (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
        if (ext && ext !== '.mp3') return null
        return { kind: 'audio', mime: 'audio/mpeg', ext: '.mp3' }
    }

    return null
}

// ─────────────────────────────────────────────
// PHASE 1C — DURABLE HUMAN TAKEOVER & SUPPRESSION
// ─────────────────────────────────────────────

// Safe default: takeover remains active until an authorized user explicitly resumes automation
export const DEFAULT_TAKEOVER_TTL_MINUTES = null
export const MIN_TAKEOVER_TTL_MINUTES = 5
export const MAX_TAKEOVER_TTL_MINUTES = 1440

function getControlDb() {
    return controlDbOverride || db
}

export function setControlDbForTest(mockDb = null) {
    controlDbOverride = mockDb
}

export function isConversationLocked(rawChatJid) {
    const key = normalizeChatJid(rawChatJid) || String(rawChatJid || '').trim()
    return Boolean(key && conversationLocks.has(key))
}

export function getConversationLockState(rawChatJid) {
    const key = normalizeChatJid(rawChatJid) || String(rawChatJid || '').trim()
    if (!key) return { locked: false, operation: null, startedAt: null, waitingCount: 0 }
    const meta = conversationLockMeta.get(key)
    return {
        locked: conversationLocks.has(key),
        operation: meta?.activeOperation || null,
        startedAt: meta?.activeStartedAt || null,
        waitingCount: meta?.waitingCount || 0
    }
}

export function withConversationLock(
    rawChatJid,
    fn,
    { operation = 'conversation_op', maxQueueDepth = MAX_CONVERSATION_QUEUE_DEPTH } = {}
) {
    const key = normalizeChatJid(rawChatJid) || String(rawChatJid || '').trim()
    if (!key) return Promise.resolve().then(() => fn())

    let meta = conversationLockMeta.get(key)
    if (!meta) {
        meta = { activeOperation: null, activeStartedAt: null, waitingCount: 0 }
        conversationLockMeta.set(key, meta)
    }

    if (meta.waitingCount >= maxQueueDepth) {
        const queueErr = new Error(`Conversation lock queue exceeded (${maxQueueDepth}) for ${maskJidLabel(key)}.`)
        queueErr.code = 'CONVERSATION_QUEUE_FULL'
        return Promise.reject(queueErr)
    }

    const prev = conversationLocks.get(key) || Promise.resolve()
    meta.waitingCount += 1

    let releaseCurrent
    const currentDone = new Promise((resolve) => {
        releaseCurrent = resolve
    })
    const chained = prev.then(() => currentDone, () => currentDone)
    conversationLocks.set(key, chained)

    return prev
        .catch(() => {})
        .then(() => {
            meta.waitingCount = Math.max(0, meta.waitingCount - 1)
            meta.activeOperation = operation
            meta.activeStartedAt = Date.now()
            return fn()
        })
        .finally(() => {
            meta.activeOperation = null
            meta.activeStartedAt = null
            releaseCurrent()
            if (conversationLocks.get(key) === chained) {
                conversationLocks.delete(key)
                conversationLockMeta.delete(key)
            }
        })
}

export function runWithAutomationContext({ chatJid, capturedVersion }, fn) {
    const normalized = normalizeChatJid(chatJid)
    const parsedVersion = Number.isFinite(Number(capturedVersion)) ? Number(capturedVersion) : null
    return automationContextStorage.run({ chatJid: normalized, capturedVersion: parsedVersion }, fn)
}

export function getAutomationContext() {
    return automationContextStorage.getStore() || null
}

function formatTakeoverRow(chatJid, row, nowSec = Math.floor(Date.now() / 1000)) {
    const version = Number(row?.version || 1)
    if (!row || row.state !== AUTOMATION_STATES.HUMAN_TAKEOVER) {
        return {
            chatId: chatJid,
            state: AUTOMATION_STATES.BOT_ACTIVE,
            active: false,
            ownerUserId: null,
            ownerUsername: null,
            ownerRole: null,
            reason: null,
            suppressedCount: Number(row?.suppressed_count || 0),
            expiresAt: null,
            activatedAt: row?.activated_at || null,
            releasedAt: row?.released_at || null,
            remainingSeconds: 0,
            version
        }
    }

    const expiresAt = row.expires_at ? Number(row.expires_at) : null
    const remainingSeconds = expiresAt ? Math.max(0, expiresAt - nowSec) : null

    return {
        chatId: chatJid,
        state: AUTOMATION_STATES.HUMAN_TAKEOVER,
        active: true,
        ownerUserId: row.owner_user_id || null,
        ownerUsername: row.owner_username || null,
        ownerRole: row.owner_role || null,
        reason: row.reason || null,
        suppressedCount: Number(row?.suppressed_count || 0),
        expiresAt,
        activatedAt: row.activated_at || null,
        releasedAt: row.released_at || null,
        remainingSeconds,
        version
    }
}

function commitExpiredTakeoverLocked(chatJid) {
    const controlDb = getControlDb()
    const nowSec = Math.floor(Date.now() / 1000)
    const row = controlDb.prepare('SELECT * FROM inbox_takeovers WHERE chat_jid = ?').get(chatJid)
    if (!row || row.state !== AUTOMATION_STATES.HUMAN_TAKEOVER || !row.expires_at || nowSec < Number(row.expires_at)) {
        return null
    }

    const res = controlDb.prepare(`
        UPDATE inbox_takeovers
        SET state = 'BOT_ACTIVE', released_at = ?, expires_at = NULL, version = version + 1, updated_at = unixepoch()
        WHERE chat_jid = ? AND state = 'HUMAN_TAKEOVER' AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(nowSec, chatJid, nowSec)

    if (res.changes === 0) return null

    const expiredState = formatTakeoverRow(
        chatJid,
        controlDb.prepare('SELECT * FROM inbox_takeovers WHERE chat_jid = ?').get(chatJid),
        nowSec
    )

    try {
        recordAudit({
            actorId: 'system:takeover-ttl',
            actorRole: 'system',
            action: 'control:whatsapp:takeover:expired',
            target: chatJid,
            result: 'allowed',
            metadata: {
                previousState: AUTOMATION_STATES.HUMAN_TAKEOVER,
                newState: AUTOMATION_STATES.BOT_ACTIVE,
                previousOwnerUserId: row.owner_user_id || null,
                previousOwnerUsername: row.owner_username || null,
                expiredAt: Number(row.expires_at),
                version: expiredState.version
            }
        })
    } catch (_) { }

    eventBus.emitEvent('inbox:takeover:update', {
        chatId: chatJid,
        takeover: expiredState,
        reason: 'expired',
        timestamp: Date.now()
    })
    return expiredState
}

export async function reconcileTakeoverExpiry(rawChatJid) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) return null
    return withConversationLock(chatJid, async () => {
        const expired = commitExpiredTakeoverLocked(chatJid)
        return expired || getTakeoverState(chatJid, { skipExpiryMutation: true })
    }, { operation: 'takeover:expiry' })
}

export function getTakeoverState(rawChatJid, { skipExpiryMutation = false } = {}) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) return null

    const controlDb = getControlDb()
    const nowSec = Math.floor(Date.now() / 1000)
    const row = controlDb.prepare('SELECT * FROM inbox_takeovers WHERE chat_jid = ?').get(chatJid)
    if (!row) {
        return formatTakeoverRow(chatJid, null, nowSec)
    }

    if (row.state === AUTOMATION_STATES.HUMAN_TAKEOVER && row.expires_at && nowSec >= Number(row.expires_at)) {
        if (!skipExpiryMutation && !isConversationLocked(chatJid)) {
            const expiredState = commitExpiredTakeoverLocked(chatJid)
            if (expiredState) return expiredState
        }
    }

    return formatTakeoverRow(chatJid, row, nowSec)
}

export function evaluateAutomatedSendGate(rawChatJid, expectedVersion = null) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) {
        return { allowed: true, outcome: SUPPRESSION_OUTCOMES.ALLOWED, state: null }
    }

    if (!isRuntimeLeaseHealthy()) {
        return {
            allowed: false,
            outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_CONTROL_UNAVAILABLE,
            state: null,
            error: 'RUNTIME_LEASE_LOST'
        }
    }

    const ctx = getAutomationContext()
    if (ctx && ctx.chatJid && ctx.chatJid !== chatJid) {
        return {
            allowed: false,
            outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_CONTEXT_MISMATCH,
            state: null,
            contextChatJid: ctx.chatJid,
            targetChatJid: chatJid
        }
    }

    if (expectedVersion !== null && expectedVersion !== undefined) {
        const parsedExpected = Number(expectedVersion)
        if (!Number.isInteger(parsedExpected) || parsedExpected < 1) {
            return {
                allowed: false,
                outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_STALE_VERSION,
                state: null,
                expectedVersion
            }
        }
    }

    let state
    try {
        state = getTakeoverState(chatJid, { skipExpiryMutation: isConversationLocked(chatJid) })
    } catch (err) {
        logger.error(`[Inbox/Takeover] Control state read failed for ${maskJidLabel(chatJid)}; failing closed:`, err.message)
        return {
            allowed: false,
            outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_CONTROL_UNAVAILABLE,
            state: null,
            error: err.message
        }
    }

    if (!state || state.active || state.state === AUTOMATION_STATES.HUMAN_TAKEOVER) {
        return {
            allowed: false,
            outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_TAKEOVER,
            state
        }
    }

    const effectiveExpectedVersion = expectedVersion !== null && expectedVersion !== undefined
        ? Number(expectedVersion)
        : (ctx && ctx.chatJid === chatJid && ctx.capturedVersion !== null ? Number(ctx.capturedVersion) : null)

    if (effectiveExpectedVersion !== null && Number.isFinite(effectiveExpectedVersion)) {
        const currentVersion = Number(state.version || 1)
        if (currentVersion !== effectiveExpectedVersion) {
            return {
                allowed: false,
                outcome: SUPPRESSION_OUTCOMES.SUPPRESSED_STALE_VERSION,
                state,
                expectedVersion: effectiveExpectedVersion,
                actualVersion: currentVersion
            }
        }
    }

    return {
        allowed: true,
        outcome: SUPPRESSION_OUTCOMES.ALLOWED,
        state
    }
}

export function shouldSuppressAutomatedSend(rawChatJid, expectedVersion = null) {
    return !evaluateAutomatedSendGate(rawChatJid, expectedVersion).allowed
}

export function recordSuppressedAutomatedSend(rawChatJid, meta = {}) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) return null

    const outcome = meta.outcome || SUPPRESSION_OUTCOMES.SUPPRESSED_TAKEOVER
    try {
        recordAudit({
            actorId: 'system:automation',
            actorRole: 'system',
            action: 'automation:reply:suppressed',
            target: chatJid,
            result: 'denied',
            metadata: {
                outcome,
                expectedVersion: meta.expectedVersion ?? null,
                actualVersion: meta.actualVersion ?? null
            }
        })
    } catch (_) { }

    try {
        const controlDb = getControlDb()
        controlDb.prepare(`
            UPDATE inbox_takeovers
            SET suppressed_count = suppressed_count + 1, updated_at = unixepoch()
            WHERE chat_jid = ? AND state = 'HUMAN_TAKEOVER'
        `).run(chatJid)
        const updated = getTakeoverState(chatJid, { skipExpiryMutation: isConversationLocked(chatJid) })
        if (
            updated &&
            (updated.active ||
                outcome === SUPPRESSION_OUTCOMES.SUPPRESSED_STALE_VERSION ||
                outcome === SUPPRESSION_OUTCOMES.SUPPRESSED_CONTEXT_MISMATCH)
        ) {
            eventBus.emitEvent('inbox:takeover:suppressed', {
                chatId: chatJid,
                takeover: updated,
                outcome,
                timestamp: Date.now()
            })
        }
        return updated
    } catch (err) {
        logger.warn(`[Inbox/Takeover] Failed to persist suppression telemetry for ${maskJidLabel(chatJid)}:`, err.message)
        return null
    }
}

export async function activateTakeover({ chatJid: rawChatJid, actor, ttlMinutes = DEFAULT_TAKEOVER_TTL_MINUTES, reason = '', force = false }) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) {
        return { errorStatus: 400, code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
    }

    const hasExplicitTtl = ttlMinutes !== null && ttlMinutes !== undefined && ttlMinutes !== ''
    let parsedTtl = null
    if (hasExplicitTtl) {
        parsedTtl = Number(ttlMinutes)
        if (!Number.isFinite(parsedTtl) || parsedTtl < MIN_TAKEOVER_TTL_MINUTES || parsedTtl > MAX_TAKEOVER_TTL_MINUTES) {
            return {
                errorStatus: 400,
                code: 'INVALID_TTL',
                message: `ttlMinutes must be between ${MIN_TAKEOVER_TTL_MINUTES} and ${MAX_TAKEOVER_TTL_MINUTES}, or omitted for indefinite takeover.`
            }
        }
    }

    return withConversationLock(chatJid, async () => {
        const controlDb = getControlDb()
        commitExpiredTakeoverLocked(chatJid)

        const current = getTakeoverState(chatJid, { skipExpiryMutation: true })
        const previousState = current?.state || AUTOMATION_STATES.BOT_ACTIVE
        const previousOwnerUserId = current?.ownerUserId || null
        const previousOwnerUsername = current?.ownerUsername || null

        const isPrivilegedOverride = actor?.role === 'owner' || actor?.role === 'admin'
        if (current?.active && current.ownerUserId && current.ownerUserId !== actor?.id) {
            if (!(force && isPrivilegedOverride)) {
                return {
                    errorStatus: 409,
                    code: 'TAKEOVER_LOCKED',
                    message: `Conversation is currently in Human Takeover by ${current.ownerUsername || 'another operator'}.`,
                    previousState,
                    previousOwnerUserId,
                    previousOwnerUsername
                }
            }
        }

        const nowSec = Math.floor(Date.now() / 1000)
        const expiresAt = parsedTtl !== null ? nowSec + Math.round(parsedTtl * 60) : null
        const cleanReason = redactSensitive(String(reason || '')).trim().slice(0, 200) || null

        controlDb.prepare(`
            INSERT OR IGNORE INTO inbox_conversations (chat_jid, chat_type, display_name)
            VALUES (?, ?, ?)
        `).run(chatJid, getChatType(chatJid), maskJidLabel(chatJid))

        controlDb.prepare(`
            INSERT INTO inbox_takeovers (
                chat_jid, state, owner_user_id, owner_username, owner_role, reason,
                suppressed_count, expires_at, activated_at, released_at, version, updated_at
            )
            VALUES (?, 'HUMAN_TAKEOVER', ?, ?, ?, ?, 0, ?, ?, NULL, 2, unixepoch())
            ON CONFLICT(chat_jid) DO UPDATE SET
                state = 'HUMAN_TAKEOVER',
                owner_user_id = excluded.owner_user_id,
                owner_username = excluded.owner_username,
                owner_role = excluded.owner_role,
                reason = excluded.reason,
                suppressed_count = CASE
                    WHEN inbox_takeovers.state = 'HUMAN_TAKEOVER' AND inbox_takeovers.owner_user_id = excluded.owner_user_id
                    THEN inbox_takeovers.suppressed_count
                    ELSE 0
                END,
                expires_at = excluded.expires_at,
                activated_at = CASE
                    WHEN inbox_takeovers.state = 'HUMAN_TAKEOVER' THEN COALESCE(inbox_takeovers.activated_at, excluded.activated_at)
                    ELSE excluded.activated_at
                END,
                released_at = NULL,
                version = inbox_takeovers.version + 1,
                updated_at = unixepoch()
        `).run(chatJid, actor?.id || null, actor?.username || null, actor?.role || null, cleanReason, expiresAt, nowSec)

        const nextState = getTakeoverState(chatJid, { skipExpiryMutation: true })
        eventBus.emitEvent('inbox:takeover:update', {
            chatId: chatJid,
            takeover: nextState,
            timestamp: Date.now()
        })
        return {
            takeover: nextState,
            previousState,
            previousOwnerUserId,
            previousOwnerUsername,
            reason: cleanReason
        }
    }, { operation: 'takeover:activate' })
}

export async function releaseTakeover({ chatJid: rawChatJid, actor, force = false, reason = '' }) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) {
        return { errorStatus: 400, code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
    }

    return withConversationLock(chatJid, async () => {
        const controlDb = getControlDb()
        commitExpiredTakeoverLocked(chatJid)

        const current = getTakeoverState(chatJid, { skipExpiryMutation: true })
        const previousState = current?.state || AUTOMATION_STATES.BOT_ACTIVE
        const previousOwnerUserId = current?.ownerUserId || null
        const previousOwnerUsername = current?.ownerUsername || null
        const cleanReason = redactSensitive(String(reason || '')).trim().slice(0, 200) || null

        const isPrivilegedOverride = actor?.role === 'owner' || actor?.role === 'admin'
        if (current?.active && current.ownerUserId && current.ownerUserId !== actor?.id) {
            if (!(force && isPrivilegedOverride)) {
                return {
                    errorStatus: 409,
                    code: 'TAKEOVER_LOCKED',
                    message: `Only ${current.ownerUsername || 'the active holder'} or an Admin/Owner override can release this takeover.`,
                    previousState,
                    previousOwnerUserId,
                    previousOwnerUsername
                }
            }
        }

        const nowSec = Math.floor(Date.now() / 1000)
        controlDb.prepare(`
            UPDATE inbox_takeovers
            SET state = 'BOT_ACTIVE', released_at = ?, expires_at = NULL, version = version + 1, updated_at = unixepoch()
            WHERE chat_jid = ?
        `).run(nowSec, chatJid)

        const nextState = getTakeoverState(chatJid, { skipExpiryMutation: true })
        eventBus.emitEvent('inbox:takeover:update', {
            chatId: chatJid,
            takeover: nextState,
            timestamp: Date.now()
        })
        return {
            takeover: nextState,
            previousState,
            previousOwnerUserId,
            previousOwnerUsername,
            reason: cleanReason
        }
    }, { operation: 'takeover:release' })
}

// ─────────────────────────────────────────────
// MESSAGE SERIALIZATION & PERSISTENCE
// ─────────────────────────────────────────────

function formatMessageRow(row) {
    if (!row) return null
    return {
        id: row.id,
        chatId: row.chat_jid,
        messageId: row.message_id,
        senderJid: row.sender_jid ? maskJidLabel(row.sender_jid) : null,
        senderName: row.sender_name || null,
        direction: row.direction,
        source: row.source,
        messageType: row.message_type,
        bodyText: row.body_text || '',
        media: row.media_id
            ? {
                mediaId: row.media_id,
                mimeType: row.media_mime || null,
                filename: row.media_filename || null
            }
            : null,
        quotedMessageId: row.quoted_message_id || null,
        deliveryStatus: row.delivery_status,
        controlUserId: row.control_user_id || null,
        waTimestamp: row.wa_timestamp,
        createdAt: row.created_at
    }
}

const ingestTransaction = db.transaction((entry) => {
    const existing = db
        .prepare('SELECT id, source, delivery_status, control_user_id FROM inbox_messages WHERE chat_jid = ? AND message_id = ?')
        .get(entry.chatJid, entry.messageId)

    db.prepare(`
        INSERT INTO inbox_conversations (
            chat_jid, chat_type, display_name, last_message_id, last_message_preview,
            last_message_source, last_message_direction, last_message_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_jid) DO UPDATE SET
            display_name = COALESCE(NULLIF(excluded.display_name, ''), inbox_conversations.display_name),
            last_message_id = CASE
                WHEN inbox_conversations.last_message_at IS NULL OR excluded.last_message_at >= inbox_conversations.last_message_at
                THEN excluded.last_message_id
                ELSE inbox_conversations.last_message_id
            END,
            last_message_preview = CASE
                WHEN inbox_conversations.last_message_at IS NULL OR excluded.last_message_at >= inbox_conversations.last_message_at
                THEN excluded.last_message_preview
                ELSE inbox_conversations.last_message_preview
            END,
            last_message_source = CASE
                WHEN inbox_conversations.last_message_at IS NULL OR excluded.last_message_at >= inbox_conversations.last_message_at
                THEN excluded.last_message_source
                ELSE inbox_conversations.last_message_source
            END,
            last_message_direction = CASE
                WHEN inbox_conversations.last_message_at IS NULL OR excluded.last_message_at >= inbox_conversations.last_message_at
                THEN excluded.last_message_direction
                ELSE inbox_conversations.last_message_direction
            END,
            last_message_at = CASE
                WHEN inbox_conversations.last_message_at IS NULL OR excluded.last_message_at >= inbox_conversations.last_message_at
                THEN excluded.last_message_at
                ELSE inbox_conversations.last_message_at
            END,
            updated_at = unixepoch()
    `).run(
        entry.chatJid,
        getChatType(entry.chatJid),
        entry.displayName || null,
        entry.messageId,
        entry.preview,
        entry.source,
        entry.direction,
        entry.waTimestamp
    )

    if (existing) {
        // Preserve authoritative source when Baileys echoes an already-persisted CONTROL_CENTER/BOT send
        const mergedSource =
            existing.source === 'CONTROL_CENTER' || entry.source !== 'CONTROL_CENTER'
                ? (existing.source === 'CONTROL_CENTER' ? 'CONTROL_CENTER' : entry.source === 'BOT' ? 'BOT' : existing.source)
                : 'CONTROL_CENTER'
        const currentRank = STATUS_RANK[existing.delivery_status] ?? 0
        const nextRank = STATUS_RANK[entry.deliveryStatus] ?? 0
        const mergedStatus = nextRank > currentRank ? entry.deliveryStatus : existing.delivery_status

        db.prepare(`
            UPDATE inbox_messages
            SET source = ?, delivery_status = ?, control_user_id = COALESCE(control_user_id, ?)
            WHERE id = ?
        `).run(mergedSource, mergedStatus, entry.controlUserId || null, existing.id)

        const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(existing.id)
        return { inserted: false, message: formatMessageRow(row) }
    }

    const res = db.prepare(`
        INSERT INTO inbox_messages (
            chat_jid, message_id, sender_jid, sender_name, direction, source,
            message_type, body_text, media_id, media_mime, media_filename,
            quoted_message_id, delivery_status, control_user_id, wa_timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        entry.chatJid,
        entry.messageId,
        entry.senderJid || null,
        entry.senderName || null,
        entry.direction,
        entry.source,
        entry.messageType,
        entry.bodyText || '',
        entry.mediaId || null,
        entry.mediaMime || null,
        entry.mediaFilename || null,
        entry.quotedMessageId || null,
        entry.deliveryStatus,
        entry.controlUserId || null,
        entry.waTimestamp
    )

    const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(res.lastInsertRowid)
    return { inserted: true, message: formatMessageRow(row) }
})

export function ingestMessage(record) {
    const chatJid = normalizeChatJid(record.chatJid)
    if (!isSupportedInboxJid(chatJid) || !record.messageId) return null

    const waTimestamp = Number(record.waTimestamp) || Math.floor(Date.now() / 1000)
    const messageType = String(record.messageType || 'text')
    const preview = sanitizePreview(record.bodyText, messageType)

    const outcome = ingestTransaction({
        ...record,
        chatJid,
        messageType,
        preview,
        waTimestamp,
        deliveryStatus: record.deliveryStatus || (record.direction === 'incoming' ? 'DELIVERED' : 'SENT')
    })

    if (outcome?.message) {
        eventBus.emitEvent('inbox:message:new', {
            inserted: outcome.inserted,
            chatId: chatJid,
            message: outcome.message,
            timestamp: Date.now()
        })
    }
    return outcome
}

export function updateMessageStatus(rawChatJid, messageId, nextStatus) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!chatJid || !messageId || !(nextStatus in STATUS_RANK)) return null

    const existing = db
        .prepare('SELECT * FROM inbox_messages WHERE chat_jid = ? AND message_id = ?')
        .get(chatJid, messageId)
    if (!existing) return null

    const curRank = STATUS_RANK[existing.delivery_status] ?? 0
    const nextRank = STATUS_RANK[nextStatus] ?? 0
    if (nextRank <= curRank && nextStatus !== existing.delivery_status) {
        return formatMessageRow(existing)
    }

    db.prepare('UPDATE inbox_messages SET delivery_status = ? WHERE id = ?').run(nextStatus, existing.id)
    const updated = formatMessageRow(db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(existing.id))
    eventBus.emitEvent('inbox:message:update', {
        chatId: chatJid,
        message: updated,
        timestamp: Date.now()
    })
    return updated
}

// ─────────────────────────────────────────────
// BAILEYS EVENT EXTRACTION & SOCKET WRAPPING
// ─────────────────────────────────────────────

function extractUnixSeconds(rawTs) {
    if (!rawTs) return Math.floor(Date.now() / 1000)
    if (typeof rawTs === 'object' && typeof rawTs.low === 'number') return rawTs.low
    const num = Number(rawTs)
    if (!Number.isFinite(num) || num <= 0) return Math.floor(Date.now() / 1000)
    return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num)
}

function extractTextFromContent(content) {
    return (
        content?.conversation ||
        content?.extendedTextMessage?.text ||
        content?.imageMessage?.caption ||
        content?.videoMessage?.caption ||
        content?.documentMessage?.caption ||
        ''
    )
}

function normalizeMessageType(rawType = '') {
    if (rawType === 'conversation' || rawType === 'extendedTextMessage') return 'text'
    if (rawType === 'imageMessage') return 'image'
    if (rawType === 'videoMessage' || rawType === 'ptvMessage') return 'video'
    if (rawType === 'audioMessage') return 'audio'
    if (rawType === 'documentMessage') return 'document'
    if (rawType === 'stickerMessage') return 'sticker'
    return rawType || 'unknown'
}

export function ingestBaileysUpsert(msg) {
    try {
        if (!msg?.key?.remoteJid || !msg?.key?.id || !msg?.message) return null
        const chatJid = normalizeChatJid(msg.key.remoteJid)
        if (!isSupportedInboxJid(chatJid)) return null

        const unwrapped = unwrapMessage(msg.message)
        if (!unwrapped) return null

        const rawType = Object.keys(unwrapped)[0]
        if (rawType === 'protocolMessage' || rawType === 'senderKeyDistributionMessage') return null

        const fromMe = Boolean(msg.key.fromMe)
        const senderJid = normalizeChatJid(msg.key.participant || msg.key.remoteJid)
        const isManualEcho = fromMe && controlOriginatedIds.has(msg.key.id)
        const direction = fromMe ? 'outgoing' : 'incoming'
        const source = fromMe ? (isManualEcho ? 'CONTROL_CENTER' : 'BOT') : 'CONTACT'

        const msgObj = unwrapped[rawType]
        const contextInfo = msgObj?.contextInfo || unwrapped?.extendedTextMessage?.contextInfo
        const quotedMessageId = contextInfo?.stanzaId || null
        const messageType = normalizeMessageType(rawType)
        const bodyText = extractTextFromContent(unwrapped)
        const displayName = !fromMe && getChatType(chatJid) !== 'group' && msg.pushName ? msg.pushName : null

        return ingestMessage({
            chatJid,
            messageId: msg.key.id,
            senderJid,
            senderName: msg.pushName || null,
            displayName,
            direction,
            source,
            messageType,
            bodyText,
            mediaFilename: unwrapped?.documentMessage?.fileName || null,
            mediaMime: msgObj?.mimetype || null,
            quotedMessageId,
            deliveryStatus: fromMe ? 'SENT' : 'DELIVERED',
            waTimestamp: extractUnixSeconds(msg.messageTimestamp)
        })
    } catch (err) {
        logger.warn('[Inbox/Ingest] Failed to persist Baileys upsert:', err.message)
        return null
    }
}

export function ingestBaileysStatusUpdate(updates) {
    if (!Array.isArray(updates)) return
    for (const item of updates) {
        try {
            const key = item?.key
            if (!key?.remoteJid || !key?.id) continue

            if (item?.update?.message?.protocolMessage?.type === 0 || item?.update?.message === null) {
                updateMessageStatus(key.remoteJid, key.id, 'REVOKED')
                continue
            }

            const statusNum = item?.update?.status ?? item?.status
            // Baileys WAMessageStatus mapping: 1=PENDING, 2=SERVER_ACK(SENT), 3=DELIVERY_ACK, 4=READ, 5=PLAYED
            let mapped = null
            if (statusNum === 0) mapped = 'FAILED'
            else if (statusNum === 1) mapped = 'QUEUED'
            else if (statusNum === 2) mapped = 'SENT'
            else if (statusNum === 3) mapped = 'DELIVERED'
            else if (statusNum === 4 || statusNum === 5) mapped = 'READ'

            if (mapped) {
                updateMessageStatus(key.remoteJid, key.id, mapped)
            }
        } catch (err) {
            logger.warn('[Inbox/StatusUpdate] Failed to update status:', err.message)
        }
    }
}

export function hookBaileysSocket(sock) {
    if (!sock || typeof sock.sendMessage !== 'function' || sock.__inboxHooked) return
    const originalSend = sock.sendMessage.bind(sock)
    sock.__inboxHooked = true

    const recordBotOutgoing = (chatJid, result, content) => {
        try {
            const messageId = result?.key?.id
            if (!isSupportedInboxJid(chatJid) || !messageId || controlOriginatedIds.has(messageId)) return
            const textBody =
                content?.text ||
                content?.caption ||
                (content?.react?.text ? `[Reaction ${content.react.text}]` : '')
            const messageType = content?.image
                ? 'image'
                : content?.video
                    ? 'video'
                    : content?.audio
                        ? 'audio'
                        : content?.document
                            ? 'document'
                            : content?.sticker
                                ? 'sticker'
                                : 'text'
            ingestMessage({
                chatJid,
                messageId,
                senderJid: sock?.user?.id || null,
                senderName: sock?.user?.name || 'RonnBot',
                direction: 'outgoing',
                source: 'BOT',
                messageType,
                bodyText: String(textBody || ''),
                mediaFilename: content?.fileName || null,
                mediaMime: content?.mimetype || null,
                deliveryStatus: 'SENT',
                waTimestamp: Math.floor(Date.now() / 1000)
            })
        } catch (err) {
            logger.warn('[Inbox/SendHook] Failed to record outgoing bot message:', err.message)
        }
    }

    sock.sendMessage = async (jid, content, options = {}) => {
        const chatJid = normalizeChatJid(jid)
        const isManualPre = (activeManualSendChats.get(chatJid) || 0) > 0

        // Manual Control Center sends already hold withConversationLock(chatJid); never re-enter lock here.
        if (isManualPre) {
            const result = await originalSend(jid, content, options)
            const messageId = result?.key?.id
            if (messageId) {
                controlOriginatedIds.add(messageId)
                setTimeout(() => controlOriginatedIds.delete(messageId), 60000).unref?.()
            }
            return result
        }

        if (!isSupportedInboxJid(chatJid)) {
            return originalSend(jid, content, options)
        }

        const expectedVersion = options?.takeoverExpectedVersion ?? null
        return withConversationLock(chatJid, async () => {
            try { commitExpiredTakeoverLocked(chatJid) } catch (_) {}
            const gate = evaluateAutomatedSendGate(chatJid, expectedVersion)
            if (!gate.allowed) {
                recordSuppressedAutomatedSend(chatJid, {
                    outcome: gate.outcome,
                    expectedVersion: gate.expectedVersion,
                    actualVersion: gate.actualVersion
                })
                logger.info(`[Inbox/Takeover] Suppressed automated reply (${gate.outcome}) to ${maskJidLabel(chatJid)}`)
                return {
                    key: { remoteJid: chatJid, id: null, fromMe: true },
                    suppressedByTakeover: true,
                    suppressionOutcome: gate.outcome
                }
            }

            const result = await originalSend(jid, content, options)
            recordBotOutgoing(chatJid, result, content)
            return result
        }, { operation: 'bot:send' })
    }
}

// ─────────────────────────────────────────────
// QUERIES (CONVERSATIONS, TIMELINE, INSPECTOR)
// ─────────────────────────────────────────────

export function listConversations({
    controlUserId,
    q = '',
    unreadOnly = false,
    chatType = 'all',
    before = null,
    limit = 30
}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
    const where = []
    const params = [controlUserId || '']

    if (chatType && chatType !== 'all' && ['dm', 'lid', 'group'].includes(chatType)) {
        where.push('c.chat_type = ?')
        params.push(chatType)
    }

    const cleanQ = String(q || '').trim()
    if (cleanQ) {
        where.push('(LOWER(COALESCE(c.display_name, \'\')) LIKE ? OR LOWER(c.chat_jid) LIKE ?)')
        const pattern = `%${cleanQ.toLowerCase()}%`
        params.push(pattern, pattern)
    }

    if (before && Number.isFinite(Number(before))) {
        where.push('(c.last_message_at IS NULL OR c.last_message_at < ?)')
        params.push(Number(before))
    }

    if (unreadOnly) {
        where.push(`(
            SELECT COUNT(*) FROM inbox_messages m
            WHERE m.chat_jid = c.chat_jid
              AND m.direction = 'incoming'
              AND m.id > COALESCE((SELECT r.last_read_msg_row_id FROM inbox_read_state r WHERE r.control_user_id = ? AND r.chat_jid = c.chat_jid), 0)
        ) > 0`)
        params.push(controlUserId || '')
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(safeLimit + 1)

    const rows = db.prepare(`
        SELECT
            c.*,
            (
                SELECT COUNT(*) FROM inbox_messages m
                WHERE m.chat_jid = c.chat_jid
                  AND m.direction = 'incoming'
                  AND m.id > COALESCE((SELECT r.last_read_msg_row_id FROM inbox_read_state r WHERE r.control_user_id = ? AND r.chat_jid = c.chat_jid), 0)
            ) AS unread_count
        FROM inbox_conversations c
        ${whereClause}
        ORDER BY COALESCE(c.last_message_at, 0) DESC, c.updated_at DESC
        LIMIT ?
    `).all(...params)

    const hasMore = rows.length > safeLimit
    const sliced = rows.slice(0, safeLimit)
    const lastRow = sliced[sliced.length - 1]

    return {
        conversations: sliced.map((r) => ({
            chatId: r.chat_jid,
            chatType: r.chat_type,
            displayName: r.display_name || maskJidLabel(r.chat_jid),
            maskedJid: maskJidLabel(r.chat_jid),
            lastMessageId: r.last_message_id || null,
            lastMessagePreview: r.last_message_preview || '',
            lastMessageSource: r.last_message_source || null,
            lastMessageDirection: r.last_message_direction || null,
            lastMessageAt: r.last_message_at || null,
            firstSeenAt: r.first_seen_at,
            historyAvailableFrom: r.history_available_from,
            unreadCount: Number(r.unread_count || 0),
            takeover: getTakeoverState(r.chat_jid),
            source: 'sqlite:inbox_conversations'
        })),
        nextCursor: hasMore && lastRow ? lastRow.last_message_at : null,
        hasMore
    }
}

export function getTimeline({ chatJid: rawChatJid, beforeId = null, limit = 50 }) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) return null

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
    const conv = db.prepare('SELECT * FROM inbox_conversations WHERE chat_jid = ?').get(chatJid)

    const rows = beforeId
        ? db.prepare(`
            SELECT * FROM inbox_messages
            WHERE chat_jid = ? AND id < ?
            ORDER BY id DESC
            LIMIT ?
        `).all(chatJid, Number(beforeId), safeLimit + 1)
        : db.prepare(`
            SELECT * FROM inbox_messages
            WHERE chat_jid = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(chatJid, safeLimit + 1)

    const hasMore = rows.length > safeLimit
    const pageRows = rows.slice(0, safeLimit).reverse()

    let aiEnabled = null
    let moderationEnabled = null
    try {
        const chatConf = db.prepare('SELECT ai_enabled FROM chat_config WHERE chat_id = ?').get(chatJid)
        if (chatConf !== undefined) aiEnabled = Boolean(chatConf.ai_enabled)
        const modConf = db.prepare('SELECT enabled FROM moderation_config WHERE chat_id = ?').get(chatJid)
        if (modConf !== undefined) moderationEnabled = Boolean(modConf.enabled)
    } catch {
        // ignore
    }

    const takeover = getTakeoverState(chatJid)
    const automationNote = takeover?.active
        ? `Human Takeover active (${takeover.ownerUsername || 'operator'}): automated bot replies are suppressed.`
        : 'Bot active: automated AI/command replies remain enabled.'

    return {
        conversation: conv
            ? {
                chatId: conv.chat_jid,
                chatType: conv.chat_type,
                displayName: conv.display_name || maskJidLabel(conv.chat_jid),
                maskedJid: maskJidLabel(conv.chat_jid),
                firstSeenAt: conv.first_seen_at,
                lastMessageAt: conv.last_message_at,
                historyAvailableFrom: conv.history_available_from,
                aiEnabled,
                moderationEnabled,
                takeover,
                automationNote
            }
            : {
                chatId: chatJid,
                chatType: getChatType(chatJid),
                displayName: maskJidLabel(chatJid),
                maskedJid: maskJidLabel(chatJid),
                firstSeenAt: null,
                lastMessageAt: null,
                historyAvailableFrom: null,
                aiEnabled,
                moderationEnabled,
                takeover,
                automationNote
            },
        messages: pageRows.map(formatMessageRow),
        nextCursor: hasMore && pageRows.length > 0 ? pageRows[0].id : null,
        hasMore
    }
}

export function markConversationRead(controlUserId, rawChatJid) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid) || !controlUserId) return null

    const latest = db.prepare('SELECT COALESCE(MAX(id), 0) as maxId FROM inbox_messages WHERE chat_jid = ?').get(chatJid)
    const maxId = Number(latest?.maxId || 0)

    const conv = db.prepare('SELECT chat_jid FROM inbox_conversations WHERE chat_jid = ?').get(chatJid)
    if (conv) {
        db.prepare(`
            INSERT INTO inbox_read_state (control_user_id, chat_jid, last_read_msg_row_id, last_read_at)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(control_user_id, chat_jid) DO UPDATE SET
                last_read_msg_row_id = MAX(inbox_read_state.last_read_msg_row_id, excluded.last_read_msg_row_id),
                last_read_at = unixepoch()
        `).run(controlUserId, chatJid, maxId)
    }

    const payload = {
        controlUserId,
        chatId: chatJid,
        lastReadMsgRowId: maxId,
        unreadCount: 0,
        timestamp: Date.now()
    }
    eventBus.emitEvent('inbox:conversation:read', payload)
    return payload
}

// ─────────────────────────────────────────────
// MANUAL MESSAGING & MEDIA (WITH IDEMPOTENCY)
// ─────────────────────────────────────────────

export async function sendManualText({ sock, controlUserId, chatJid: rawChatJid, text, idempotencyKey }) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) {
        return { errorStatus: 400, code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
    }
    const cleanText = typeof text === 'string' ? text.trim() : ''
    if (!cleanText || cleanText.length > INBOX_MAX_TEXT_LENGTH) {
        return { errorStatus: 400, code: 'INVALID_MESSAGE_TEXT', message: `Message text must be 1-${INBOX_MAX_TEXT_LENGTH} characters.` }
    }
    const cleanKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : ''
    if (!cleanKey || cleanKey.length > 100) {
        return { errorStatus: 400, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid idempotencyKey is required for manual sends.' }
    }

    const existingIdem = db
        .prepare('SELECT * FROM inbox_idempotency WHERE control_user_id = ? AND idempotency_key = ?')
        .get(controlUserId, cleanKey)

    if (existingIdem) {
        if (existingIdem.status === 'SUCCEEDED' && existingIdem.response_json) {
            return { deduplicated: true, data: JSON.parse(existingIdem.response_json) }
        }
        if (existingIdem.status === 'PENDING') {
            return { errorStatus: 409, code: 'SEND_IN_PROGRESS', message: 'A manual send with this idempotency key is already in progress.' }
        }
        return { errorStatus: 502, code: 'PRIOR_SEND_FAILED', message: existingIdem.error_message || 'Previous send with this key failed; use a new key to retry.' }
    }

    if (!sock || typeof sock.sendMessage !== 'function') {
        return { errorStatus: 503, code: 'WHATSAPP_OFFLINE', message: 'WhatsApp socket is not connected.' }
    }

    db.prepare(`
        INSERT INTO inbox_idempotency (idempotency_key, control_user_id, chat_jid, status)
        VALUES (?, ?, ?, 'PENDING')
    `).run(cleanKey, controlUserId, chatJid)

    return withConversationLock(chatJid, async () => {
        activeManualSendChats.set(chatJid, (activeManualSendChats.get(chatJid) || 0) + 1)
        try {
            const result = await sock.sendMessage(chatJid, { text: cleanText })
            const actualId = result?.key?.id || `ctrl_${crypto.randomUUID()}`
            controlOriginatedIds.add(actualId)
            setTimeout(() => controlOriginatedIds.delete(actualId), 60000).unref?.()

            const persisted = ingestMessage({
                chatJid,
                messageId: actualId,
                senderJid: sock?.user?.id || null,
                senderName: sock?.user?.name || 'Control Center',
                direction: 'outgoing',
                source: 'CONTROL_CENTER',
                messageType: 'text',
                bodyText: cleanText,
                deliveryStatus: result?.key?.id ? 'SENT' : 'UNKNOWN',
                controlUserId,
                waTimestamp: Math.floor(Date.now() / 1000)
            })

            let currentControl = null
            try { currentControl = getTakeoverState(chatJid, { skipExpiryMutation: true }) } catch {}

            const payload = {
                chatId: chatJid,
                messageId: actualId,
                message: persisted.message,
                automationState: currentControl?.state || null,
                automationActive: currentControl?.state !== AUTOMATION_STATES.HUMAN_TAKEOVER
            }
            db.prepare(`
                UPDATE inbox_idempotency
                SET status = 'SUCCEEDED', message_id = ?, response_json = ?, updated_at = unixepoch()
                WHERE control_user_id = ? AND idempotency_key = ?
            `).run(actualId, JSON.stringify(payload), controlUserId, cleanKey)

            return { deduplicated: false, data: payload }
        } catch (err) {
            const safeErr = redactSensitive(String(err?.message || 'WhatsApp send failed')).slice(0, 240)
            db.prepare(`
                UPDATE inbox_idempotency
                SET status = 'FAILED', error_message = ?, updated_at = unixepoch()
                WHERE control_user_id = ? AND idempotency_key = ?
            `).run(safeErr, controlUserId, cleanKey)
            return { errorStatus: 502, code: 'WHATSAPP_SEND_FAILED', message: safeErr }
        } finally {
            const remaining = (activeManualSendChats.get(chatJid) || 1) - 1
            if (remaining <= 0) activeManualSendChats.delete(chatJid)
            else activeManualSendChats.set(chatJid, remaining)
        }
    }, { operation: 'manual:send' })
}

export async function sendManualMedia({ sock, controlUserId, chatJid: rawChatJid, file, caption = '', idempotencyKey }) {
    const chatJid = normalizeChatJid(rawChatJid)
    if (!isSupportedInboxJid(chatJid)) {
        return { errorStatus: 400, code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
    }
    const cleanKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : ''
    if (!cleanKey || cleanKey.length > 100) {
        return { errorStatus: 400, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid idempotencyKey is required.' }
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        return { errorStatus: 400, code: 'MEDIA_REQUIRED', message: 'Media file is required.' }
    }
    if (file.buffer.length > INBOX_MAX_MEDIA_BYTES) {
        return { errorStatus: 413, code: 'MEDIA_TOO_LARGE', message: `Media exceeds max limit of ${Math.round(INBOX_MAX_MEDIA_BYTES / (1024 * 1024))}MB.` }
    }

    const detected = detectMagicMediaType(file.buffer, file.originalname || '', file.mimetype || '')
    if (!detected) {
        return { errorStatus: 400, code: 'UNSUPPORTED_MEDIA', message: 'Unsupported or mismatched media type. Allowed: PNG, JPEG, WEBP, PDF, MP4, OGG, MP3.' }
    }

    const existingIdem = db
        .prepare('SELECT * FROM inbox_idempotency WHERE control_user_id = ? AND idempotency_key = ?')
        .get(controlUserId, cleanKey)

    if (existingIdem) {
        if (existingIdem.status === 'SUCCEEDED' && existingIdem.response_json) {
            return { deduplicated: true, data: JSON.parse(existingIdem.response_json) }
        }
        if (existingIdem.status === 'PENDING') {
            return { errorStatus: 409, code: 'SEND_IN_PROGRESS', message: 'Upload send with this idempotency key is in progress.' }
        }
        return { errorStatus: 502, code: 'PRIOR_SEND_FAILED', message: existingIdem.error_message || 'Previous send failed.' }
    }

    if (!sock || typeof sock.sendMessage !== 'function') {
        return { errorStatus: 503, code: 'WHATSAPP_OFFLINE', message: 'WhatsApp socket is not connected.' }
    }

    const mediaId = crypto.randomUUID()
    const storageFilename = `${mediaId}${detected.ext}`
    const targetPath = resolveSafeMediaPath(storageFilename)
    if (!targetPath) {
        return { errorStatus: 400, code: 'INVALID_STORAGE_PATH', message: 'Invalid storage filename generated.' }
    }

    const cleanCaption = typeof caption === 'string' ? caption.trim().slice(0, 1024) : ''
    const cleanOrigName = path.basename(file.originalname || `upload${detected.ext}`).replace(/[^\w.\- ]+/g, '_')

    await fs.promises.writeFile(targetPath, file.buffer)

    db.prepare(`
        INSERT INTO inbox_idempotency (idempotency_key, control_user_id, chat_jid, status)
        VALUES (?, ?, ?, 'PENDING')
    `).run(cleanKey, controlUserId, chatJid)

    return withConversationLock(chatJid, async () => {
        activeManualSendChats.set(chatJid, (activeManualSendChats.get(chatJid) || 0) + 1)
        try {
            let baileysPayload
            if (detected.kind === 'image') {
                baileysPayload = { image: file.buffer, caption: cleanCaption || undefined, mimetype: detected.mime }
            } else if (detected.kind === 'video') {
                baileysPayload = { video: file.buffer, caption: cleanCaption || undefined, mimetype: detected.mime }
            } else if (detected.kind === 'audio') {
                baileysPayload = { audio: file.buffer, mimetype: detected.mime }
            } else {
                baileysPayload = { document: file.buffer, fileName: cleanOrigName, mimetype: detected.mime, caption: cleanCaption || undefined }
            }

            const result = await sock.sendMessage(chatJid, baileysPayload)
            const actualId = result?.key?.id || `ctrl_${crypto.randomUUID()}`
            controlOriginatedIds.add(actualId)
            setTimeout(() => controlOriginatedIds.delete(actualId), 60000).unref?.()

            db.prepare(`
                INSERT INTO inbox_media (media_id, chat_jid, message_id, storage_filename, original_name, mime_type, media_kind, size_bytes, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(mediaId, chatJid, actualId, storageFilename, cleanOrigName, detected.mime, detected.kind, file.buffer.length, controlUserId)

            const persisted = ingestMessage({
                chatJid,
                messageId: actualId,
                senderJid: sock?.user?.id || null,
                senderName: sock?.user?.name || 'Control Center',
                direction: 'outgoing',
                source: 'CONTROL_CENTER',
                messageType: detected.kind,
                bodyText: cleanCaption,
                mediaId,
                mediaMime: detected.mime,
                mediaFilename: cleanOrigName,
                deliveryStatus: result?.key?.id ? 'SENT' : 'UNKNOWN',
                controlUserId,
                waTimestamp: Math.floor(Date.now() / 1000)
            })

            let currentControl = null
            try { currentControl = getTakeoverState(chatJid, { skipExpiryMutation: true }) } catch {}

            const payload = {
                chatId: chatJid,
                messageId: actualId,
                mediaId,
                message: persisted.message,
                automationState: currentControl?.state || null,
                automationActive: currentControl?.state !== AUTOMATION_STATES.HUMAN_TAKEOVER
            }
            db.prepare(`
                UPDATE inbox_idempotency
                SET status = 'SUCCEEDED', message_id = ?, response_json = ?, updated_at = unixepoch()
                WHERE control_user_id = ? AND idempotency_key = ?
            `).run(actualId, JSON.stringify(payload), controlUserId, cleanKey)

            return { deduplicated: false, data: payload }
        } catch (err) {
            try { await fs.promises.unlink(targetPath) } catch (_) {}
            const safeErr = redactSensitive(String(err?.message || 'WhatsApp media send failed')).slice(0, 240)
            db.prepare(`
                UPDATE inbox_idempotency
                SET status = 'FAILED', error_message = ?, updated_at = unixepoch()
                WHERE control_user_id = ? AND idempotency_key = ?
            `).run(safeErr, controlUserId, cleanKey)
            return { errorStatus: 502, code: 'WHATSAPP_SEND_FAILED', message: safeErr }
        } finally {
            const remaining = (activeManualSendChats.get(chatJid) || 1) - 1
            if (remaining <= 0) activeManualSendChats.delete(chatJid)
            else activeManualSendChats.set(chatJid, remaining)
        }
    })
}

export function getMediaRecord(mediaId) {
    if (!mediaId || typeof mediaId !== 'string') return null
    const row = db.prepare('SELECT * FROM inbox_media WHERE media_id = ?').get(mediaId.trim())
    if (!row) return null
    const filePath = resolveSafeMediaPath(row.storage_filename)
    if (!filePath || !fs.existsSync(filePath)) return null
    return { ...row, filePath }
}

export const inboxService = {
    AUTOMATION_STATES,
    SUPPRESSION_OUTCOMES,
    normalizeChatJid,
    isSupportedInboxJid,
    getChatType,
    maskJidLabel,
    detectMagicMediaType,
    resolveSafeMediaPath,
    isConversationLocked,
    getConversationLockState,
    withConversationLock,
    runWithAutomationContext,
    getAutomationContext,
    setControlDbForTest,
    getTakeoverState,
    reconcileTakeoverExpiry,
    activateTakeover,
    releaseTakeover,
    evaluateAutomatedSendGate,
    shouldSuppressAutomatedSend,
    recordSuppressedAutomatedSend,
    ingestMessage,
    updateMessageStatus,
    ingestBaileysUpsert,
    ingestBaileysStatusUpdate,
    hookBaileysSocket,
    listConversations,
    getTimeline,
    markConversationRead,
    sendManualText,
    sendManualMedia,
    getMediaRecord
}

export default inboxService
