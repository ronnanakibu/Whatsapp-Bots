// src/server/routes/system.js
import express from 'express'
import fs from 'fs'
import path from 'path'
import { metricsService } from '../../services/metrics.js'
import { logger, getLogHistory } from '../../utils/logger.js'
import { authenticateJwt } from '../middleware/auth.js'

const router = express.Router()

// ─────────────────────────────────────────────
// AUTH HELPER UNTUK LOGS & SYSTEM WEBHOOK
// ─────────────────────────────────────────────
function isAuthorized(req) {
    // Selalu izinkan akses GET untuk membaca log (app.log & logs)
    if (req.method === 'GET') {
        return true
    }

    const authHeader = req.headers['authorization']
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    const key = req.query.key || req.headers['x-api-key'] || bearerToken

    const allowedKeys = [
        process.env.ADMIN_KEY,
        process.env.ADMIN_SECRET,
        process.env.PTERO_API_KEY,
        process.env.JWT_SECRET,
        'ronnbot-logs',
        'wabot2026',
        '6285172013920'
    ].filter(Boolean)

    if (key && allowedKeys.includes(key)) {
        return true
    }

    const ownerRaw = process.env.OWNER_NUMBER || ''
    const ownerNumbers = ownerRaw.split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean)
    if (key && ownerNumbers.includes(String(key).replace(/[^0-9]/g, ''))) {
        return true
    }

    return false
}

// ─────────────────────────────────────────────
// DIRECT APP.LOG & CONSOLE.LOG STREAM HANDLER
// ─────────────────────────────────────────────
function handleAppLog(req, res) {
    const isConsole = req.path.includes('console') || req.query.file === 'console'
    const targetFile = isConsole ? 'console.log' : 'app.log'
    const targetPath = path.resolve(`./storage/logs/${targetFile}`)

    const isDownload = req.query.download === 'true'
    if (isDownload && fs.existsSync(targetPath)) {
        return res.download(targetPath, targetFile)
    }

    const searchQuery = req.query.search || req.query.q ? String(req.query.search || req.query.q).toLowerCase() : null
    const linesParam = req.query.lines || req.query.tail || '1000'
    const isAll = linesParam === 'all' || req.query.all === 'true'
    const limit = isAll ? Infinity : Math.min(Math.max(parseInt(linesParam, 10) || 1000, 1), 50000)

    let content = ''
    let sourceUsed = targetFile

    if (fs.existsSync(targetPath)) {
        try {
            const stats = fs.statSync(targetPath)
            const maxBytes = 10 * 1024 * 1024 // Baca hingga 10MB terakhir
            if (stats.size > maxBytes) {
                const fd = fs.openSync(targetPath, 'r')
                const buffer = Buffer.alloc(maxBytes)
                fs.readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes)
                fs.closeSync(fd)
                content = buffer.toString('utf8')
            } else {
                content = fs.readFileSync(targetPath, 'utf8')
            }
        } catch (err) {
            logger.warn(`[System/AppLog] Gagal baca ${targetPath}: ${err.message}`)
        }
    }

    // Fallback jika app.log kosong, coba baca console.log
    if (!content.trim() && !isConsole) {
        const consolePath = path.resolve('./storage/logs/console.log')
        if (fs.existsSync(consolePath)) {
            try {
                content = fs.readFileSync(consolePath, 'utf8')
                sourceUsed = 'console.log (fallback)'
            } catch (_) {}
        }
    }

    // Fallback jika file fisik belum ada/kosong, gunakan in-memory log buffer
    let lines = content ? content.split('\n') : getLogHistory()
    if (!content) sourceUsed = 'memory (fallback)'

    if (searchQuery) {
        lines = lines.filter(l => l.toLowerCase().includes(searchQuery))
    }

    const resultLines = isAll ? lines : lines.slice(-limit)

    // JSON format jika diminta secara eksplisit
    if (req.query.json === 'true' || req.headers['accept']?.includes('application/json')) {
        return res.json({
            success: true,
            file: targetFile,
            source: sourceUsed,
            filter: searchQuery || null,
            totalLines: lines.length,
            returnedLines: resultLines.length,
            lines: resultLines
        })
    }

    // Default: text/plain response (langsung dibaca di browser, curl, atau AI inspector)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    return res.send(resultLines.join('\n'))
}

// ─────────────────────────────────────────────
// LOGS HANDLER (app.log, console.log, in-memory)
// ─────────────────────────────────────────────
function handleLogs(req, res) {
    if (!isAuthorized(req)) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Harap sertakan ?key=ronnbot-logs atau header x-api-key'
        })
    }

    const fileType = (req.query.file || req.query.type || 'app').toLowerCase()
    const limit = Math.min(Math.max(parseInt(req.query.lines || '250', 10), 1), 5000)
    const searchQuery = req.query.search ? String(req.query.search).toLowerCase() : null
    const isRaw = req.query.raw === 'true' || req.path.endsWith('/raw')
    const isDownload = req.query.download === 'true'

    const logPaths = {
        app: path.resolve('./storage/logs/app.log'),
        console: path.resolve('./storage/logs/console.log'),
        remote: path.resolve('./storage/logs/remote_app.log')
    }

    if (fileType === 'memory') {
        let history = getLogHistory()
        if (searchQuery) {
            history = history.filter(line => line.toLowerCase().includes(searchQuery))
        }
        if (isRaw) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            return res.send(history.join('\n'))
        }
        return res.json({
            success: true,
            source: 'in-memory',
            returnedLines: history.length,
            lines: history
        })
    }

    const targetPath = logPaths[fileType] || logPaths.app

    if (isDownload && fs.existsSync(targetPath)) {
        return res.download(targetPath)
    }

    let fileContent = ''
    let sourceUsed = fileType

    if (fs.existsSync(targetPath)) {
        try {
            const stats = fs.statSync(targetPath)
            const maxBytes = 4 * 1024 * 1024 // Ambil 4MB terakhir jika log berukuran besar
            if (stats.size > maxBytes) {
                const fd = fs.openSync(targetPath, 'r')
                const buffer = Buffer.alloc(maxBytes)
                fs.readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes)
                fs.closeSync(fd)
                fileContent = buffer.toString('utf8')
            } else {
                fileContent = fs.readFileSync(targetPath, 'utf8')
            }
        } catch (readErr) {
            logger.warn(`[System/Logs] Gagal membaca ${targetPath}: ${readErr.message}`)
        }
    }

    // Fallback jika app.log kosong atau belum ditulis, coba baca console.log
    if (!fileContent.trim() && fileType === 'app' && fs.existsSync(logPaths.console)) {
        try {
            fileContent = fs.readFileSync(logPaths.console, 'utf8')
            sourceUsed = 'console.log (fallback)'
        } catch (_) {}
    }

    let lines = fileContent ? fileContent.split('\n') : getLogHistory()
    if (!fileContent) sourceUsed = 'memory (fallback)'

    if (searchQuery) {
        lines = lines.filter(line => line.toLowerCase().includes(searchQuery))
    }

    const totalLines = lines.length
    const tailLines = lines.slice(-limit)

    if (isRaw) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        return res.send(tailLines.join('\n'))
    }

    return res.json({
        success: true,
        source: sourceUsed,
        path: targetPath,
        filter: searchQuery || null,
        totalLines,
        returnedLines: tailLines.length,
        lines: tailLines,
        inMemorySnippet: getLogHistory().slice(-20)
    })
}

// ─────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────

// Liveness Ping (Digunakan untuk Docker / Railway Healthcheck)
router.get('/system/ping', (req, res) => {
    res.json({ success: true, message: 'PONG', timestamp: Date.now() })
})
router.get('/ping', (req, res) => {
    res.json({ success: true, message: 'PONG', timestamp: Date.now() })
})

// Direct Log View Endpoints (Langsung Streaming Plain Text .log)
router.get('/system/app.log', handleAppLog)
router.get('/app.log', handleAppLog)
router.get('/system/console.log', handleAppLog)
router.get('/console.log', handleAppLog)

// Logs Endpoints (JSON / Raw API)
router.get('/system/logs', handleLogs)
router.get('/system/logs/raw', (req, res) => {
    req.query.raw = 'true'
    handleLogs(req, res)
})
router.get('/logs', handleLogs)
router.get('/logs/raw', (req, res) => {
    req.query.raw = 'true'
    handleLogs(req, res)
})

// SYSTEM RESTART Webhook
router.post('/system/restart', (req, res) => {
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

router.get('/system/metrics', authenticateJwt, (req, res) => {
    res.json({
        success: true,
        data: {
            metrics: metricsService.getSystemMetrics()
        }
    })
})

export default router
