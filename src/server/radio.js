// src/server/radio.js
// Express & Socket.IO Server serving real-time BotOS Dashboard & radio stream
import express from 'express'
import multer from 'multer'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import crypto from 'crypto'

import { radioService } from '../services/radio.js'
import { logger, addLogListener, removeLogListener, addMessageListener, removeMessageListener, getSocket, getLogHistory } from '../utils/logger.js'
import { metricsService } from '../services/metrics.js'
import { commands } from '../core/loader.js'
import { memoryService } from '../services/memory.js'
import { moderatorService } from '../services/moderator.js'
import { eventBus } from '../events/bus.js'
import { userService } from '../services/user-v2.js'
import { chatService } from '../services/chat-v2.js'
import { mediaService } from '../services/media.js'
import { prisma } from '../config/database.js'
import { BRAINS } from '../services/ai.js'
import { startSunoPipeline, getActiveJobs } from '../services/suno.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const JWT_SECRET = process.env.JWT_SECRET || 'ronnbot-default-jwt-secret-key-123456!'

function verifyJwt(token) {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const [headerB64, payloadB64, signatureB64] = parts

        const hmac = crypto.createHmac('sha256', JWT_SECRET)
        hmac.update(`${headerB64}.${payloadB64}`)
        const expectedSignature = hmac.digest('base64url')

        if (signatureB64 !== expectedSignature) {
            return null
        }

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null
        }
        return payload
    } catch (_) {
        return null
    }
}

function normalizeUserAgent(ua) {
    const lower = (ua || '').toLowerCase().trim()
    // Normalize Android clients, players, and okhttp libraries to a single standard string
    if (lower.includes('android') || lower.includes('dalvik') || lower.includes('exoplayer') || lower.includes('stagefright') || lower.includes('okhttp')) {
        return 'android-radio-client'
    }
    // Normalize iOS clients
    if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod') || lower.includes('cfnetwork')) {
        return 'ios-radio-client'
    }
    return lower
}

function authenticateJwt(req, res, next) {
    const isDev = process.env.NODE_ENV !== 'production'
    const bypassEnabled = process.env.DEV_BYPASS_AUTH === 'true'

    if (isDev && bypassEnabled) {
        const testJid = req.headers['x-test-jid'] || req.query.jid || '6285172013920@s.whatsapp.net'
        req.user = {
            jid: String(testJid),
            name: String(testJid).split('@')[0],
            role: 'owner'
        }
        return next()
    }

    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Header otentikasi tidak lengkap atau tidak valid.'
            }
        })
    }

    const token = authHeader.substring(7)
    const payload = verifyJwt(token)
    if (!payload || !payload.jid) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Token otentikasi tidak valid atau sudah kadaluwarsa.'
            }
        })
    }

    req.user = {
        jid: payload.jid,
        name: payload.name || payload.jid.split('@')[0],
        role: payload.role || 'user'
    }
    next()
}

const RADIO_PORT = parseInt(process.env.RADIO_PORT ?? '25637')
const MAX_HISTORY = 20

let server = null
let serverInstance = null
let io = null
let metricsInterval = null
let analyticsInterval = null
let tokenCleanupInterval = null
let archiverInterval = null
const streamTokens = new Map()
const userConnections = new Map()
const sseHistory = []
let sseEventCounter = 1

// Connection status cache
let currentBotStatus = 'connecting'
let currentQrCode = null

// Recently played history
const recentlyPlayed = []

// DB connection
const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
let db = null

try {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    
    // Ensure users table exists
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            name TEXT,
            commands_count INTEGER NOT NULL DEFAULT 0,
            warnings INTEGER NOT NULL DEFAULT 0,
            role TEXT DEFAULT 'user',
            last_seen INTEGER
        );
    `)

    // Safe migration to append commands_count to existing database tables
    try {
        db.exec(`ALTER TABLE users ADD COLUMN commands_count INTEGER NOT NULL DEFAULT 0`)
    } catch (_) {}
} catch (e) {
    logger.error('[Radio/DB] Failed to initialize SQLite connection:', e.message)
}

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

function resolveSongId(songId) {
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
        let memberCount = meta?.participants?.length || Math.floor(Math.random() * 45) + 5
        
        let avatarUrl = avatarCache[jid] || ''
        if (!avatarUrl && sock && sock.profilePictureUrl) {
            try {
                avatarUrl = await sock.profilePictureUrl(jid, 'image')
                avatarCache[jid] = avatarUrl
            } catch (_) {
                avatarCache[jid] = '' // Cache empty string on failure to prevent repeated API calls
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
        if (rows.length === 0) {
            // Fallback mock users using command usage
            return [
                { jid: '6285172013920@s.whatsapp.net', name: 'Ronn Anakibu', commandsCount: 154, warnings: 0, role: 'owner', lastSeen: Date.now() },
                { jid: '628222222222@s.whatsapp.net', name: 'Testing Account', commandsCount: 42, warnings: 2, lastSeen: Date.now() - 3600000 }
            ]
        }
        return rows.map(r => ({
            jid: r.jid,
            name: r.name || r.jid.split('@')[0],
            commandsCount: r.commands_count || r.xp || 0,
            warnings: r.warnings,
            role: r.role || 'user',
            lastSeen: r.last_seen || Date.now()
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
            usageCount: Math.floor(Math.random() * 150) + 8
        })
    }
    return list
}

function addToHistory(track) {
    recentlyPlayed.unshift({
        title: track.title,
        url: track.url,
        duration: track.duration,
        durationFormatted: track.durationFormatted,
        thumbnail: track.thumbnail,
        requestedBy: track.requestedBy,
        playedAt: Date.now(),
    })
    if (recentlyPlayed.length > MAX_HISTORY) recentlyPlayed.pop()
}

// SSE CLIENT MANAGEMENT
const sseClients = new Set()

function broadcastSSE(event, data, correlationId = null) {
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
        url: track.url,
        duration: track.duration,
        durationFormatted: track.durationFormatted,
        thumbnail: track.thumbnail,
        requestedBy: track.requestedBy,
    }))
}

function getFullStatus() {
    const track = radioService.currentTrack
    return {
        isPlaying: radioService.isPlaying,
        listeners: radioService.listenerCount,
        nowPlaying: track ? {
            title: track.title,
            url: track.url,
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            requestedBy: track.requestedBy,
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
            url: track.url,
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            requestedBy: track.requestedBy,
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

export function updateBotStatus(state, qr = null) {
    currentBotStatus = state
    currentQrCode = qr
    
    // Broadcast status to Socket.IO & SSE
    io?.emit('status:change', { state, qr })
    broadcastSSE('status:change', { state, qr })

    // If bot becomes online/open, broadcast updated lists after dynamic sync stabilizes
    if (state === 'open') {
        setTimeout(async () => {
            try {
                const groups = await getGroupsList()
                io?.emit('groups:update', groups)
                const users = getUsersList()
                io?.emit('users:update', users)
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

export function startRadioServer() {
    if (serverInstance) return

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

    setupRadioBroadcasts()

    const app = express()
    serverInstance = createServer(app)
    io = new SocketServer(serverInstance, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    })

    // Subscribe to Suno Status updates and broadcast via Socket.IO
    eventBus.subscribe('suno:status', (job) => {
        io?.emit('suno:status', job)
    })

    // --- V2 Socket.IO Namespaces ---
    const chatNamespace = io.of('/chat')
    const presenceNamespace = io.of('/presence')
    const songReactionsNamespace = io.of('/song-reactions')

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

        socket.on('chat:send_message', async (data) => {
            if (!data.content || data.content.trim() === '') return
            try {
                const decoded = verifyJwt(data.token)
                if (!decoded) {
                    socket.emit('error', 'Sesi tidak valid.')
                    return
                }
                await chatService.sendMessage(decoded.jid, data.content)
            } catch (err) {
                socket.emit('error', err.message)
            }
        })

        socket.on('chat:add_reaction', async (data) => {
            try {
                const decoded = verifyJwt(data.token)
                if (!decoded) return
                await chatService.addReaction(data.messageId, decoded.jid, data.reaction)
                chatNamespace.emit('chat:reactions_update', {
                    messageId: data.messageId,
                    reaction: data.reaction,
                    userId: decoded.jid
                })
            } catch (err) {
                // ignore
            }
        })
    })

    presenceNamespace.on('connection', (socket) => {
        logger.info(`[Socket/Presence] Client connected: ${socket.id}`)

        socket.on('presence:change', async (data) => {
            try {
                const decoded = verifyJwt(data.token)
                if (!decoded) return
                await userRepository.updateUserPresence(decoded.jid, data.status)
                presenceNamespace.emit('presence:listeners_update', {
                    userId: decoded.jid,
                    status: data.status,
                    timestamp: Date.now()
                })
            } catch (err) {
                // ignore
            }
        })
    })

    songReactionsNamespace.on('connection', (socket) => {
        logger.info(`[Socket/SongReactions] Client connected: ${socket.id}`)

        socket.on('song:react', (data) => {
            songReactionsNamespace.emit('song:reactions_sync', {
                songId: data.songId,
                reaction: data.reaction,
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
            .catch((err) => logger.error('[Scheduler] Failed to archive logs:', err.message))
    }, ONE_DAY_MS)

    // Setup periodic metrics broadcasts
    metricsInterval = setInterval(() => {
        const sysMetrics = metricsService.getSystemMetrics()
        broadcastSSE('metrics', sysMetrics)
        io?.emit('metrics', {
            cpuUsage: sysMetrics.cpuUsage,
            memoryUsage: sysMetrics.memoryUsed,
            totalMemory: sysMetrics.memoryTotal,
            messagesToday: metricsService.getAnalyticsData().commandsToday * 4 + 10 // Mock scale
        })
    }, 3000)

    analyticsInterval = setInterval(() => {
        const anaData = metricsService.getAnalyticsData()
        broadcastSSE('analytics', anaData)
        io?.emit('analytics', {
            hourlyMessageVolume: [10, 15, 8, 22, 35, 14, 18], // mock chart distribution
            commandUsage: anaData.topCommands,
            aiCalls: [
                { provider: 'groq', count: 12 },
                { provider: 'gemini', count: 8 },
                { provider: 'nvidia', count: 5 }
            ]
        })
    }, 10000)

    // Hook logger listeners
    logListenerCallback = (text) => {
        io?.emit('log', text)
    }
    messageListenerCallback = (msg) => {
        io?.emit('message', msg)
    }
    addLogListener(logListenerCallback)
    addMessageListener(messageListenerCallback)

    // Socket.IO core namespaces & connection management
    io.on('connection', async (socket) => {
        logger.info(`[Dashboard] Client connected: ${socket.id}`)

        try {
            const groups = await getGroupsList()
            const users = getUsersList()

            // Send initialization package
            socket.emit('init', {
                status: { state: currentBotStatus, qr: currentQrCode },
                uptime: Math.floor(process.uptime()),
                metrics: {
                    cpuUsage: metricsService.getSystemMetrics().cpuUsage,
                    memoryUsage: metricsService.getSystemMetrics().memoryUsed,
                    totalMemory: metricsService.getSystemMetrics().memoryTotal,
                    messagesToday: metricsService.getAnalyticsData().downloadsToday * 6 + 15,
                    commandsExecuted: metricsService.getAnalyticsData().commandsToday,
                    aiRequests: Math.floor(metricsService.getAnalyticsData().commandsToday * 0.4),
                    downloads: metricsService.getAnalyticsData().downloadsToday,
                    activeUsers: users.length,
                    activeGroups: groups.length,
                    dbSize: getDbSize()
                },
                analytics: {
                    hourlyMessageVolume: [2, 5, 1, 8, 12, 16, 9, 14, 11, 23, 19, 21, 28, 30, 24, 18, 15, 12, 9, 6, 4, 3, 2, 1],
                    commandUsage: metricsService.getAnalyticsData().topCommands,
                    aiCalls: [
                        { provider: 'groq', count: 24 },
                        { provider: 'gemini', count: 18 },
                        { provider: 'nvidia', count: 10 }
                    ]
                },
                commands: getCommandsList(),
                groups: groups,
                users: users,
                logs: getLogHistory(),
                dbTables: getTableNames(),
                sunoJobs: getActiveJobs(),
                ai: {
                    providers: Object.entries(BRAINS).map(([key, brain]) => {
                        let active = false
                        if (brain.provider === 'nvidia' && process.env.NVIDIA_API_KEY) active = true
                        else if (brain.provider === 'groq' && process.env.GROQ_API_KEY) active = true
                        else if (brain.provider === 'gemini' && process.env.GEMINI_API_KEY) active = true

                        return {
                            name: key,
                            displayName: brain.name,
                            active,
                            ping: active ? Math.floor(Math.random() * 50) + 15 : 0,
                            model: brain.model,
                            status: active ? 'healthy' : 'offline'
                        }
                    }),
                    fallbackChain: ['nvidia', 'groq', 'gemini']
                }
            })
        } catch (err) {
            logger.error('[Dashboard/Init] Error compiling client init payload:', err.message)
        }

        // Client triggers
        socket.on('suno:get_active', () => {
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
            const { prompt, title, enhance, model } = data
            if (!prompt) return socket.emit('error', 'Prompt tidak boleh kosong')
            logger.info(`[Socket/Suno] Triggering suno generation from socket: ${prompt}`)
            try {
                const jobId = await startSunoPipeline({ prompt, title, enhance, source: 'web', model })
                socket.emit('suno:started', { jobId })
            } catch (err) {
                socket.emit('error', `Gagal memulai generasi: ${err.message}`)
            }
        })

        socket.on('bot:restart', () => {
            logger.warn('[Dashboard] Process exit triggered by dashboard user.')
            process.exit(0)
        })

        socket.on('command:toggle', ({ name, enabled }) => {
            const cmd = commands.get(name)
            if (cmd) {
                cmd.enabled = enabled
                logger.info(`[Dashboard] Toggled command "${name}" -> ${enabled}`)
                io?.emit('commands:update', getCommandsList())
            }
        })

        socket.on('group:toggle_ai', async ({ chatId, enabled }) => {
            try {
                memoryService.setAiEnabled(chatId, enabled)
                logger.info(`[Dashboard] Toggled AI Chat for group "${chatId}" -> ${enabled}`)
                
                // Broadcast updated groups list to all connected clients
                const groups = await getGroupsList()
                io?.emit('groups:update', groups)
            } catch (err) {
                logger.error('[Dashboard/ToggleAI] Failed to toggle group AI:', err.message)
            }
        })

        socket.on('group:toggle_moderation', async ({ chatId, enabled }) => {
            try {
                await moderatorService.setModerationEnabled(chatId, enabled)
                logger.info(`[Dashboard] Toggled AI Moderation for group "${chatId}" -> ${enabled}`)
                
                // Broadcast updated groups list to all connected clients
                const groups = await getGroupsList()
                io?.emit('groups:update', groups)
            } catch (err) {
                logger.error('[Dashboard/ToggleMod] Failed to toggle group moderation:', err.message)
            }
        })

        socket.on('group:broadcast', async ({ chatId, text }) => {
            const sock = getSocket()
            if (!sock) {
                logger.error('[Dashboard/Broadcast] Failed: WhatsApp socket offline.')
                return
            }
            logger.info(`[Dashboard/Broadcast] Sending message to ${chatId}: "${text}"`)
            try {
                let mentions = []
                try {
                    const groupMeta = await sock.groupMetadata(chatId)
                    if (groupMeta && groupMeta.participants) {
                        mentions = groupMeta.participants.map(p => p.id)
                    }
                } catch (_) {}

                await sock.sendMessage(chatId, {
                    text: `📢 *PENGUMUMAN DARI OWNER*\n\n${text}`,
                    mentions
                })
            } catch (err) {
                logger.error(`[Dashboard/Broadcast] Failed to send message to ${chatId}:`, err.message)
            }
        })

        socket.on('db:query', ({ sql }) => {
            if (!db) {
                socket.emit('db:query_result', { success: false, error: 'Database connection offline.' })
                return
            }
            logger.info(`[Dashboard/DB] Executing query: "${sql}"`)
            try {
                const trimmed = sql.trim()
                const stmt = db.prepare(trimmed)
                
                // Use better-sqlite3 statement.reader property to identify SELECT and other read queries
                const isSelect = stmt.reader
                if (isSelect) {
                    const rows = stmt.all()
                    socket.emit('db:query_result', { success: true, isSelect: true, data: rows })
                } else {
                    const info = stmt.run()
                    socket.emit('db:query_result', { 
                        success: true, 
                        isSelect: false, 
                        data: {
                            changes: info.changes,
                            lastInsertRowid: info.lastInsertRowid
                        },
                        // Refresh table names just in case a table was created or dropped
                        dbTables: getTableNames()
                    })
                    // Also broadcast updated tables list to all connected clients if DDL/DML ran
                    io?.emit('db:tables_update', getTableNames())
                }
            } catch (err) {
                logger.error(`[Dashboard/DB] Query execution failed: "${sql}" - ${err.message}`)
                socket.emit('db:query_result', { success: false, error: err.message })
            }
        })

        socket.on('disconnect', () => {
            logger.info(`[Dashboard] Client disconnected: ${socket.id}`)
        })
    })

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

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Accept, Authorization, X-Request-ID')

        res.on('finish', () => {
            logger.info(`[${reqId}] Response ${res.statusCode}`)
        })

        if (req.method === 'OPTIONS') {
            return res.sendStatus(200)
        }
        next()
    })

    // REST API /stream endpoint (mendukung user JID presence tracking via stream token)
    app.get('/stream', (req, res) => {
        const tokenStr = req.query.token

        // Exceptions check (Bypass token validation for local Discord bot, internal web pages, and Android APK players)
        const remoteIp = req.socket.remoteAddress || ''
        const isLocal = remoteIp.includes('127.0.0.1') || remoteIp === '::1' || remoteIp.includes('localhost')

        const referer = req.headers['referer'] || ''
        const isRefererValid = referer && (referer.includes('/radio') || referer.includes('/dashboard'))

        const hasCacheBuster = req.query.t !== undefined

        const incomingUa = req.headers['user-agent'] || ''
        const incomingNormalized = normalizeUserAgent(incomingUa)
        const isAndroidPlayer = incomingNormalized === 'android-radio-client'

        const shouldBypass = isLocal || isRefererValid || hasCacheBuster || isAndroidPlayer

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
            'icy-name': process.env.BOT_NAME ?? 'RonnBot Radio',
            'icy-br': '128',
        })
        res.flushHeaders()

        radioService.addClient(res, userId)

        if (!radioService.isPlaying && radioService.queue.length > 0) {
            radioService.start().catch(err => logger.error('[Radio] Auto-start error:', err.message))
        }
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

    // AUTH / TOKEN ENDPOINTS
    apiV2.post('/auth/anonymous', async (req, res) => {
        try {
            const session = await userService.registerAnonymous()
            res.json({
                success: true,
                token: session.token,
                profile: {
                    id: session.user.id,
                    nickname: session.user.nickname,
                    avatarUrl: session.user.avatarUrl,
                    isGuest: true
                }
            })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })

    apiV2.post('/auth/register', authenticateJwt, async (req, res) => {
        const { username, password } = req.body
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username dan password wajib diisi.' })
        }
        try {
            const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
            await userService.claimAccount(req.user.jid, username, passwordHash)
            res.json({
                success: true,
                message: 'Akun berhasil didaftarkan.'
            })
        } catch (err) {
            res.status(400).json({ success: false, error: err.message })
        }
    })

    apiV2.post('/auth/stream-token', authenticateJwt, (req, res) => {
        const userId = req.user.jid
        const userAgent = req.headers['user-agent'] || ''
        const normalizedUa = normalizeUserAgent(userAgent)
        const userAgentHash = crypto.createHash('sha256').update(normalizedUa).digest('hex')
        const token = crypto.randomUUID()
        const createdAt = Date.now()
        const expiresAt = createdAt + 300000 // 5 minutes

        const tokenObj = {
            token,
            userId,
            userAgentHash,
            createdAt,
            expiresAt,
            consumed: false
        }

        streamTokens.set(token, tokenObj)

        res.json({
            success: true,
            data: {
                token,
                expiresAt
            }
        })
    })

    // SUNO AUTOMATION ENDPOINTS
    apiV2.post('/suno/generate', authenticateJwt, async (req, res) => {
        const { prompt, title, enhance } = req.body
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt wajib diisi.' })
        }
        try {
            const jobId = await startSunoPipeline({ prompt, title, enhance, source: 'api' })
            res.json({ success: true, jobId })
        } catch (err) {
            res.status(500).json({ success: false, error: err.message })
        }
    })

    apiV2.get('/suno/jobs', authenticateJwt, (req, res) => {
        res.json({ success: true, data: getActiveJobs() })
    })

    // SYSTEM RESTART Webhook (Bypasses Cloudflare Turnstile Panel protection)
    apiV2.post('/system/restart', (req, res) => {
        const authHeader = req.headers['authorization']
        const token = authHeader && authHeader.split(' ')[1]

        if (!token || token !== process.env.PTERO_API_KEY) {
            logger.error('[System/Restart] Unauthorized remote restart attempt blocked.')
            return res.status(401).json({ success: false, error: 'Unauthorized' })
        }

        res.json({ success: true, message: 'Restarting bot...' })

        logger.warn('[System/Restart] Remote restart triggered via deployment webhook.')
        setTimeout(() => {
            process.exit(0)
        }, 1000)
    })

    // MUSIC ENDPOINTS
    apiV2.get('/music/search', async (req, res) => {
        const { q } = req.query
        if (!q) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Parameter query "q" wajib diisi.'
                }
            })
        }
        try {
            const track = await radioService.search(q, 'API Search')
            res.json({
                success: true,
                data: {
                    results: [
                        {
                            songId: track.songId,
                            title: track.title,
                            artist: track.artist,
                            duration: track.duration,
                            thumbnailUrl: track.thumbnail,
                            source: track.source,
                            streamUrl: track.url
                        }
                    ]
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.post('/music/request', authenticateJwt, async (req, res) => {
        const { query, dedicatedTo, message } = req.body
        const userJid = req.user.jid
        if (!query) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Query/URL lagu wajib diisi.'
                }
            })
        }

        try {
            const track = await radioService.search(query, userJid)
            radioService.addToQueue(track, req.id)

            if (dedicatedTo) {
                try {
                    const lastReq = db.prepare('SELECT id FROM requests WHERE user_jid = ? AND song_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(userJid, track.songId)
                    if (lastReq) {
                        db.prepare('INSERT INTO dedications (request_id, dedicated_to, message) VALUES (?, ?, ?)')
                            .run(lastReq.id, dedicatedTo, message || null)
                    }
                } catch (dedErr) {
                    logger.error('[APIv2] Failed to save dedication:', dedErr.message)
                }
            }

            res.json({
                success: true,
                data: {
                    message: 'Lagu berhasil ditambahkan ke antrean!',
                    track: {
                        songId: track.songId,
                        title: track.title,
                        artist: track.artist,
                        duration: track.duration,
                        thumbnailUrl: track.thumbnail
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/music/queue', (req, res) => {
        const page = parseInt(req.query.page ?? '1')
        const limit = parseInt(req.query.limit ?? '10')
        const offset = (page - 1) * limit

        const rawQueue = radioService.queue
        const paginatedQueue = rawQueue.slice(offset, offset + limit).map((track, i) => {
            let dedication = null
            try {
                const reqRow = db.prepare('SELECT id FROM requests WHERE song_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(track.songId)
                if (reqRow) {
                    const dedRow = db.prepare('SELECT dedicated_to, message FROM dedications WHERE request_id = ?').get(reqRow.id)
                    if (dedRow) {
                        dedication = {
                            dedicatedTo: dedRow.dedicated_to,
                            message: dedRow.message
                        }
                    }
                }
            } catch (_) {}

            return {
                position: offset + i + 1,
                song: {
                    songId: track.songId,
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration,
                    thumbnailUrl: track.thumbnail
                },
                requestedBy: {
                    userId: track.requestedBy,
                    name: track.requestedBy ? track.requestedBy.split('@')[0] : 'Auto-DJ'
                },
                dedication
            }
        })

        res.json({
            success: true,
            data: {
                queue: paginatedQueue,
                totalItems: rawQueue.length,
                totalPages: Math.ceil(rawQueue.length / limit)
            }
        })
    })

    apiV2.get('/music/history', (req, res) => {
        const page = parseInt(req.query.page ?? '1')
        const limit = parseInt(req.query.limit ?? '10')
        const offset = (page - 1) * limit

        try {
            const totalItems = db.prepare('SELECT COUNT(*) as count FROM play_history').get().count
            const historyRows = db.prepare(`
                SELECT h.played_at, s.song_id, s.title, s.artist, s.thumbnail_url, s.duration, h.requested_by_jid
                FROM play_history h
                JOIN songs s ON h.song_id = s.song_id
                ORDER BY h.played_at DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset)

            const formattedHistory = historyRows.map(row => ({
                playedAt: row.played_at,
                song: {
                    songId: row.song_id,
                    title: row.title,
                    artist: row.artist,
                    duration: row.duration,
                    thumbnailUrl: row.thumbnail_url
                },
                requestedBy: row.requested_by_jid ? {
                    userId: row.requested_by_jid,
                    name: row.requested_by_jid.split('@')[0]
                } : null
            }))

            res.json({
                success: true,
                data: {
                    history: formattedHistory,
                    totalItems,
                    totalPages: Math.ceil(totalItems / limit)
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/music/now-playing', (req, res) => {
        const track = radioService.currentTrack
        if (!track) {
            return res.json({
                success: true,
                data: {
                    isPlaying: false,
                    currentTrack: null,
                    listeners: radioService.listenerCount
                }
            })
        }

        let dedication = null
        try {
            const reqRow = db.prepare("SELECT id FROM requests WHERE song_id = ? AND status = 'played' ORDER BY played_at DESC LIMIT 1").get(track.songId)
            if (reqRow) {
                const dedRow = db.prepare('SELECT dedicated_to, message FROM dedications WHERE request_id = ?').get(reqRow.id)
                if (dedRow) {
                    dedication = {
                        dedicatedTo: dedRow.dedicated_to,
                        message: dedRow.message
                    }
                }
            }
        } catch (_) {}

        res.json({
            success: true,
            data: {
                isPlaying: radioService.isPlaying,
                currentTrack: {
                    songId: track.songId,
                    title: track.title,
                    artist: track.artist,
                    duration: track.duration,
                    startedAt: track.addedAt,
                    elapsedTime: Math.min(track.duration, Math.floor((Date.now() - track.addedAt) / 1000)),
                    thumbnailUrl: track.thumbnail,
                    requestedBy: track.requestedBy ? {
                        userId: track.requestedBy,
                        name: track.requestedBy.split('@')[0]
                    } : null,
                    dedication
                },
                playbackSettings: {
                    fx: radioService.activeFx,
                    eq: radioService.activeEq
                },
                listeners: radioService.listenerCount
            }
        })
    })

    // LYRICS ENDPOINTS
    const mockLyrics = (title) => ({
        lyrics: [
            { time: 0, text: `[Musik - ${title}]` },
            { time: 10, text: "Kupikir kita akan bersama" },
            { time: 20, text: "Ternyata semua hanya bayang semata" },
            { time: 30, text: "Melangkah pergi tanpa kata" },
            { time: 40, text: "Meninggalkan luka yang mendalam..." },
            { time: 50, text: "[Guitar Solo]" },
            { time: 80, text: "Kini ku sendiri menatap bintang" },
            { time: 90, text: "Berharap kau kembali pulang..." },
            { time: 110, text: "[Chorus]" },
            { time: 130, text: "Terima kasih atas segalanya..." }
        ],
        synced: true
    })

    apiV2.get('/lyrics/current', (req, res) => {
        const track = radioService.currentTrack
        if (!track) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Tidak ada lagu yang sedang diputar.'
                }
            })
        }
        res.json({
            success: true,
            data: {
                songId: track.songId,
                title: track.title,
                ...mockLyrics(track.title)
            }
        })
    })

    apiV2.get('/lyrics/:songId', (req, res) => {
        const resolvedSongId = resolveSongId(req.params.songId)
        let title = 'Lagu Pilihan'
        try {
            const row = db.prepare('SELECT title FROM songs WHERE song_id = ?').get(resolvedSongId)
            if (row) title = row.title
        } catch (_) {}

        res.json({
            success: true,
            data: {
                songId: resolvedSongId,
                title,
                ...mockLyrics(title)
            }
        })
    })

    // ENGAGEMENT ENDPOINTS
    apiV2.post('/songs/:songId/reactions', authenticateJwt, (req, res) => {
        const { reaction } = req.body
        const resolvedSongId = resolveSongId(req.params.songId)
        const userJid = req.user.jid
        if (!reaction) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'Emoji reaksi wajib diisi.'
                }
            })
        }
        try {
            const songExists = db.prepare('SELECT 1 FROM songs WHERE song_id = ?').get(resolvedSongId)
            if (!songExists) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: 'Lagu tidak ditemukan di pustaka.'
                    }
                })
            }

            db.prepare('INSERT INTO reactions (user_jid, song_id, emoji) VALUES (?, ?, ?)').run(userJid, resolvedSongId, reaction)

            io?.emit('engagement:reaction', { songId: resolvedSongId, reaction, userJid })
            broadcastSSE('engagement:reaction', { songId: resolvedSongId, reaction, userJid }, req.id)

            res.json({
                success: true,
                data: {
                    message: 'Reaksi berhasil direkam!'
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.post('/users/me/favorites', authenticateJwt, (req, res) => {
        const resolvedSongId = resolveSongId(req.body.songId)
        const userJid = req.user.jid
        if (!resolvedSongId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'songId wajib diisi.'
                }
            })
        }
        try {
            db.prepare('INSERT INTO favorites (user_jid, song_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(userJid, resolvedSongId)
            
            // Broadcast favorite event to SSE
            broadcastSSE('engagement:favorite', { userJid, songId: resolvedSongId }, req.id)
            io?.emit('engagement:favorite', { userJid, songId: resolvedSongId })

            res.json({
                success: true,
                data: {
                    message: 'Lagu ditambahkan ke favorit!'
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.delete('/users/me/favorites/:songId', authenticateJwt, (req, res) => {
        const resolvedSongId = resolveSongId(req.params.songId)
        const userJid = req.user.jid
        try {
            db.prepare('DELETE FROM favorites WHERE user_jid = ? AND song_id = ?').run(userJid, resolvedSongId)
            res.json({
                success: true,
                data: {
                    message: 'Lagu dihapus dari favorit!'
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/users/me/favorites', authenticateJwt, (req, res) => {
        const userJid = req.user.jid
        try {
            const rows = db.prepare(`
                SELECT s.song_id, s.title, s.artist, s.thumbnail_url, s.duration, f.created_at
                FROM favorites f
                JOIN songs s ON f.song_id = s.song_id
                WHERE f.user_jid = ?
                ORDER BY f.created_at DESC
            `).all(userJid)
            res.json({
                success: true,
                data: {
                    favorites: rows.map(r => ({
                        songId: r.song_id,
                        title: r.title,
                        artist: r.artist,
                        thumbnailUrl: r.thumbnail_url,
                        duration: r.duration,
                        createdAt: r.created_at
                    }))
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    // USER PROFILING & STATS
    apiV2.get('/users/me/profile', authenticateJwt, async (req, res) => {
        const userJid = req.user.jid
        try {
            const profile = await userService.getProfile(userJid)
            if (!profile) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: 'Profil tidak ditemukan.'
                    }
                })
            }

            res.json({
                success: true,
                data: {
                    profile: {
                        userId: profile.id,
                        name: profile.nickname,
                        avatarUrl: profile.avatarUrl,
                        bannerUrl: profile.bannerUrl,
                        bio: profile.bio,
                        level: 1,
                        experiencePoints: profile.stats ? Number(profile.stats.listeningTimeMs) : 0,
                        role: 'user',
                        achievementsUnlocked: profile.stats ? profile.stats.achievementsEarned : 0,
                        topFavorites: []
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.put('/users/me/profile', authenticateJwt, async (req, res) => {
        const { nickname, bio, avatarUrl, bannerUrl } = req.body
        try {
            const updated = await userService.updateProfile(req.user.jid, {
                nickname,
                bio,
                avatarUrl,
                bannerUrl
            })
            res.json({
                success: true,
                profile: updated
            })
        } catch (err) {
            res.status(400).json({ success: false, error: err.message })
        }
    })

    apiV2.get('/users/:userJid/profile', async (req, res) => {
        const { userJid } = req.params
        try {
            const profile = await userService.getProfile(userJid)
            if (!profile) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'NOT_FOUND',
                        message: 'Profil tidak ditemukan.'
                    }
                })
            }

            res.json({
                success: true,
                data: {
                    profile: {
                        userId: profile.id,
                        name: profile.nickname,
                        avatarUrl: profile.avatarUrl,
                        bannerUrl: profile.bannerUrl,
                        bio: profile.bio,
                        level: 1,
                        experiencePoints: profile.stats ? Number(profile.stats.listeningTimeMs) : 0,
                        role: 'user',
                        achievementsUnlocked: profile.stats ? profile.stats.achievementsEarned : 0,
                        topFavorites: []
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })
    apiV2.get('/users/me/stats', authenticateJwt, async (req, res) => {
        const userJid = req.user.jid
        try {
            const stats = await prisma.userStats.findUnique({ where: { userId: userJid } })
            const totalListenSec = stats ? Number(stats.listeningTimeMs / 1000n) : 0
            const requestsCount = stats ? stats.songsRequested : 0

            res.json({
                success: true,
                data: {
                    stats: {
                        totalListeningHours: parseFloat((totalListenSec / 3600).toFixed(2)),
                        totalRequestsCount: requestsCount,
                        favoriteArtist: '—',
                        favoriteSong: '—',
                        currentListeningStreak: 1,
                        longestListeningStreak: 3
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/users/:userJid/stats', async (req, res) => {
        const { userJid } = req.params
        try {
            const stats = await prisma.userStats.findUnique({ where: { userId: userJid } })
            const totalListenSec = stats ? Number(stats.listeningTimeMs / 1000n) : 0
            const requestsCount = stats ? stats.songsRequested : 0

            res.json({
                success: true,
                data: {
                    stats: {
                        totalListeningHours: parseFloat((totalListenSec / 3600).toFixed(2)),
                        totalRequestsCount: requestsCount,
                        favoriteArtist: '—',
                        favoriteSong: '—',
                        currentListeningStreak: 1,
                        longestListeningStreak: 3
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/leaderboard', async (req, res) => {
        const { timeframe } = req.query
        try {
            const rows = await prisma.userStats.findMany({
                orderBy: {
                    listeningTimeMs: 'desc'
                },
                take: 10,
                include: {
                    user: {
                        select: {
                            nickname: true
                        }
                    }
                }
            })

            const leaderboard = rows.map((row, idx) => ({
                rank: idx + 1,
                name: row.user.nickname,
                userId: row.userId,
                listeningTimeSeconds: Number(row.listeningTimeMs / 1000n),
                level: 1
            }))

            res.json({
                success: true,
                data: {
                    timeframe: timeframe || 'global',
                    leaderboard
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })
    apiV2.get('/achievements', (req, res) => {
        let userJid = req.query.userJid
        if (!userJid && req.headers['authorization']) {
            const authHeader = req.headers['authorization']
            if (authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7)
                const payload = verifyJwt(token)
                if (payload && payload.jid) {
                    userJid = payload.jid
                }
            }
        }
        try {
            const list = db.prepare('SELECT * FROM achievements').all()
            const unlocked = userJid ? new Set(
                db.prepare('SELECT achievement_id FROM achievement_unlocks WHERE user_jid = ?').all(userJid).map(r => r.achievement_id)
            ) : new Set()

            const formatted = list.map(ach => ({
                achievementId: ach.achievement_id,
                name: ach.name,
                description: ach.description,
                unlocked: unlocked.has(ach.achievement_id)
            }))

            res.json({
                success: true,
                data: {
                    achievements: formatted
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    apiV2.get('/wrapped/:year', (req, res) => {
        const { year } = req.params
        let userJid = req.query.userJid
        if (!userJid && req.headers['authorization']) {
            const authHeader = req.headers['authorization']
            if (authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7)
                const payload = verifyJwt(token)
                if (payload && payload.jid) {
                    userJid = payload.jid
                }
            }
        }
        if (!userJid) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'BAD_REQUEST',
                    message: 'userJid wajib diisi.'
                }
            })
        }

        try {
            let cached = db.prepare('SELECT * FROM wrapped WHERE user_jid = ? AND year = ?').get(userJid, parseInt(year))

            if (!cached) {
                const totalListenSec = db.prepare('SELECT SUM(duration_seconds) as total FROM listening_sessions WHERE user_jid = ?').get(userJid)?.total || 0
                const totalReqs = db.prepare("SELECT COUNT(*) as count FROM requests WHERE user_jid = ? AND status = 'played'").get(userJid)?.count || 0

                const topArtistRow = db.prepare(`
                    SELECT s.artist, COUNT(*) as count
                    FROM play_history h
                    JOIN songs s ON h.song_id = s.song_id
                    WHERE h.requested_by_jid = ?
                    GROUP BY s.artist
                    ORDER BY count DESC
                    LIMIT 1
                `).get(userJid)

                const topSongRow = db.prepare(`
                    SELECT s.song_id, s.title, s.artist, COUNT(*) as count
                    FROM play_history h
                    JOIN songs s ON h.song_id = s.song_id
                    WHERE h.requested_by_jid = ?
                    GROUP BY s.song_id
                    ORDER BY count DESC
                    LIMIT 1
                `).get(userJid)

                cached = {
                    user_jid: userJid,
                    year: parseInt(year),
                    listening_seconds: totalListenSec,
                    total_requests: totalReqs,
                    favorite_artist: topArtistRow ? topArtistRow.artist : '—',
                    favorite_song_id: topSongRow ? topSongRow.song_id : null,
                    top_genre: 'Pop Indo',
                    percentile: 5.0
                }

                db.prepare(`
                    INSERT INTO wrapped (user_jid, year, listening_seconds, total_requests, favorite_artist, favorite_song_id, top_genre, percentile)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    cached.user_jid,
                    cached.year,
                    cached.listening_seconds,
                    cached.total_requests,
                    cached.favorite_artist,
                    cached.favorite_song_id,
                    cached.top_genre,
                    cached.percentile
                )
            }

            let favSong = null
            if (cached.favorite_song_id) {
                const sRow = db.prepare('SELECT title, artist FROM songs WHERE song_id = ?').get(cached.favorite_song_id)
                if (sRow) {
                    favSong = `${sRow.title} - ${sRow.artist}`
                }
            }

            res.json({
                success: true,
                data: {
                    wrapped: {
                        year: cached.year,
                        listeningHours: parseFloat((cached.listening_seconds / 3600).toFixed(1)),
                        songsPlayed: Math.round(cached.listening_seconds / 240),
                        favoriteArtist: cached.favorite_artist,
                        favoriteSong: favSong || '—',
                        topGenre: cached.top_genre,
                        totalRequests: cached.total_requests,
                        rankPercentile: cached.percentile,
                        achievementsUnlocked: db.prepare('SELECT COUNT(*) as count FROM achievement_unlocks WHERE user_jid = ?').get(userJid)?.count || 0
                    }
                }
            })
        } catch (err) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message
                }
            })
        }
    })

    // SYSTEM METRICS
    apiV2.get('/system/metrics', authenticateJwt, (req, res) => {
        res.json({
            success: true,
            data: {
                metrics: metricsService.getSystemMetrics()
            }
        })
    })

    // REST API /status endpoint
    app.get('/status', (req, res) => {
        res.json(getFullStatus())
    })

    // REST API /queue endpoint
    app.get('/queue', (req, res) => {
        res.json({
            queue: getQueueData(),
            total: radioService.queue.length,
        })
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

    // Locate static build out directories
    const dashboardDir = path.resolve('./src/app/dashboard/out')
    const radioDashboardDir = path.resolve('./dashboard/out')

    logger.info(`[Radio] Serving BotOS Dashboard static files from: ${dashboardDir}`)
    logger.info(`[Radio] Serving Radio Dashboard static files from: ${radioDashboardDir}`)
    
    app.use('/dashboard', express.static(dashboardDir))
    app.use('/radio', express.static(radioDashboardDir))

    // Fallback client route paths to support SPA client router
    app.use((req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = req.path
        if (url === '/stream' || url === '/status' || url === '/queue' || url === '/history' || url === '/events') {
            return next()
        }

        // Redirect root / to /dashboard
        if (url === '/') {
            return res.redirect('/dashboard')
        }

        // Redirect standalone /sunoautomation and /music to /dashboard/music
        if (url === '/sunoautomation' || url === '/music') {
            return res.redirect('/dashboard/music')
        }

        // Serve index.html or page-specific HTML for BotOS dashboard fallback routes
        if (url.startsWith('/dashboard') && !url.includes('/_next/') && !path.extname(url)) {
            const subPath = url.slice('/dashboard'.length) || '/'
            const filePath = path.join(dashboardDir, (subPath === '/' ? 'index' : subPath) + '.html')
            if (fs.existsSync(filePath)) {
                return res.sendFile(filePath)
            }
            const indexPath = path.join(dashboardDir, 'index.html')
            if (fs.existsSync(indexPath)) {
                return res.sendFile(indexPath)
            }
        }

        // Serve index.html for Radio dashboard fallback routes
        if (url.startsWith('/radio') && !url.includes('/_next/') && !path.extname(url)) {
            const indexPath = path.join(radioDashboardDir, 'index.html')
            if (fs.existsSync(indexPath)) {
                return res.sendFile(indexPath)
            }
        }

        res.status(404).send('Not found')
    })

    serverInstance.listen(RADIO_PORT, () => {
        logger.info(`[Radio] HTTP Express Server active on port ${RADIO_PORT}`)
        console.log(`📻 [Radio] BotOS Dashboard active: http://localhost:${RADIO_PORT}/dashboard`)
        console.log(`📻 [Radio] Radio Dashboard active: http://localhost:${RADIO_PORT}/radio`)
        console.log(`📻 [Radio] Audio Stream URL: http://localhost:${RADIO_PORT}/stream`)
    })

    serverInstance.on('error', (err) => {
        logger.error('[Radio] Server startup failed:', err.message)
    })
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
        try { client.end() } catch (_) {}
    }
    sseClients.clear()
    sseHistory.length = 0

    streamTokens.clear()
    userConnections.clear()

    if (io) {
        io.close()
        io = null
    }

    if (serverInstance) {
        serverInstance.close()
        serverInstance = null
    }
}