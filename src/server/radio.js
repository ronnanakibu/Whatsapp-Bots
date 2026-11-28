// src/server/radio.js
// Express & Socket.IO Server serving real-time BotOS Dashboard & radio stream
import express from 'express'
import multer from 'multer'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

import { radioService } from '../services/radio.js'
import { logger, addLogListener, removeLogListener, addMessageListener, removeMessageListener, getSocket, getLogHistory } from '../utils/logger.js'
import qrcode from 'qrcode'
import { metricsService } from '../services/metrics.js'
import { commands, getAllCommands, initializeRegistry } from '../core/registry.js'
import { memoryService } from '../services/memory.js'
import { moderatorService } from '../services/moderator.js'
import { eventBus } from '../events/bus.js'
import { userService } from '../services/user-v2.js'
import { userRepository } from '../repositories/user.repository.js'
import { chatService } from '../services/chat-v2.js'
import { mediaService } from '../services/media.js'
import { prisma } from '../config/database.js'
import { db as sharedDb } from '../services/db.js'
import { buildAiProviderTelemetry, buildControlAnalyticsSnapshot, buildControlMetricsSnapshot } from './telemetry.js'
import { getWhatsAppStatusSnapshot, recordWhatsAppStateChange } from './whatsappOps.js'
import { startSunoPipeline, getActiveJobs, confirmThumbnail, startPlaylistPipeline } from '../services/suno.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import {
    verifyJwt,
    normalizeUserAgent,
    authenticateControlJwt,
    requirePermission,
    requireConfirmation
} from './middleware/auth.js'
import authRouter from './routes/auth.js'
import sunoRouter from './routes/suno.js'
import musicRouter from './routes/music.js'
import lyricsRouter from './routes/lyrics.js'
import usersRouter from './routes/users.js'
import systemRouter from './routes/system.js'
import controlRouter from './routes/control.js'
import { PERMISSIONS, ROLES, hasPermission } from './security/rbac.js'
import {
    getControlJwtSecret,
    getRadioJwtSecret,
    verifyControlToken,
    recordAudit,
    bootstrapOwnerFromEnv,
    getAppSetting
} from './security/controlAuth.js'
import { isRuntimeLeaseHealthy } from '../services/runtimeSingleton.js'
import { redactSensitive, safeErrorMessage } from './security/redaction.js'
import { appConfig } from '../config/index.js'

const RADIO_PORT = appConfig.port
const MAX_HISTORY = 20

let server = null
let serverInstance = null
export let io = null
let controlNs = null
let metricsInterval = null
let analyticsInterval = null
let tokenCleanupInterval = null
let archiverInterval = null
let selfMonitorInterval = null
let lastSelfCheckSnapshot = null
export const streamTokens = new Map()
const userConnections = new Map()
const sseHistory = []
let sseEventCounter = 1

function isOriginAllowed(origin) {
    if (!origin) return true
    const normalizedOrigin = String(origin).trim().replace(/\/+$/, '')
    if (!normalizedOrigin || normalizedOrigin.includes('*')) return false

    const allowedRaw = (process.env.ALLOWED_ORIGINS || '').trim()
    if (allowedRaw) {
        const allowList = allowedRaw
            .split(',')
            .map(s => s.trim().replace(/\/+$/, ''))
            .filter(s => Boolean(s) && !s.includes('*'))
        return allowList.includes(normalizedOrigin)
    }
    if (process.env.NODE_ENV !== 'production') {
        try {
            const parsed = new URL(normalizedOrigin)
            return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
        } catch {
            return false
        }
    }
    return false
}

// Connection status cache
let currentBotStatus = 'connecting'
let currentQrCode = null
let currentPairingCode = null

// Recently played history
const recentlyPlayed = []

// Shared SQLite singleton owned by src/services/db.js
const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
export const db = sharedDb

function getDbSize() {
    try {
        const stats = fs.statSync(DB_PATH)
        return stats.size
    } catch (e) {
        return 0
    }
}

function getTableNames() {
    if (!db) return []
    try {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
        return rows.map(r => r.name)
    } catch (e) {
        return []
    }
}

export function resolveSongId(songId) {
    if (!songId || !db) return songId
    try {
        const row = db.prepare('SELECT song_id FROM songs WHERE song_id = ? OR song_id = ? OR song_id = ?').get(
            songId,
            decodeURIComponent(songId),
            encodeURIComponent(songId)
        )
        return row ? row.song_id : songId
    } catch (_) {
        return songId
    }
}

// ─────────────────────────────────────────────
// DATA GETTERS
// ─────────────────────────────────────────────

// Cache for group avatar URLs to prevent rate-limiting and performance lags
const avatarCache = {}

async function getGroupsList() {
    const sock = getSocket()
    let groupsMeta = {}
    if (sock) {
        try {
            groupsMeta = await sock.groupFetchAllParticipating()
        } catch (err) {
            logger.error('[Radio/Groups] Failed to fetch participating groups:', err.message)
        }
    }

    const dbConfigs = {}
    if (db) {
        try {
            const rows = db.prepare(`
                SELECT 
                    c.chat_id as id,
                    c.persona,
                    c.ai_enabled,
                    c.ai_provider,
                    m.enabled as mod_enabled,
                    m.max_warnings
                FROM chat_config c
                LEFT JOIN moderation_config m ON c.chat_id = m.chat_id
                WHERE c.chat_id LIKE '%@g.us'
            `).all()
            for (const r of rows) {
                dbConfigs[r.id] = r
            }
        } catch (e) {
            // ignore
        }
    }

    const groupJids = new Set([...Object.keys(groupsMeta), ...Object.keys(dbConfigs)])

    // Resolve group metadata and profile picture URLs in parallel with in-memory caching
    const mergedList = await Promise.all(Array.from(groupJids).map(async (jid) => {
        const meta = groupsMeta[jid]
        const dbConf = dbConfigs[jid]

        let name = meta?.subject || dbConf?.id?.split('@')[0] || jid.split('@')[0]
        let desc = 'No group description available.'
        if (meta?.desc) {
            desc = typeof meta.desc === 'string' ? meta.desc : String(meta.desc)
        }
        let memberCount = meta?.participants?.length || 0

        let avatarUrl = avatarCache[jid] || ''
        if (!avatarUrl && sock && sock.profilePictureUrl) {
            try {
                avatarUrl = await sock.profilePictureUrl(jid, 'image')
                avatarCache[jid] = avatarUrl
            } catch (_) {
                avatarCache[jid] = ''
            }
        }

        return {
            chatId: jid,
            name: name,
            desc: desc,
            avatarUrl: avatarUrl,
            members: memberCount,
            aiEnabled: dbConf ? !!dbConf.ai_enabled : false,
            moderationEnabled: dbConf ? !!dbConf.mod_enabled : false,
            aiProvider: dbConf ? (dbConf.ai_provider || 'groq') : 'groq',
            maxWarnings: dbConf ? (dbConf.max_warnings || 3) : 3,
            lastActivity: 'Active'
        }
    }))

    return mergedList
}

function getUsersList() {
    if (!db) return []
    try {
        const rows = db.prepare(`SELECT * FROM users ORDER BY commands_count DESC`).all()
        return rows.map(r => ({
            jid: r.jid,
            name: r.name || r.jid.split('@')[0],
            commandsCount: r.commands_count ?? 0,
            warnings: r.warnings ?? 0,
            role: r.role || 'user',
            lastSeen: r.last_seen ?? null
        }))
    } catch (e) {
        return []
    }
}

function getCommandsList() {
    const list = []
    const uniqueCmds = Array.from(new Set(commands.values()))
    for (const cmd of uniqueCmds) {
        list.push({
            name: cmd.name,
            category: cmd.category || 'general',
            aliases: cmd.aliases || [],
            enabled: cmd.enabled !== false,
            cooldown: cmd.cooldown || 3,
            usageCount: metricsService.getCommandUsage(cmd.name),
            usageProvenance: {
                source: 'metricsService:process_session',
                measured: true
            }
        })
    }
    return list
}

function addToHistory(track) {
    recentlyPlayed.unshift({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        url: track.url,
        duration: track.duration,
        durationFormatted: track.durationFormatted,
        thumbnail: track.thumbnail,
        requestedBy: track.requestedBy || 'Auto DJ',
        requester: track.requestedBy || 'Auto DJ',
        playedAt: Date.now(),
    })
    if (recentlyPlayed.length > MAX_HISTORY) recentlyPlayed.pop()
}

// SSE CLIENT MANAGEMENT
const sseClients = new Set()

export function broadcastSSE(event, data, correlationId = null) {
    const eventId = sseEventCounter++
    const hasCorrelation = ['engagement:reaction', 'queue:update', 'engagement:favorite'].includes(event)
    const activeCorrelationId = hasCorrelation ? correlationId : null

    const eventObj = {
        id: eventId,
        event,
        data,
        timestamp: Date.now(),
        correlationId: activeCorrelationId
    }

    sseHistory.push(eventObj)

    const now = Date.now()
    const tenMinutesAgo = now - 600000
    while (sseHistory.length > 5000 || (sseHistory.length > 0 && sseHistory[0].timestamp < tenMinutesAgo)) {
        sseHistory.shift()
    }

    const dataToSend = (typeof data === 'object' && data !== null)
        ? (Array.isArray(data) ? data : { ...data, correlationId: activeCorrelationId })
        : data

    const payload = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(dataToSend)}\n\n`
    for (const client of sseClients) {
        if (client.destroyed || !client.writable) {
            sseClients.delete(client)
            continue
        }
        try { client.write(payload) }
        catch { sseClients.delete(client) }
    }
}

function getQueueData() {
    return radioService.queue.map((track, i) => ({
        position: i + 1,
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        url: track.url,
        duration: track.duration,
        durationFormatted: track.durationFormatted,
        thumbnail: track.thumbnail,
        requestedBy: track.requestedBy || 'Auto DJ',
        requester: track.requestedBy || 'Auto DJ',
    }))
}

function getFullStatus() {
    const track = radioService.currentTrack
    return {
        isPlaying: radioService.isPlaying,
        listeners: radioService.listenerCount,
        nowPlaying: track ? {
            title: track.title,
            artist: track.artist || 'Unknown Artist',
            url: track.url,
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            requestedBy: track.requestedBy || 'Auto DJ',
            requester: track.requestedBy || 'Auto DJ',
            startedAt: track.addedAt,
        } : null,
        queue: getQueueData(),
        queueLength: radioService.queue.length,
        history: recentlyPlayed.slice(0, 10),
        fx: radioService.activeFx,
        eq: radioService.activeEq,
        metrics: metricsService.getSystemMetrics(),
        analytics: metricsService.getAnalyticsData(),
    }
}

// Wire up radioService events
function setupRadioBroadcasts() {
    radioService.on('track:start', (track) => {
        addToHistory(track)
        const trackData = {
            title: track.title,
            artist: track.artist || 'Unknown Artist',
            url: track.url,
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            requestedBy: track.requestedBy || 'Auto DJ',
            requester: track.requestedBy || 'Auto DJ',
        }
        broadcastSSE('track:start', trackData)
        io?.emit('track:start', trackData)

        const qUpdate = getQueueData()
        broadcastSSE('queue:update', qUpdate)
        io?.emit('queue:update', qUpdate)
    })

    radioService.on('queue:add', (track, correlationId) => {
        const qUpdate = getQueueData()
        broadcastSSE('queue:update', qUpdate, correlationId)
        io?.emit('queue:update', qUpdate)
    })

    radioService.on('queue:clear', () => {
        const qUpdate = getQueueData()
        broadcastSSE('queue:update', qUpdate)
        io?.emit('queue:update', qUpdate)
    })

    radioService.on('radio:idle', () => {
        broadcastSSE('radio:idle', { timestamp: Date.now() })
        io?.emit('radio:idle', { timestamp: Date.now() })
    })

    radioService.on('radio:stop', () => {
        broadcastSSE('radio:stop', { timestamp: Date.now() })
        io?.emit('radio:stop', { timestamp: Date.now() })
    })

    radioService.on('listener:join', (count) => {
        broadcastSSE('listeners:update', { count })
        io?.emit('listeners:update', { count })
    })

    radioService.on('listener:leave', (count) => {
        broadcastSSE('listeners:update', { count })
        io?.emit('listeners:update', { count })
    })
}

// ─────────────────────────────────────────────
// EXPORTED STATUS SINK (CALLABLE BY BOT.JS)
// ─────────────────────────────────────────────

export function updateBotStatus(state, data = null, meta = {}) {
    currentBotStatus = state
    if (state === 'qr') {
        currentQrCode = data
        currentPairingCode = null
    } else if (state === 'pairing') {
        currentPairingCode = data
        currentQrCode = null
    } else if (state === 'open' || state === 'close' || state === 'logged_out' || state === 'error') {
        currentQrCode = null
        currentPairingCode = null
    }
    recordWhatsAppStateChange(state, data, meta)
    const waSnapshot = getWhatsAppStatusSnapshot()

    // Broadcast state only to public SSE (never expose QR or pairingCode publicly)
    broadcastSSE('status:change', { state })

    // Emit pairing material ONLY to authenticated Control sockets with WHATSAPP_PAIRING_READ
    const emitScopedStatus = (ns) => {
        if (!ns) return
        for (const s of ns.sockets.values()) {
            const canSeePairing = hasPermission(s.data?.controlUser, PERMISSIONS.WHATSAPP_PAIRING_READ)
            if (canSeePairing) {
                s.emit('status:change', { state, qr: currentQrCode, pairingCode: currentPairingCode, whatsapp: waSnapshot })
            } else {
                s.emit('status:change', { state, whatsapp: waSnapshot })
            }
        }
    }
    emitScopedStatus(io?.of('/'))
    emitScopedStatus(controlNs)

    // If bot becomes online/open, broadcast updated lists after dynamic sync stabilizes
    if (state === 'open') {
        setTimeout(async () => {
            try {
                const groups = await getGroupsList()
                io?.emit('groups:update', groups)
                controlNs?.emit('groups:update', groups)
                const users = getUsersList()
                io?.emit('users:update', users)
                controlNs?.emit('users:update', users)
            } catch (err) {
                logger.error('[Radio/StatusOpen] Failed to broadcast lists on open:', err.message)
            }
        }, 3000)
    }
}

// ─────────────────────────────────────────────
// EXPORTED START / STOP FUNCTIONS
// ─────────────────────────────────────────────

// Log listeners callbacks
let logListenerCallback = null
let messageListenerCallback = null

export function startRadioServer(options = {}) {
    if (serverInstance) return { server: serverInstance, io }

    // Fail closed on missing, weak, or identical dual JWT signing secrets BEFORE binding Express/Socket.IO
    getControlJwtSecret()
    getRadioJwtSecret()

    bootstrapOwnerFromEnv()
    try {
        const savedCookie = getAppSetting('SUNO_COOKIE')
        if (savedCookie && !process.env.SUNO_COOKIE) process.env.SUNO_COOKIE = savedCookie
        const savedTunnel = getAppSetting('SUNO_API_URL')
        if (savedTunnel && !process.env.SUNO_API_URL) process.env.SUNO_API_URL = savedTunnel
    } catch (_) { }

    // Startup recovery query
    if (db) {
        try {
            const res = db.prepare(`
                UPDATE listening_sessions 
                SET left_at = unixepoch(), 
                    duration_seconds = MAX(0, unixepoch() - joined_at) 
                WHERE left_at IS NULL
            `).run()
            logger.info(`[Radio/Startup] Cleaned up ${res.changes} hanging listening sessions.`)
        } catch (err) {
            logger.error(`[Radio/Startup] Failed to recover hanging sessions: ${err.message}`)
        }
    }

    tokenCleanupInterval = setInterval(() => {
        const now = Date.now()
        let cleaned = 0
        for (const [tokenStr, tokenObj] of streamTokens.entries()) {
            if (tokenObj.consumed || tokenObj.expiresAt < now) {
                streamTokens.delete(tokenStr)
                cleaned++
            }
        }
        if (cleaned > 0) {
            logger.info(`[Token/Cleanup] Cleaned up ${cleaned} expired or consumed stream tokens.`)
        }
    }, 60000)
    tokenCleanupInterval.unref?.()

    setupRadioBroadcasts()

    const app = express()
    const trustProxyRaw = (process.env.TRUST_PROXY || '').trim()
    if (trustProxyRaw) {
        const numericTrust = Number(trustProxyRaw)
        app.set(
            'trust proxy',
            Number.isInteger(numericTrust) ? numericTrust : trustProxyRaw === 'true' ? 1 : trustProxyRaw
        )
    }
    serverInstance = createServer(app)
    io = new SocketServer(serverInstance, {
        cors: {
            origin: (origin, callback) => {
                if (isOriginAllowed(origin)) return callback(null, true)
                return callback(new Error('Origin not allowed by CORS'), false)
            },
            methods: ['GET', 'POST']
        }
    })
    controlNs = io.of('/control')

    // Subscribe to Suno Status updates and broadcast via authenticated Control Socket.IO
    eventBus.subscribe('suno:status', (job) => {
        io?.emit('suno:status', job)
        controlNs?.emit('suno:status', job)
    })

    // Relay thumbnail_ready to authenticated Control Socket.IO clients
    eventBus.subscribe('suno:thumbnail_ready', (data) => {
        io?.emit('suno:thumbnail_ready', data)
        controlNs?.emit('suno:thumbnail_ready', data)
    })

    eventBus.subscribe('control:commands:update', () => {
        const list = getCommandsList()
        io?.emit('commands:update', list)
        controlNs?.emit('commands:update', list)
    })

    eventBus.subscribe('control:groups:update', async () => {
        try {
            const groups = await getGroupsList()
            io?.emit('groups:update', groups)
            controlNs?.emit('groups:update', groups)
        } catch (err) {
            logger.error('[ControlSocket/GroupsBroadcast] Failed:', err.message)
        }
    })

    const emitInboxScoped = (eventName, payload, onlyControlUserId = null) => {
        const send = (ns) => {
            if (!ns) return
            for (const s of ns.sockets.values()) {
                const actor = s.data?.controlUser
                if (!hasPermission(actor, PERMISSIONS.WHATSAPP_INBOX_READ)) continue
                if (onlyControlUserId && actor?.id !== onlyControlUserId) continue
                s.emit(eventName, payload)
            }
        }
        send(io?.of('/'))
        send(controlNs)
    }

    eventBus.subscribe('inbox:message:new', (payload) => {
        emitInboxScoped('inbox:message:new', payload)
    })

    eventBus.subscribe('inbox:message:update', (payload) => {
        emitInboxScoped('inbox:message:update', payload)
    })

    eventBus.subscribe('inbox:conversation:read', (payload) => {
        emitInboxScoped('inbox:conversation:read', payload, payload?.controlUserId || null)
    })

    eventBus.subscribe('inbox:takeover:update', (payload) => {
        emitInboxScoped('inbox:takeover:update', payload)
    })

    eventBus.subscribe('inbox:takeover:suppressed', (payload) => {
        emitInboxScoped('inbox:takeover:suppressed', payload)
    })

    // --- V2 Socket.IO Namespaces ---
    const chatNamespace = io.of('/chat')
    const presenceNamespace = io.of('/presence')
    const songReactionsNamespace = io.of('/song-reactions')

    const ALLOWED_SONG_REACTIONS = new Set([
        '❤️', '🔥', '👏', '🎵', '😂', '👍', '🎉', '😍', '🤘', '💯',
        'heart', 'fire', 'clap', 'music', 'laugh', 'thumbsup'
    ])

    function createSocketRateLimiter(maxEvents, windowMs) {
        let count = 0
        let resetAt = Date.now() + windowMs
        return () => {
            const now = Date.now()
            if (now >= resetAt) {
                count = 0
                resetAt = now + windowMs
            }
            if (count >= maxEvents) return false
            count += 1
            return true
        }
    }

    // --- V2 Event Bus decoupled subscriptions ---
    eventBus.subscribe('chat.message', (payload) => {
        chatNamespace.emit('chat:new_message', {
            id: payload.messageId,
            userId: payload.userId,
            nickname: payload.nickname,
            content: payload.content,
            timestamp: payload.timestamp.getTime()
        })
    })

    chatNamespace.on('connection', (socket) => {
        logger.info(`[Socket/Chat] Client connected: ${socket.id}`)
        const allowChatMsg = createSocketRateLimiter(10, 10_000)
        const allowChatReact = createSocketRateLimiter(15, 10_000)

        socket.on('chat:send_message', async (data) => {
            if (!data || typeof data.content !== 'string') return
            const trimmed = data.content.trim()
            if (!trimmed || trimmed.length > 500) {
                socket.emit('error', 'Pesan harus antara 1 dan 500 karakter.')
                return
            }
            if (!allowChatMsg()) {
                socket.emit('error', 'Terlalu banyak pesan, coba lagi beberapa saat.')
                return
            }
            try {
                const decoded = verifyJwt(data.token)
                if (!decoded || !decoded.jid) {
                    socket.emit('error', 'Sesi tidak valid.')
                    return
                }
                await chatService.sendMessage(decoded.jid, trimmed)
            } catch (err) {
                socket.emit('error', err.message)
            }
        })

        socket.on('chat:add_reaction', async (data) => {
            if (!data || !allowChatReact()) return
            const messageId = typeof data.messageId === 'string' ? data.messageId.trim() : ''
            const reaction = typeof data.reaction === 'string' ? data.reaction.trim() : ''
            if (!messageId || messageId.length > 128 || !reaction || reaction.length > 16) return
            try {
                const decoded = verifyJwt(data.token)
                if (!decoded || !decoded.jid) return
                await chatService.addReaction(messageId, decoded.jid, reaction)
                chatNamespace.emit('chat:reactions_update', {
                    messageId,
                    reaction,
                    userId: decoded.jid
                })
            } catch (_) {
                // ignore
            }
        })
    })

    presenceNamespace.on('connection', (socket) => {
        logger.info(`[Socket/Presence] Client connected: ${socket.id}`)
        const allowPresence = createSocketRateLimiter(20, 10_000)

        socket.on('presence:change', async (data) => {
            if (!data || !allowPresence()) return
            try {
                const decoded = verifyJwt(data?.token)
                if (!decoded || !decoded.jid) return
                const allowedStatuses = new Set(['listening', 'idle', 'online', 'offline'])
                const nextStatus = allowedStatuses.has(data?.status) ? data.status : null
                if (!nextStatus) return

                // Persist presence without blocking real-time broadcast if Postgres is unavailable (Lite Mode)
                Promise.resolve(userRepository.updateUserPresence(decoded.jid, nextStatus)).catch((err) => {
                    logger.warn(`[Socket/Presence] Persistence skipped: ${err.message}`)
                })
                presenceNamespace.emit('presence:listeners_update', {
                    userId: decoded.jid,
                    status: nextStatus,
                    timestamp: Date.now()
                })
            } catch (err) {
                logger.warn(`[Socket/Presence] Error handling presence:change: ${err.message}`)
            }
        })
    })

    songReactionsNamespace.on('connection', (socket) => {
        logger.info(`[Socket/SongReactions] Client connected: ${socket.id}`)
        const allowReaction = createSocketRateLimiter(15, 10_000)

        socket.on('song:react', (data) => {
            if (!data || typeof data !== 'object') return
            const songId = typeof data.songId === 'string' ? data.songId.trim() : ''
            const reaction = typeof data.reaction === 'string' ? data.reaction.trim() : ''
            if (!songId || songId.length > 128 || !ALLOWED_SONG_REACTIONS.has(reaction)) return
            if (!allowReaction()) return

            songReactionsNamespace.emit('song:reactions_sync', {
                songId,
                reaction,
                timestamp: Date.now()
            })
        })
    })

    // Daily chat logging archiver scheduler
    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    archiverInterval = setInterval(() => {
        logger.info('[Scheduler] Running daily chat log archiver...')
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        chatService.archiveDailyLogs(yesterday)
            .then((file) => logger.info(`[Scheduler] Daily logs archived to: ${file}`))
            .catch((err) => logger.warn(`[Scheduler] Daily chat log archiving skipped: ${err.message}`))
    }, ONE_DAY_MS)
    archiverInterval.unref?.()

    // Setup periodic metrics broadcasts (to authenticated Control sockets & public SSE)
    metricsInterval = setInterval(() => {
        const sysMetrics = metricsService.getSystemMetrics()
        broadcastSSE('metrics', sysMetrics)
        const payload = buildControlMetricsSnapshot({
            db,
            metricsService,
            dbSizeBytes: getDbSize()
        })
        io?.emit('metrics', payload)
        controlNs?.emit('metrics', payload)
    }, 3000)
    metricsInterval.unref?.()

    analyticsInterval = setInterval(() => {
        const anaData = metricsService.getAnalyticsData()
        broadcastSSE('analytics', anaData)
        const payload = buildControlAnalyticsSnapshot({ metricsService })
        io?.emit('analytics', payload)
        controlNs?.emit('analytics', payload)
    }, 10000)
    analyticsInterval.unref?.()

    // Hook logger listeners (redacted before emission)
    logListenerCallback = (text) => {
        const safeText = redactSensitive(String(text))
        io?.emit('log', safeText)
        controlNs?.emit('log', safeText)
    }
    messageListenerCallback = (msg) => {
        const safeMsg = redactSensitive(msg)
        io?.emit('message', safeMsg)
        controlNs?.emit('message', safeMsg)
    }
    addLogListener(logListenerCallback)
    addMessageListener(messageListenerCallback)

    // ─────────────────────────────────────────────
    // AUTHENTICATED CONTROL CENTER SOCKET.IO GATE (HTTP PARITY)
    // Applied to both default '/' (legacy client compat) and '/control' namespace.
    // Public Radio continues using '/chat', '/presence', '/song-reactions', and '/events'.
    // ─────────────────────────────────────────────
    function extractSocketToken(socket) {
        const authToken = socket.handshake?.auth?.token
        if (typeof authToken === 'string' && authToken.trim()) {
            return authToken.trim()
        }
        const header = socket.handshake?.headers?.authorization
        if (typeof header === 'string' && header.startsWith('Bearer ')) {
            return header.slice(7).trim()
        }
        return null
    }

    function attachControlSocketAuth(ns) {
        ns.use((socket, next) => {
            const token = extractSocketToken(socket)
            if (!token) {
                return next(new Error('UNAUTHORIZED: Control Center token required'))
            }
            const result = verifyControlToken(token)
            if (!result.user) {
                return next(new Error(`${result.code || 'UNAUTHORIZED'}: ${result.error || 'Authentication failed'}`))
            }
            socket.data.token = token
            socket.data.controlUser = result.user
            next()
        })
    }

    function authorizeSocketEvent(socket, permission, action, target = null) {
        const result = verifyControlToken(socket.data?.token)
        if (!result.user) {
            socket.emit('error', { code: result.code || 'UNAUTHORIZED', message: result.error || 'Session invalid or revoked.' })
            socket.disconnect(true)
            return null
        }
        socket.data.controlUser = result.user
        if (!hasPermission(result.user, permission)) {
            recordAudit({
                actorId: result.user.id,
                actorRole: result.user.role,
                action,
                target,
                result: 'denied'
            })
            socket.emit('error', {
                code: 'FORBIDDEN',
                message: `Insufficient permissions: ${permission} required.`
            })
            return null
        }
        return result.user
    }

    function registerControlSocketHandlers(ns) {
        attachControlSocketAuth(ns)

        ns.on('connection', async (socket) => {
            const user = socket.data.controlUser
            logger.info(`[ControlSocket] Client connected: ${socket.id} (user=${user.username}, role=${user.role})`)

            try {
                const groups = await getGroupsList()
                const users = getUsersList()
                const canReadPairing = hasPermission(user, PERMISSIONS.WHATSAPP_PAIRING_READ)
                const canReadFullLogs = hasPermission(user, PERMISSIONS.LOGS_READ_FULL)
                const canReadDbMeta = hasPermission(user, PERMISSIONS.DB_METADATA_READ)
                const rawLogs = getLogHistory().map(l => redactSensitive(String(l)))
                const scopedLogs = canReadFullLogs ? rawLogs : rawLogs.slice(-100)

                socket.emit('init', {
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role,
                        permissions: user.permissions
                    },
                    status: {
                        state: currentBotStatus,
                        whatsapp: getWhatsAppStatusSnapshot(),
                        ...(canReadPairing ? { qr: currentQrCode, pairingCode: currentPairingCode } : {})
                    },
                    uptime: Math.floor(process.uptime()),
                    metrics: buildControlMetricsSnapshot({
                        db,
                        metricsService,
                        usersCount: users.length,
                        groupsCount: groups.length,
                        dbSizeBytes: getDbSize()
                    }),
                    analytics: buildControlAnalyticsSnapshot({ metricsService }),
                    commands: getCommandsList(),
                    groups: groups,
                    users: users,
                    logs: scopedLogs,
                    ...(canReadDbMeta ? { dbTables: getTableNames() } : {}),
                    sunoJobs: getActiveJobs(),
                    ai: buildAiProviderTelemetry()
                })
            } catch (err) {
                logger.error('[ControlSocket/Init] Error compiling client init payload:', err.message)
            }

            socket.on('suno:get_active', () => {
                if (!authorizeSocketEvent(socket, PERMISSIONS.CREATOR_READ, 'socket:suno:get_active')) return
                try {
                    const jobs = getActiveJobs()
                    const activeJob = jobs.find(j => j.status === 'running')
                    if (activeJob) {
                        socket.emit('suno:status', activeJob)
                    }
                } catch (err) {
                    logger.error('[Socket/Suno] Error fetching active jobs:', err.message)
                }
            })

            socket.on('suno:generate', async (data) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.CREATOR_OPERATE, 'socket:suno:generate')
                if (!actor) return
                const { prompt, title, enhance, model, isCustom, lyrics, tags, make_instrumental, enhanceLyrics, vignetteMode } = data || {}
                if (!prompt) return socket.emit('error', { code: 'BAD_REQUEST', message: 'Prompt tidak boleh kosong' })
                logger.info(`[Socket/Suno] Triggering suno generation by ${actor.username}`)
                try {
                    const jobId = await startSunoPipeline({
                        prompt,
                        title,
                        enhance,
                        source: 'web',
                        model,
                        isCustom,
                        lyrics,
                        tags,
                        make_instrumental,
                        enhanceLyrics,
                        vignetteMode: vignetteMode || 'normal'
                    })
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:suno:generate', target: jobId, result: 'allowed' })
                    socket.emit('suno:started', { jobId })
                } catch (err) {
                    socket.emit('error', { code: 'INTERNAL_ERROR', message: safeErrorMessage(err, 'Gagal memulai generasi') })
                }
            })

            socket.on('suno:playlist_generate', async (data) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.CREATOR_OPERATE, 'socket:suno:playlist_generate')
                if (!actor) return
                const { songs, outputTitle, playlistDescription, transitionStyle, generateMotion, vignetteMode } = data || {}
                if (!songs || !Array.isArray(songs) || songs.length === 0) {
                    return socket.emit('error', { code: 'BAD_REQUEST', message: 'Lagu-lagu playlist tidak boleh kosong.' })
                }
                if (!outputTitle) {
                    return socket.emit('error', { code: 'BAD_REQUEST', message: 'Judul Playlist YouTube wajib diisi.' })
                }
                try {
                    const jobId = await startPlaylistPipeline({
                        songs,
                        outputTitle,
                        playlistDescription: playlistDescription || '',
                        transitionStyle: transitionStyle || 'dissolve',
                        generateMotion: !!generateMotion,
                        vignetteMode: vignetteMode || 'normal',
                        source: 'web',
                        chatId: null
                    })
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:suno:playlist_generate', target: jobId, result: 'allowed' })
                    socket.emit('suno:started', { jobId })
                } catch (err) {
                    socket.emit('error', { code: 'INTERNAL_ERROR', message: safeErrorMessage(err, 'Gagal memulai playlist pipeline') })
                }
            })

            socket.on('suno:confirm_thumbnail', (data) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.CREATOR_OPERATE, 'socket:suno:confirm_thumbnail', data?.jobId)
                if (!actor) return
                const { jobId, approved, newPrompt } = data || {}
                const ok = confirmThumbnail(jobId, { approved, newPrompt: newPrompt || null })
                recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:suno:confirm_thumbnail', target: jobId, result: ok ? 'allowed' : 'not_found' })
            })

            socket.on('bot:restart', (data) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.SYSTEM_RESTART, 'socket:bot:restart', 'process')
                if (!actor) return
                if (data?.confirm !== true) {
                    return socket.emit('error', { code: 'CONFIRMATION_REQUIRED', message: 'Explicit confirm: true is required to restart.' })
                }
                recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:bot:restart', target: 'process', result: 'allowed' })
                logger.warn(`[ControlSocket] Process exit triggered by ${actor.username} (${actor.role}).`)
                process.exit(0)
            })

            socket.on('command:toggle', ({ name, enabled } = {}) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.COMMANDS_TOGGLE, 'socket:command:toggle', name)
                if (!actor) return
                const cmd = commands.get(name)
                if (!cmd) return
                const perms = Array.isArray(cmd.permissions) ? cmd.permissions : []
                if (perms.includes('owner') && actor.role !== ROLES.OWNER) {
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:command:toggle', target: name, result: 'denied' })
                    return socket.emit('error', { code: 'FORBIDDEN', message: 'Only Owner can toggle owner-scoped commands.' })
                }
                cmd.enabled = Boolean(enabled)
                recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:command:toggle', target: name, result: 'allowed' })
                logger.info(`[ControlSocket] Toggled command "${name}" -> ${Boolean(enabled)} by ${actor.username}`)
                const list = getCommandsList()
                io?.emit('commands:update', list)
                controlNs?.emit('commands:update', list)
            })

            socket.on('group:toggle_ai', async ({ chatId, enabled } = {}) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.WHATSAPP_GROUP_CONFIG, 'socket:group:toggle_ai', chatId)
                if (!actor) return
                try {
                    memoryService.setAiEnabled(chatId, Boolean(enabled))
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:group:toggle_ai', target: chatId, result: 'allowed' })
                    const groups = await getGroupsList()
                    io?.emit('groups:update', groups)
                    controlNs?.emit('groups:update', groups)
                } catch (err) {
                    logger.error('[ControlSocket/ToggleAI] Failed to toggle group AI:', err.message)
                }
            })

            socket.on('group:toggle_moderation', async ({ chatId, enabled } = {}) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.WHATSAPP_GROUP_CONFIG, 'socket:group:toggle_moderation', chatId)
                if (!actor) return
                try {
                    await moderatorService.setModerationEnabled(chatId, Boolean(enabled))
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:group:toggle_moderation', target: chatId, result: 'allowed' })
                    const groups = await getGroupsList()
                    io?.emit('groups:update', groups)
                    controlNs?.emit('groups:update', groups)
                } catch (err) {
                    logger.error('[ControlSocket/ToggleMod] Failed to toggle group moderation:', err.message)
                }
            })

            socket.on('group:broadcast', async ({ chatId, text, confirm } = {}) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.WHATSAPP_GROUP_BROADCAST, 'socket:group:broadcast', chatId)
                if (!actor) return
                if (confirm !== true) {
                    return socket.emit('error', { code: 'CONFIRMATION_REQUIRED', message: 'Explicit confirm: true is required for broadcast.' })
                }
                const sock = getSocket()
                if (!sock) {
                    return socket.emit('error', { code: 'SERVICE_UNAVAILABLE', message: 'WhatsApp socket offline.' })
                }
                try {
                    let mentions = []
                    try {
                        const groupMeta = await sock.groupMetadata(chatId)
                        if (groupMeta?.participants) mentions = groupMeta.participants.map(p => p.id)
                    } catch (_) { }
                    await sock.sendMessage(chatId, { text: `📢 *PENGUMUMAN DARI OWNER*\n\n${text}`, mentions })
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:group:broadcast', target: chatId, result: 'allowed' })
                } catch (err) {
                    logger.error(`[ControlSocket/Broadcast] Failed for ${chatId}:`, err.message)
                    socket.emit('error', { code: 'INTERNAL_ERROR', message: safeErrorMessage(err) })
                }
            })

            socket.on('group:leave', async ({ chatId, confirm } = {}) => {
                const actor = authorizeSocketEvent(socket, PERMISSIONS.WHATSAPP_GROUP_LEAVE, 'socket:group:leave', chatId)
                if (!actor) return
                if (confirm !== true) {
                    return socket.emit('error', { code: 'CONFIRMATION_REQUIRED', message: 'Explicit confirm: true is required to leave a group.' })
                }
                const sock = getSocket()
                if (!sock) {
                    return socket.emit('error', { code: 'SERVICE_UNAVAILABLE', message: 'WhatsApp socket sedang offline.' })
                }
                try {
                    try {
                        await sock.sendMessage(chatId, { text: '👋 *Bot pamit keluar dari grup ini.* Terima kasih!' })
                    } catch (_) { }
                    await sock.groupLeave(chatId)
                    delete avatarCache[chatId]
                    if (db) {
                        try {
                            db.prepare('DELETE FROM chat_config WHERE chat_id = ?').run(chatId)
                            db.prepare('DELETE FROM moderation_config WHERE chat_id = ?').run(chatId)
                        } catch (_) { }
                    }
                    recordAudit({ actorId: actor.id, actorRole: actor.role, action: 'socket:group:leave', target: chatId, result: 'allowed' })
                    const groups = await getGroupsList()
                    io?.emit('groups:update', groups)
                    controlNs?.emit('groups:update', groups)
                    socket.emit('group:left', { chatId, success: true })
                } catch (err) {
                    logger.error(`[ControlSocket/LeaveGroup] Failed for ${chatId}:`, err.message)
                    socket.emit('error', { code: 'INTERNAL_ERROR', message: safeErrorMessage(err) })
                }
            })

            // db:query permanently removed per SEC-007 (use /api/v2/control/db/tables read-only metadata)

            socket.on('disconnect', () => {
                logger.info(`[ControlSocket] Client disconnected: ${socket.id}`)
            })
        })
    }

    registerControlSocketHandlers(io.of('/'))
    registerControlSocketHandlers(controlNs)

    function generateRequestId() {
        const today = new Date()
        const yyyy = today.getFullYear()
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const dd = String(today.getDate()).padStart(2, '0')
        const dateStr = `${yyyy}${mm}${dd}`
        const hexChars = '0123456789ABCDEF'
        let hex = ''
        for (let i = 0; i < 8; i++) {
            hex += hexChars[Math.floor(Math.random() * 16)]
        }
        return `REQ-${dateStr}-${hex}`
    }

    // CORS, Request ID, and Logging middleware
    app.use((req, res, next) => {
        let reqId = req.headers['x-request-id']
        if (!reqId || typeof reqId !== 'string') {
            reqId = generateRequestId()
        }
        req.id = reqId
        res.setHeader('X-Request-ID', reqId)

        // Log request entry
        logger.info(`[${reqId}] ${req.method} ${req.originalUrl || req.url}`)

        // CORS headers (restricted via ALLOWED_ORIGINS in production)
        const reqOrigin = req.headers.origin
        if (reqOrigin && isOriginAllowed(reqOrigin)) {
            res.setHeader('Access-Control-Allow-Origin', reqOrigin)
            res.setHeader('Vary', 'Origin')
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Accept, Authorization, X-Request-ID, X-API-Key')
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Content-Disposition')

        res.on('finish', () => {
            logger.info(`[${reqId}] Response ${res.statusCode}`)
        })

        if (req.method === 'OPTIONS') {
            if (reqOrigin && !isOriginAllowed(reqOrigin)) {
                return res.sendStatus(403)
            }
            return res.sendStatus(200)
        }
        next()
    })

    // Global body parsers for all REST endpoints
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    // REST API /stream endpoint (mendukung user JID presence tracking via stream token)
    app.get('/stream', (req, res) => {
        const tokenStr = req.query.token

        // Exceptions check (Bypass token validation for web dashboard, local dev, Discord bot, and Android APK players)
        const remoteIp = req.socket.remoteAddress || ''
        const isLocal = remoteIp.includes('127.0.0.1') || remoteIp === '::1' || remoteIp.includes('localhost')

        const referer = (req.headers['referer'] || '').toLowerCase()
        const isRefererValid = referer && (
            referer.includes('/radio') ||
            referer.includes('/dashboard') ||
            referer.includes('ronnproject') ||
            referer.includes('localhost') ||
            referer.includes(':5173')
        )

        const hasCacheBuster = req.query.t !== undefined || req.query.web !== undefined || req.query.stream !== undefined

        const incomingUa = req.headers['user-agent'] || ''
        const incomingNormalized = normalizeUserAgent(incomingUa)
        const isAndroidPlayer = incomingNormalized === 'android-radio-client'

        // Web browsers and direct media requests bypass token requirement
        const isMediaRequest = req.headers['accept']?.includes('audio') || req.headers['accept']?.includes('*/*')
        const shouldBypass = isLocal || isRefererValid || hasCacheBuster || isAndroidPlayer || !tokenStr

        let userId = 'anonymous'

        if (shouldBypass && !tokenStr) {
            // Retrieve JID from query if available during bypass (e.g. from APK or browser testing)
            const queryJid = req.query.jid
            if (queryJid && typeof queryJid === 'string' && queryJid.includes('@')) {
                userId = queryJid
            }
            logger.info(`[Stream/Auth] Connection bypassed. RemoteIP: ${remoteIp}, Referer: ${referer}, UA: ${incomingUa}, JID: ${userId}`)
        } else {
            // Strict token enforcement
            if (!tokenStr) {
                logger.warn(`[Stream/Auth] Connection rejected: Missing token. RemoteIP: ${remoteIp}, Referer: ${referer}, UA: ${incomingUa}`)
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Token stream diperlukan.'
                    }
                })
            }

            const tokenObj = streamTokens.get(tokenStr)
            if (!tokenObj || tokenObj.consumed || tokenObj.expiresAt < Date.now()) {
                logger.warn(`[Stream/Auth] Connection rejected: Invalid, consumed, or expired token (${tokenStr})`)
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Token stream tidak valid, kedaluwarsa, atau sudah digunakan.'
                    }
                })
            }

            // Validate UA Hash
            const incomingUaHash = crypto.createHash('sha256').update(incomingNormalized).digest('hex')
            if (incomingUaHash !== tokenObj.userAgentHash) {
                logger.warn(`[Stream/Security] ALERT: User-Agent hash mismatch for token. Expected: ${tokenObj.userAgentHash}, got: ${incomingUaHash} (Raw UA: ${incomingUa})`)
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Akses ditolak: User-Agent tidak cocok.'
                    }
                })
            }

            // Soft IP validation
            userId = tokenObj.userId
            const currentIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
            const connState = userConnections.get(userId)

            if (connState) {
                if (currentIp !== connState.lastIp) {
                    if (incomingUaHash !== connState.lastUaHash) {
                        logger.error(`[Stream/Security] ALERT: Session mismatch for user ${userId}. IP and UA both changed. IP: ${connState.lastIp} -> ${currentIp}, UA: ${connState.lastUaHash} -> ${incomingUaHash}`)
                        return res.status(403).json({
                            success: false,
                            error: {
                                code: 'FORBIDDEN',
                                message: 'Akses ditolak: Ketidakcocokan sesi terdeteksi.'
                            }
                        })
                    }

                    // IP changed, but UA is valid (INFO / WARN)
                    const now = Date.now()
                    if (now - connState.lastIpChangeTime < 300000) {
                        connState.ipChangeCount++
                        if (connState.ipChangeCount > 3) {
                            logger.warn(`[Stream/Security] WARN: User ${userId} IP changed rapidly (${connState.ipChangeCount} times in <5 min). IP: ${connState.lastIp} -> ${currentIp}`)
                        } else {
                            logger.info(`[Stream/Security] INFO: User ${userId} IP changed from ${connState.lastIp} to ${currentIp} (roaming/NAT)`)
                        }
                    } else {
                        connState.ipChangeCount = 1
                        connState.lastIpChangeTime = now
                        logger.info(`[Stream/Security] INFO: User ${userId} IP changed from ${connState.lastIp} to ${currentIp} (roaming/NAT)`)
                    }
                    connState.lastIp = currentIp
                }
            } else {
                userConnections.set(userId, {
                    lastIp: currentIp,
                    lastUaHash: incomingUaHash,
                    ipChangeCount: 0,
                    lastIpChangeTime: Date.now()
                })
            }

            // Consume the token
            tokenObj.consumed = true
            streamTokens.delete(tokenStr) // delete immediately to enforce one-time use
        }

        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache, no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'icy-name': process.env.BOT_NAME ?? 'RonnBot Radio',
            'icy-br': '128',
        })
        res.flushHeaders()

        radioService.addClient(res, userId)

        if (!radioService.isPlaying && radioService.queue.length > 0) {
            radioService.start().catch(err => logger.error('[Radio] Auto-start error:', err.message))
        }
    })

    app.options('/stream', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.status(204).end()
    })

    // ─────────────────────────────────────────────
    // REST API V2 ROUTER
    // ─────────────────────────────────────────────
    const apiV2 = express.Router()
    app.use('/api/v2', apiV2)

    apiV2.use(express.json())
    apiV2.use((req, res, next) => {
        res.setHeader('Content-Type', 'application/json')
        next()
    })

    // Mount modular routes
    apiV2.use('/auth', authRouter)
    apiV2.use('/control', controlRouter)
    apiV2.use('/suno', sunoRouter)
    apiV2.use('/', systemRouter)
    apiV2.use('/', lyricsRouter)
    apiV2.use('/', usersRouter)

    // Mount system router directly on /api and root for healthcheck & logs access
    app.use('/api', systemRouter)
    app.use('/', systemRouter)

    // Mount music router at the root since it contains both legacy /api/music and new /api/v2/music routes
    app.use('/', musicRouter)

    // REST API /status endpoint
    app.get('/status', (req, res) => {
        res.json(getFullStatus())
    })

    // Canonical /healthz endpoint (ping routes are handled deterministically by systemRouter)
    app.get('/healthz', (req, res) => {
        const mem = process.memoryUsage()
        const rssMB = Math.round(mem.rss / 1024 / 1024)
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024)
        const sock = getSocket()

        let sqliteOk = false
        try {
            if (db) {
                db.prepare('SELECT 1').get()
                sqliteOk = true
            }
        } catch {
            sqliteOk = false
        }

        res.json({
            status: sqliteOk ? 'ok' : 'degraded',
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now(),
            memory: {
                rssMB,
                heapUsedMB,
                heapTotalMB
            },
            whatsapp: {
                connected: Boolean(sock?.user),
                state: currentBotStatus
            },
            database: {
                sqlite: sqliteOk ? 'ok' : 'error'
            }
        })
    })

    function buildReadinessSnapshot() {
        let sqliteOk = false
        try {
            if (db) {
                db.prepare('SELECT 1').get()
                sqliteOk = true
            }
        } catch {
            sqliteOk = false
        }

        const leaseHealthy = isRuntimeLeaseHealthy()
        let secretsConfigured = false
        try {
            getControlJwtSecret()
            getRadioJwtSecret()
            secretsConfigured = true
        } catch {
            secretsConfigured = false
        }

        const sock = getSocket()
        const waConnected = Boolean(sock?.user) || currentBotStatus === 'open'
        const mem = process.memoryUsage()
        const coreOk = sqliteOk && leaseHealthy && secretsConfigured
        const overallStatus = !coreOk ? 'unhealthy' : waConnected ? 'healthy' : 'degraded'

        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            checks: {
                sqlite: sqliteOk ? 'pass' : 'fail',
                runtimeSingleton: leaseHealthy ? 'pass' : 'fail',
                secrets: secretsConfigured ? 'pass' : 'fail',
                whatsapp: waConnected ? 'pass' : 'degraded',
                http: serverInstance?.listening ? 'pass' : 'fail',
                socket: io ? 'pass' : 'fail'
            },
            memory: {
                rssMB: Math.round(mem.rss / (1024 * 1024)),
                heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024))
            }
        }
    }

    lastSelfCheckSnapshot = buildReadinessSnapshot()
    if (selfMonitorInterval) clearInterval(selfMonitorInterval)
    selfMonitorInterval = setInterval(() => {
        try {
            lastSelfCheckSnapshot = buildReadinessSnapshot()
            if (lastSelfCheckSnapshot.status === 'unhealthy') {
                logger.error(`[SelfMonitor] Unhealthy dependency state: sqlite=${lastSelfCheckSnapshot.checks.sqlite}, lease=${lastSelfCheckSnapshot.checks.runtimeSingleton}`)
            }
        } catch (err) {
            logger.warn('[SelfMonitor] Snapshot failed:', err.message)
        }
    }, 60_000)
    selfMonitorInterval.unref?.()

    app.get('/readyz', (req, res) => {
        const snapshot = buildReadinessSnapshot()
        lastSelfCheckSnapshot = snapshot
        const httpStatus = snapshot.status === 'unhealthy' ? 503 : 200
        res.status(httpStatus).json(snapshot)
    })

    // REST API /queue endpoint
    app.get('/queue', (req, res) => {
        res.json({
            queue: getQueueData(),
            total: radioService.queue.length,
        })
    })

    // REST API /api/radio/queue and /api/radio/now-playing aliases for external dashboards (Vercel)
    app.get('/api/radio/status', (req, res) => {
        res.json({ success: true, data: getFullStatus() })
    })
    app.get('/api/radio/queue', (req, res) => {
        res.json({ success: true, data: { queue: getQueueData(), total: radioService.queue.length } })
    })
    app.get('/api/radio/history', (req, res) => {
        res.json({ success: true, data: { history: recentlyPlayed, total: recentlyPlayed.length } })
    })
    app.get('/api/bot/commands', authenticateControlJwt, requirePermission(PERMISSIONS.COMMANDS_READ), async (req, res) => {
        try {
            if (commands.size === 0) {
                await initializeRegistry()
            }
            const allCmds = getAllCommands()
            const cmdList = []
            for (const [name, cmd] of allCmds.entries()) {
                if (cmd.name === name) {
                    cmdList.push({
                        name: cmd.name.startsWith('.') ? cmd.name : `.${cmd.name}`,
                        category: cmd.category || 'general',
                        description: cmd.description || '',
                        aliases: (cmd.aliases || []).map(a => a.startsWith('.') ? a : `.${a}`),
                        usage: cmd.usage || `.${cmd.name}`,
                        permissions: cmd.permissions || ['user']
                    })
                }
            }
            res.json({ success: true, total: cmdList.length, data: cmdList })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    // REST API /api/groups endpoint (Protected)
    app.get(['/api/groups', '/groups'], authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUPS_READ), async (req, res) => {
        try {
            const list = await getGroupsList()
            res.json({ success: true, total: list.length, groups: list })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    // REST API Group actions (Protected + RBAC + Confirmation for broadcast/leave)
    app.post('/api/groups/:jid/toggle-ai', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUP_CONFIG), async (req, res) => {
        try {
            const { jid } = req.params
            const { enabled } = req.body || {}
            memoryService.setAiEnabled(jid, Boolean(enabled))
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'http:group:toggle_ai',
                target: jid,
                result: 'allowed',
                correlationId: req.id || null
            })
            res.json({ success: true, jid, ai_enabled: Boolean(enabled) })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    app.post('/api/groups/:jid/toggle-moderation', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUP_CONFIG), async (req, res) => {
        try {
            const { jid } = req.params
            const { enabled } = req.body || {}
            await moderatorService.setModerationEnabled(jid, Boolean(enabled))
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'http:group:toggle_moderation',
                target: jid,
                result: 'allowed',
                correlationId: req.id || null
            })
            res.json({ success: true, jid, mod_enabled: Boolean(enabled) })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    app.post('/api/groups/:jid/broadcast', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUP_BROADCAST), requireConfirmation, async (req, res) => {
        try {
            const { jid } = req.params
            const { text } = req.body || {}
            const sock = getSocket()
            if (!sock) return res.status(503).json({ success: false, error: 'WhatsApp socket offline' })
            let mentions = []
            try {
                const groupMeta = await sock.groupMetadata(jid)
                if (groupMeta?.participants) mentions = groupMeta.participants.map(p => p.id)
            } catch (_) { }
            await sock.sendMessage(jid, { text: `📢 *PENGUMUMAN DARI OWNER*\n\n${text}`, mentions })
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'http:group:broadcast',
                target: jid,
                result: 'allowed',
                correlationId: req.id || null
            })
            res.json({ success: true, jid })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    app.post('/api/groups/:jid/leave', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUP_LEAVE), requireConfirmation, async (req, res) => {
        try {
            const { jid } = req.params
            const sock = getSocket()
            if (!sock) return res.status(503).json({ success: false, error: 'WhatsApp socket offline' })
            try {
                await sock.sendMessage(jid, { text: '👋 *Bot pamit keluar dari grup ini.* Terima kasih!' })
            } catch (_) { }
            await sock.groupLeave(jid)
            delete avatarCache[jid]
            if (db) {
                try {
                    db.prepare('DELETE FROM chat_config WHERE chat_id = ?').run(jid)
                    db.prepare('DELETE FROM moderation_config WHERE chat_id = ?').run(jid)
                } catch (_) { }
            }
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'http:group:leave',
                target: jid,
                result: 'allowed',
                correlationId: req.id || null
            })
            res.json({ success: true, jid })
        } catch (err) {
            res.status(500).json({ success: false, error: safeErrorMessage(err) })
        }
    })

    // REST API /history endpoint
    app.get('/history', (req, res) => {
        res.json({
            history: recentlyPlayed,
            total: recentlyPlayed.length,
        })
    })

    // REST API /events (SSE) endpoint
    app.get('/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        })

        const lastEventIdStr = req.headers['last-event-id'] || req.query.lastEventId
        if (lastEventIdStr) {
            const lastId = parseInt(lastEventIdStr, 10)
            if (!isNaN(lastId)) {
                const missed = sseHistory.filter(e => e.id > lastId)
                for (const e of missed) {
                    const dataToSend = (typeof e.data === 'object' && e.data !== null)
                        ? (Array.isArray(e.data) ? e.data : { ...e.data, correlationId: e.correlationId })
                        : e.data
                    res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(dataToSend)}\n\n`)
                }
            }
        } else {
            res.write(`id: ${sseEventCounter - 1}\nevent: init\ndata: ${JSON.stringify(getFullStatus())}\n\n`)
        }

        sseClients.add(res)

        const heartbeat = setInterval(() => {
            if (res.destroyed || !res.writable) {
                clearInterval(heartbeat)
                sseClients.delete(res)
                return
            }
            res.write(`: heartbeat\n\n`)
        }, 30000)

        const cleanup = () => {
            clearInterval(heartbeat)
            sseClients.delete(res)
        }
        res.on('close', cleanup)
        res.on('error', cleanup)
    })

    // QR Code & Pairing Code Web Endpoint (Protected: Admin/Owner only + Audited)
    app.get(['/qr', '/pairing', '/code'], authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_PAIRING_READ), async (req, res) => {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'whatsapp:pairing:view',
            target: req.path,
            result: 'allowed',
            correlationId: req.id || null
        })
        if (currentPairingCode) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>WhatsApp Bot Pairing Code</title>
                </head>
                <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:20px;box-sizing:border-box;">
                    <div style="background:#1e293b;padding:32px;border-radius:16px;max-width:440px;width:100%;text-align:center;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);border:1px solid #334155;">
                        <div style="font-size:36px;margin-bottom:12px;">🔗</div>
                        <h2 style="margin:0 0 8px 0;font-size:22px;">WhatsApp Pairing Code</h2>
                        <p style="color:#94a3b8;font-size:14px;margin:0 0 24px 0;">Buka WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat &gt; Tautkan dengan nomor telepon</p>
                        <div style="background:#0f172a;border:2px dashed #38bdf8;padding:16px;border-radius:12px;margin-bottom:20px;">
                            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:#38bdf8;">${currentPairingCode}</span>
                        </div>
                        <p style="color:#64748b;font-size:12px;margin:0;">Kode ini berlaku ~60 detik. Refresh jika expired.</p>
                        <p style="margin-top:20px;margin-bottom:0;"><a href="/api/system/app.log" style="color:#38bdf8;text-decoration:none;font-size:13px;">📄 Lihat Server Logs</a></p>
                    </div>
                </body>
                </html>
            `)
        }

        if (currentQrCode) {
            try {
                const dataUrl = await qrcode.toDataURL(currentQrCode)
                return res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <title>Scan WhatsApp QR</title>
                    </head>
                    <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:20px;box-sizing:border-box;">
                        <div style="background:#1e293b;padding:32px;border-radius:16px;max-width:400px;width:100%;text-align:center;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);border:1px solid #334155;">
                            <div style="font-size:36px;margin-bottom:12px;">📱</div>
                            <h2 style="margin:0 0 8px 0;font-size:22px;">Scan WhatsApp QR</h2>
                            <p style="color:#94a3b8;font-size:14px;margin:0 0 20px 0;">Buka WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat</p>
                            <img src="${dataUrl}" style="background:white;padding:16px;border-radius:12px;width:240px;height:240px;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:block;margin:0 auto;"/>
                            <p style="color:#64748b;font-size:12px;margin-top:20px;margin-bottom:0;">Refresh halaman jika QR code kadaluarsa.</p>
                            <p style="margin-top:16px;margin-bottom:0;"><a href="/api/system/app.log" style="color:#38bdf8;text-decoration:none;font-size:13px;">📄 Lihat Server Logs</a></p>
                        </div>
                    </body>
                    </html>
                `)
            } catch (err) {
                return res.status(500).send('Error generating QR code')
            }
        }

        return res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Status Bot WhatsApp</title>
            </head>
            <body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;margin:0;padding:20px;box-sizing:border-box;">
                <div style="background:#1e293b;padding:32px;border-radius:16px;max-width:400px;width:100%;text-align:center;border:1px solid #334155;">
                    <div style="font-size:36px;margin-bottom:12px;">${currentBotStatus === 'open' ? '✅' : '⏳'}</div>
                    <h2 style="margin:0 0 8px 0;font-size:20px;">${currentBotStatus === 'open' ? 'Bot WhatsApp Terhubung!' : 'Menunggu Sesi WhatsApp...'}</h2>
                    <p style="color:#94a3b8;font-size:14px;margin:0;">Status saat ini: <strong>${currentBotStatus}</strong></p>
                    <p style="margin-top:16px;"><a href="/api/system/app.log" style="color:#38bdf8;text-decoration:none;">📄 Lihat Live Log Server</a></p>
                </div>
            </body>
            </html>
        `)
    })

    // Locate static build out directories (if any custom build exists)
    const dashboardDir = path.resolve('./dashboard/out')
    const radioDashboardDir = path.resolve('./dashboard/out')

    if (fs.existsSync(dashboardDir)) {
        logger.info(`[Radio] Serving BotOS Dashboard static files from: ${dashboardDir}`)
        app.use('/dashboard', express.static(dashboardDir))
        app.use('/radio', express.static(dashboardDir))
    }

    // Fallback client route paths
    app.use((req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = req.path
        if (url === '/stream' || url === '/status' || url === '/queue' || url === '/history' || url === '/events' || url.startsWith('/api/')) {
            return next()
        }

        // Root & dashboard placeholder while redesign is in progress
        if (url === '/' || url.startsWith('/dashboard') || url.startsWith('/radio') || url === '/sunoautomation' || url === '/music') {
            // Serve static index if exists
            const activeDir = url.startsWith('/radio') ? radioDashboardDir : dashboardDir
            const indexPath = path.join(activeDir, 'index.html')
            if (fs.existsSync(indexPath)) {
                return res.sendFile(indexPath)
            }

            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>BotOS v6 — Modern Node</title>
                    <style>
                        body { background: #090a0f; color: #f3f4f6; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 2rem 2.5rem; border-radius: 1rem; text-align: center; max-width: 480px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                        .badge { display: inline-block; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 1rem; }
                        h1 { font-size: 1.5rem; margin: 0 0 0.5rem; font-weight: 700; letter-spacing: -0.025em; }
                        p { color: #9ca3af; font-size: 0.9rem; line-height: 1.5; margin: 0 0 1.5rem; }
                        .links { display: flex; gap: 0.75rem; justify-content: center; }
                        a { color: #38bdf8; text-decoration: none; font-size: 0.85rem; border: 1px solid rgba(56,189,248,0.2); padding: 0.4rem 0.8rem; border-radius: 0.5rem; transition: all 0.2s; }
                        a:hover { background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.5); }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="badge">● ONLINE & ACTIVE</div>
                        <h1>BotOS v6 Core Node</h1>
                        <p>Autonomous WhatsApp Bot & Media Processing Engine is operational. New modern dashboard redesign is in development.</p>
                        <div class="links">
                            <a href="/api/system/ping">Health Check</a>
                            <a href="/stream">Audio Stream</a>
                            <a href="/status">Bot Status</a>
                        </div>
                    </div>
                </body>
                </html>
            `)
        }

        res.status(404).send('Not found')
    })

    const listenPort = options.port !== undefined ? options.port : RADIO_PORT
    const listenHost = options.host !== undefined ? options.host : appConfig.host
    const displayHost = process.env.RADIO_HOST || 'localhost'
    serverInstance.listen(listenPort, listenHost, () => {
        const addr = serverInstance.address()
        const activePort = typeof addr === 'object' && addr ? addr.port : listenPort
        logger.info(`[Radio] HTTP Express Server active on ${listenHost}:${activePort}`)
        if (options.port === undefined) {
            console.log(`📻 [Radio] BotOS Dashboard active: http://${displayHost}:${activePort}/dashboard`)
            console.log(`📻 [Radio] Radio Dashboard active: http://${displayHost}:${activePort}/radio`)
            console.log(`📻 [Radio] Audio Stream URL: http://${displayHost}:${activePort}/stream`)
        }
    })

    serverInstance.on('error', (err) => {
        logger.error('[Radio] Server startup failed:', err.message)
    })

    return { app, server: serverInstance, io }
}

export function stopRadioServer() {
    if (tokenCleanupInterval) {
        clearInterval(tokenCleanupInterval)
        tokenCleanupInterval = null
    }
    if (metricsInterval) {
        clearInterval(metricsInterval)
        metricsInterval = null
    }
    if (analyticsInterval) {
        clearInterval(analyticsInterval)
        analyticsInterval = null
    }
    if (archiverInterval) {
        clearInterval(archiverInterval)
        archiverInterval = null
    }
    if (selfMonitorInterval) {
        clearInterval(selfMonitorInterval)
        selfMonitorInterval = null
    }
    lastSelfCheckSnapshot = null

    if (logListenerCallback) {
        removeLogListener(logListenerCallback)
        logListenerCallback = null
    }
    if (messageListenerCallback) {
        removeMessageListener(messageListenerCallback)
        messageListenerCallback = null
    }

    // Close all SSE connections
    for (const client of sseClients) {
        try { client.end() } catch (_) { }
    }
    sseClients.clear()
    sseHistory.length = 0

    streamTokens.clear()
    userConnections.clear()

    if (io) {
        io.close()
        io = null
    }
    controlNs = null

    if (serverInstance) {
        serverInstance.close()
        serverInstance = null
    }
}