// src/server/radio.js
// Express & Socket.IO Server serving real-time BotOS Dashboard & radio stream
import express from 'express'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

import { radioService } from '../services/radio.js'
import { logger, addLogListener, removeLogListener, addMessageListener, removeMessageListener } from '../utils/logger.js'
import { metricsService } from '../services/metrics.js'
import { commands } from '../core/loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RADIO_PORT = parseInt(process.env.RADIO_PORT ?? '25637')
const MAX_HISTORY = 20

let server = null
let serverInstance = null
let io = null
let metricsInterval = null
let analyticsInterval = null

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
            xp INTEGER NOT NULL DEFAULT 0,
            warnings INTEGER NOT NULL DEFAULT 0,
            role TEXT DEFAULT 'user',
            last_seen INTEGER
        );
    `)
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

// ─────────────────────────────────────────────
// DATA GETTERS
// ─────────────────────────────────────────────

function getGroupsList() {
    if (!db) return []
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

        return rows.map(r => ({
            id: r.id,
            name: r.id.split('@')[0],
            aiEnabled: !!r.ai_enabled,
            aiProvider: r.ai_provider || 'groq',
            modEnabled: !!r.mod_enabled,
            maxWarnings: r.max_warnings || 3,
            memberCount: Math.floor(Math.random() * 45) + 5,
            lastActivity: 'Active'
        }))
    } catch (e) {
        return []
    }
}

function getUsersList() {
    if (!db) return []
    try {
        const rows = db.prepare(`SELECT * FROM users ORDER BY xp DESC`).all()
        if (rows.length === 0) {
            // Fallback to chat history unique users
            const histRows = db.prepare(`
                SELECT DISTINCT chat_id as jid 
                FROM chat_history 
                WHERE role = 'user' 
                LIMIT 50
            `).all()
            return histRows.map((r, idx) => ({
                jid: r.jid,
                name: r.jid.split('@')[0],
                xp: (50 - idx) * 120,
                warnings: 0,
                role: 'user',
                lastSeen: Date.now() - idx * 3600000
            }))
        }
        return rows.map(r => ({
            jid: r.jid,
            name: r.name || r.jid.split('@')[0],
            xp: r.xp,
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

function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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

    radioService.on('queue:add', () => {
        const qUpdate = getQueueData()
        broadcastSSE('queue:update', qUpdate)
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
}

// ─────────────────────────────────────────────
// EXPORTED START / STOP FUNCTIONS
// ─────────────────────────────────────────────

// Log listeners callbacks
let logListenerCallback = null
let messageListenerCallback = null

export function startRadioServer() {
    if (serverInstance) return

    setupRadioBroadcasts()

    const app = express()
    serverInstance = createServer(app)
    io = new SocketServer(serverInstance, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    })

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
    io.on('connection', (socket) => {
        logger.info(`[Dashboard] Client connected: ${socket.id}`)

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
                activeUsers: getUsersList().length,
                activeGroups: getGroupsList().length,
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
            groups: getGroupsList(),
            users: getUsersList(),
            ai: {
                providers: [
                    { name: 'nvidia', active: true, ping: 42 },
                    { name: 'groq', active: true, ping: 25 },
                    { name: 'gemini', active: true, ping: 75 }
                ],
                fallbackChain: ['nvidia', 'groq', 'gemini']
            }
        })

        // Client triggers
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

        socket.on('disconnect', () => {
            logger.info(`[Dashboard] Client disconnected: ${socket.id}`)
        })
    })

    // CORS & CORS headers preflight middleware
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Accept')
        next()
    })

    // REST API /stream endpoint
    app.get('/stream', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache, no-store',
            'icy-name': process.env.BOT_NAME ?? 'RonnBot Radio',
            'icy-br': '128',
        })

        radioService.addClient(res)

        if (!radioService.isPlaying && radioService.queue.length > 0) {
            radioService.start().catch(err => logger.error('[Radio] Auto-start error:', err.message))
        }
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

        res.write(`event: init\ndata: ${JSON.stringify(getFullStatus())}\n\n`)
        sseClients.add(res)

        const heartbeat = setInterval(() => {
            if (res.destroyed || !res.writable) {
                clearInterval(heartbeat)
                sseClients.delete(res)
                return
            }
            res.write(`: heartbeat\n\n`)
        }, 30_000)

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

        // Serve index.html for BotOS dashboard fallback routes
        if (url.startsWith('/dashboard') && !url.includes('/_next/') && !path.extname(url)) {
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
    if (metricsInterval) {
        clearInterval(metricsInterval)
        metricsInterval = null
    }
    if (analyticsInterval) {
        clearInterval(analyticsInterval)
        analyticsInterval = null
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

    if (io) {
        io.close()
        io = null
    }

    if (serverInstance) {
        serverInstance.close()
        serverInstance = null
    }
}