// src/server/radio.js
// HTTP Streaming Server untuk radio
// Listener connect ke /stream dan dapat audio MP3 real-time
// SSE /events untuk real-time dashboard updates

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { radioService } from '../services/radio.js'
import { logger } from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RADIO_PORT = parseInt(process.env.RADIO_PORT ?? '8080')
const MAX_HISTORY = 20

let server = null

// ─────────────────────────────────────────────
// RECENTLY PLAYED HISTORY
// ─────────────────────────────────────────────
const recentlyPlayed = []

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

// ─────────────────────────────────────────────
// SSE CLIENT MANAGEMENT
// ─────────────────────────────────────────────
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

// Wire up radioService events → SSE broadcasts
function setupSSEBroadcasts() {
    radioService.on('track:start', (track) => {
        addToHistory(track)
        broadcastSSE('track:start', {
            title: track.title,
            url: track.url,
            duration: track.duration,
            durationFormatted: track.durationFormatted,
            thumbnail: track.thumbnail,
            requestedBy: track.requestedBy,
        })
        // Also broadcast updated queue
        broadcastSSE('queue:update', getQueueData())
    })

    radioService.on('queue:add', (track) => {
        broadcastSSE('queue:update', getQueueData())
    })

    radioService.on('queue:clear', () => {
        broadcastSSE('queue:update', getQueueData())
    })

    radioService.on('radio:idle', () => {
        broadcastSSE('radio:idle', { timestamp: Date.now() })
    })

    radioService.on('radio:stop', () => {
        broadcastSSE('radio:stop', { timestamp: Date.now() })
    })

    radioService.on('listener:join', (count) => {
        broadcastSSE('listeners:update', { count })
    })

    radioService.on('listener:leave', (count) => {
        broadcastSSE('listeners:update', { count })
    })

    radioService.on('fx:change', (name) => {
        broadcastSSE('fx:change', { fx: name })
    })

    radioService.on('eq:change', (name) => {
        broadcastSSE('eq:change', { eq: name })
    })
}

// ─────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────

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
    }
}

// ─────────────────────────────────────────────
// CORS HEADERS
// ─────────────────────────────────────────────

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Accept')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
}

// ─────────────────────────────────────────────
// HTTP SERVER & STATIC FILES
// ─────────────────────────────────────────────

const dashboardDir = path.join(__dirname, '../dashboard/out')
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
}

function serveStatic(req, res, url) {
    if (req.method !== 'GET') return false;

    let filePath = url === '/' ? '/index.html' : url;
    let absolutePath = path.join(dashboardDir, filePath);

    // Prevent directory traversal
    if (!absolutePath.startsWith(dashboardDir)) return false;

    if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        if (stats.isDirectory()) {
            absolutePath = path.join(absolutePath, 'index.html');
            if (!fs.existsSync(absolutePath)) return false;
        }

        const extname = String(path.extname(absolutePath)).toLowerCase();
        const contentType = mimeTypes[extname] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(absolutePath).pipe(res);
        return true;
    }
    
    // Support client-side routing (fallback to index.html if not an API endpoint and no extension)
    if (!path.extname(absolutePath) && fs.existsSync(path.join(dashboardDir, 'index.html'))) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(path.join(dashboardDir, 'index.html')).pipe(res);
        return true;
    }

    return false;
}

export function startRadioServer() {
    if (server) return // sudah running

    setupSSEBroadcasts()

    server = http.createServer((req, res) => {
        const url = req.url?.split('?')[0]

        // ── CORS Preflight ──
        if (req.method === 'OPTIONS') {
            setCorsHeaders(res)
            res.writeHead(204)
            res.end()
            return
        }

        setCorsHeaders(res)

        // ── GET /stream — audio stream endpoint ──
        if (url === '/stream' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache, no-store',
                'icy-name': process.env.BOT_NAME ?? 'RonnBot Radio',
                'icy-br': '128',
            })

            radioService.addClient(res)

            // Kalau radio idle saat ada yang join, mulai play kalau ada queue
            if (!radioService.isPlaying && radioService.queue.length > 0) {
                radioService.start().catch(err => logger.error('[Radio] Auto-start error:', err.message))
            }

            return
        }

        // ── GET /status — full status JSON ──
        if (url === '/status' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(getFullStatus()))
            return
        }

        // ── GET /queue — queue data ──
        if (url === '/queue' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                queue: getQueueData(),
                total: radioService.queue.length,
            }))
            return
        }

        // ── GET /history — recently played ──
        if (url === '/history' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                history: recentlyPlayed,
                total: recentlyPlayed.length,
            }))
            return
        }

        // ── GET /events — SSE endpoint ──
        if (url === '/events' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no', // nginx proxy support
            })

            // Send initial state
            res.write(`event: init\ndata: ${JSON.stringify(getFullStatus())}\n\n`)

            sseClients.add(res)

            // Heartbeat every 30s to keep connection alive
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

            return
        }

        // ── STATIC DASHBOARD OR 404 ──
        if (!serveStatic(req, res, url)) {
            res.writeHead(404)
            res.end('Not found')
        }
    })

    server.listen(RADIO_PORT, () => {
        logger.info(`[Radio] HTTP server listening on port ${RADIO_PORT}`)
        console.log(`📻 [Radio] Stream URL: http://[server-ip]:${RADIO_PORT}/stream`)
        console.log(`📻 [Radio] Status URL: http://[server-ip]:${RADIO_PORT}/status`)
        console.log(`📻 [Radio] Events URL: http://[server-ip]:${RADIO_PORT}/events`)
        console.log(`📻 [Radio] Queue URL:  http://[server-ip]:${RADIO_PORT}/queue`)
    })

    server.on('error', (err) => {
        logger.error('[Radio] Server error:', err.message)
    })

    return server
}

export function stopRadioServer() {
    // Close all SSE clients
    for (const client of sseClients) {
        try { client.end() } catch (_) { }
    }
    sseClients.clear()

    server?.close()
    server = null
}