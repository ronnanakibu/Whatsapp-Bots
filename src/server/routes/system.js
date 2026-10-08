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

// Logs Endpoints
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
