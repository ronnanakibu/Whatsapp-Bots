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
// MODERN TERMINAL LOG VIEWER (HTML UI)
// ─────────────────────────────────────────────
function renderLogTerminalHtml(lines, source, fileName) {
    const jsonLines = JSON.stringify(lines)
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>RonnBot Live Logs Terminal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #080c14;
            color: #cbd5e1;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        header {
            background: #0f172a;
            border-bottom: 1px solid #1e293b;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .brand h1 {
            font-size: 16px;
            font-weight: 700;
            color: #f8fafc;
            letter-spacing: 0.5px;
        }
        .badge {
            background: #1e293b;
            color: #38bdf8;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid #334155;
            font-family: monospace;
        }
        .live-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 8px #10b981;
            margin-right: 6px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.9); }
        }
        .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .btn {
            background: #1e293b;
            color: #f1f5f9;
            border: 1px solid #334155;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            text-decoration: none;
            transition: all 0.15s ease;
        }
        .btn:hover {
            background: #334155;
            border-color: #475569;
        }
        .btn-primary {
            background: #0284c7;
            border-color: #0369a1;
            color: white;
            font-weight: 600;
        }
        .btn-primary:hover {
            background: #0369a1;
        }
        .toolbar {
            background: #0b1120;
            border-bottom: 1px solid #1e293b;
            padding: 8px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }
        .search-box {
            position: relative;
            flex: 1;
            max-width: 360px;
        }
        .search-input {
            width: 100%;
            background: #0f172a;
            border: 1px solid #334155;
            color: #f8fafc;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
        }
        .search-input:focus {
            border-color: #38bdf8;
            box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
        }
        .filter-pills {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pill {
            background: transparent;
            color: #94a3b8;
            border: 1px solid #334155;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .pill.active {
            background: #38bdf8;
            color: #0f172a;
            border-color: #38bdf8;
            font-weight: 600;
        }
        .controls {
            display: flex;
            align-items: center;
            gap: 14px;
            font-size: 12px;
            color: #94a3b8;
        }
        .toggle-label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
        }
        #terminal {
            flex: 1;
            background: #080c14;
            overflow-y: auto;
            overflow-x: auto;
            padding: 12px 16px;
            font-family: 'JetBrains Mono', 'Fira Code', Cascadia, ui-monospace, Menlo, Consolas, monospace;
            font-size: 12px;
            line-height: 1.55;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .log-row {
            display: flex;
            gap: 12px;
            padding: 1px 0;
            border-radius: 2px;
        }
        .log-row:hover {
            background: rgba(255, 255, 255, 0.03);
        }
        .ln {
            color: #334155;
            min-width: 40px;
            text-align: right;
            user-select: none;
            font-size: 11px;
        }
        .log-msg {
            flex: 1;
            color: #cbd5e1;
        }
        .lvl-system { color: #38bdf8; }
        .lvl-warn { color: #fbbf24; }
        .lvl-error { color: #f43f5e; font-weight: 600; }
        .lvl-success { color: #34d399; }
        .lvl-pairing {
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.12);
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px dashed #38bdf8;
            font-weight: 700;
            display: inline-block;
            margin: 4px 0;
        }
        #toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #1e293b;
            color: #f8fafc;
            border: 1px solid #38bdf8;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 12px;
            box-shadow: 0 10px 20px rgba(0,0,0,0.4);
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
        }
        #toast.show { opacity: 1; }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <span class="live-dot" id="liveDot"></span>
            <h1>RonnBot Live Terminal & App Logs</h1>
            <span class="badge">${fileName} (${source})</span>
            <span id="lineCount" style="font-size: 11px; color: #64748b;">${lines.length} lines</span>
        </div>
        <div class="header-actions">
            <a href="/pairing" class="btn btn-primary" target="_blank">🔗 Tautkan WhatsApp</a>
            <button class="btn" onclick="copyAllLogs()">📋 Salin Log</button>
            <a href="?download=true" class="btn">💾 Unduh Raw</a>
            <a href="?raw=true" class="btn">📄 Plain Text</a>
        </div>
    </header>

    <div class="toolbar">
        <div class="search-box">
            <input type="text" id="searchInput" class="search-input" placeholder="🔍 Cari log (status, error, pair)..." oninput="filterLogs()">
        </div>
        <div class="filter-pills">
            <button class="pill active" onclick="setFilter('all', this)">Semua</button>
            <button class="pill" onclick="setFilter('system', this)">System</button>
            <button class="pill" onclick="setFilter('warn', this)">Warning</button>
            <button class="pill" onclick="setFilter('error', this)">Error</button>
            <button class="pill" onclick="setFilter('pairing', this)">Pairing / Conn</button>
        </div>
        <div class="controls">
            <label class="toggle-label">
                <input type="checkbox" id="autoRefreshToggle" checked onchange="toggleAutoRefresh(this.checked)">
                <span>Auto-Refresh (2.5s)</span>
            </label>
            <label class="toggle-label">
                <input type="checkbox" id="autoScrollToggle" checked>
                <span>Auto-Scroll</span>
            </label>
        </div>
    </div>

    <div id="terminal"></div>
    <div id="toast">Log disalin ke clipboard!</div>

    <script>
        let rawLines = ${jsonLines};
        let currentFilter = 'all';
        let refreshInterval = null;

        function colorize(line) {
            let escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (escaped.includes('PAIRING CODE:')) {
                return '<span class="lvl-pairing">' + escaped + '</span>';
            }
            if (escaped.includes('ERROR') || escaped.includes('CLOSE status=401') || escaped.includes('fatal') || escaped.includes('Failure')) {
                return '<span class="lvl-error">' + escaped + '</span>';
            }
            if (escaped.includes('WARN') || escaped.includes('Warning') || escaped.includes('Reconnecting')) {
                return '<span class="lvl-warn">' + escaped + '</span>';
            }
            if (escaped.includes('SYSTEM') || escaped.includes('Initializing') || escaped.includes('BOT STARTUP')) {
                return '<span class="lvl-system">' + escaped + '</span>';
            }
            if (escaped.includes('✓') || escaped.includes('✅') || escaped.includes('BOT READY') || escaped.includes('open')) {
                return '<span class="lvl-success">' + escaped + '</span>';
            }
            return '<span class="log-msg">' + escaped + '</span>';
        }

        function render() {
            const query = (document.getElementById('searchInput').value || '').toLowerCase();
            const term = document.getElementById('terminal');
            const shouldScroll = document.getElementById('autoScrollToggle').checked;

            let filtered = [];
            for (let i = 0; i < rawLines.length; i++) {
                const line = rawLines[i];
                const lower = line.toLowerCase();

                if (query && !lower.includes(query)) continue;

                if (currentFilter === 'system' && !lower.includes('system')) continue;
                if (currentFilter === 'warn' && !lower.includes('warn') && !lower.includes('warning')) continue;
                if (currentFilter === 'error' && !lower.includes('error') && !lower.includes('close status=401') && !lower.includes('failure')) continue;
                if (currentFilter === 'pairing' && !lower.includes('pairing') && !lower.includes('conn') && !lower.includes('qr')) continue;

                filtered.push({ lineNum: i + 1, content: colorize(line) });
            }

            let html = '';
            for (let item of filtered) {
                html += '<div class="log-row"><span class="ln">' + item.lineNum + '</span>' + item.content + '</div>';
            }
            term.innerHTML = html || '<div style="color: #64748b; padding: 20px; text-align: center;">Tidak ada log yang cocok dengan filter.</div>';
            document.getElementById('lineCount').innerText = rawLines.length + ' lines';

            if (shouldScroll) {
                term.scrollTop = term.scrollHeight;
            }
        }

        function setFilter(type, el) {
            currentFilter = type;
            document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            if (el) el.classList.add('active');
            render();
        }

        function filterLogs() {
            render();
        }

        async function fetchLatestLogs() {
            try {
                const res = await fetch('?json=true&tail=1000');
                if (res.ok) {
                    const data = await res.json();
                    if (data && Array.isArray(data.lines)) {
                        rawLines = data.lines;
                        render();
                    }
                }
            } catch (_) {}
        }

        function toggleAutoRefresh(enabled) {
            if (refreshInterval) clearInterval(refreshInterval);
            const dot = document.getElementById('liveDot');
            if (enabled) {
                dot.style.background = '#10b981';
                dot.style.boxShadow = '0 0 8px #10b981';
                refreshInterval = setInterval(fetchLatestLogs, 2500);
            } else {
                dot.style.background = '#64748b';
                dot.style.boxShadow = 'none';
            }
        }

        function copyAllLogs() {
            const text = rawLines.join('\\n');
            navigator.clipboard.writeText(text).then(() => {
                const toast = document.getElementById('toast');
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 2000);
            });
        }

        render();
        toggleAutoRefresh(true);
    </script>
</body>
</html>`
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

    // HTML View untuk Browser (Bukan curl / raw / plain)
    const wantsHtml = req.headers['accept']?.includes('text/html') && req.query.raw !== 'true' && req.query.text !== 'true'
    if (wantsHtml) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.send(renderLogTerminalHtml(resultLines, sourceUsed, targetFile))
    }

    // Default: text/plain response (langsung dibaca di curl, script, atau AI inspector)
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

    if (req.headers['accept']?.includes('text/html') && req.query.json !== 'true') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.send(renderLogTerminalHtml(tailLines, sourceUsed, fileType))
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
