// src/server/routes/music.js
import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { radioService } from '../../services/radio.js'
import { logger } from '../../utils/logger.js'
import { startSunoPipeline } from '../../services/suno.js'
import { authenticateControlJwt, optionalJwt, requirePermission } from '../middleware/auth.js'
import { PERMISSIONS, hasPermission } from '../security/rbac.js'
import { createRateLimiter } from '../security/rateLimit.js'
import { timingSafeEqualStr, setAppSetting, recordAudit } from '../security/controlAuth.js'
import { safeErrorMessage } from '../security/redaction.js'
import { db } from '../radio.js'

const router = express.Router()

const ALLOWED_UPLOAD_EXTS = new Set(['.mp3', '.wav', '.mpeg', '.m4a', '.ogg', '.flac', '.png', '.jpg', '.jpeg', '.webp'])
const ALLOWED_UPLOAD_MIME_PREFIXES = ['audio/', 'image/']

const trimRateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: Number(process.env.YT_TRIM_MAX_REQUESTS || 20),
    message: 'Too many trim requests. Please try again later.'
})

function authenticateCreatorOrServiceToken(permission) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization']
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
        const envServiceToken = (process.env.SUNO_SYNC_TOKEN || '').trim()

        if (envServiceToken && bearerToken && timingSafeEqualStr(bearerToken, envServiceToken)) {
            req.controlUser = { id: 'suno-sync-service', role: 'operator', scope: 'control' }
            return next()
        }

        return authenticateControlJwt(req, res, () => {
            requirePermission(permission)(req, res, next)
        })
    }
}

function validateYouTubeTarget(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null
    const trimmed = rawUrl.trim()
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
        return `https://www.youtube.com/watch?v=${trimmed}`
    }
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
        const allowedHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'])
        if (!allowedHosts.has(parsed.hostname.toLowerCase())) return null
        return parsed.toString()
    } catch {
        return null
    }
}

// Configure multer for manual music audio upload
const uploadDir = path.resolve('./storage/media/tmp/uploads')
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase()
        const safeExt = ALLOWED_UPLOAD_EXTS.has(ext) ? ext : '.mp3'
        const uniqueName = `${crypto.randomUUID()}${safeExt}`
        cb(null, uniqueName)
    }
})

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // limit to 50MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase()
        const mime = (file.mimetype || '').toLowerCase()
        const validExt = ALLOWED_UPLOAD_EXTS.has(ext)
        const validMime = ALLOWED_UPLOAD_MIME_PREFIXES.some(prefix => mime.startsWith(prefix)) || mime === 'application/octet-stream'
        if (!validExt || !validMime) {
            return cb(new Error('Unsupported file type. Only allowed audio/image formats are permitted.'))
        }
        cb(null, true)
    }
})

function uploadSingleSafe(fieldName) {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, error: { code: 'INVALID_UPLOAD', message: safeErrorMessage(err) } })
            }
            next()
        })
    }
}

// ----------------------------------------------------
// PUBLIC / API V2 ENDPOINTS
// ----------------------------------------------------

router.get('/api/v2/music/search', async (req, res) => {
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

router.post('/api/v2/music/request', optionalJwt, async (req, res) => {
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
        const userName = req.user?.name || req.body?.userName || 'Web Listener'
        const track = await radioService.search(query, userJid, userName)
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

router.get('/api/v2/music/queue', (req, res) => {
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

router.get('/api/v2/music/history', (req, res) => {
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

router.get('/api/v2/music/now-playing', (req, res) => {
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

// ----------------------------------------------------
// SUNO SYNC / UPLOAD / CONFIG ENDPOINTS (CONTROL CENTER + SERVICE TOKEN)
// ----------------------------------------------------

router.post('/api/music/manual-upload', authenticateCreatorOrServiceToken(PERMISSIONS.CREATOR_OPERATE), uploadSingleSafe('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No audio file uploaded.' })
        }

        const { prompt, title, description } = req.body || {}
        if (!prompt) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ success: false, message: 'Prompt/Description is required.' })
        }

        const manualAudioPath = req.file.path
        logger.info(`[Music] Received manual audio upload. File: ${path.basename(manualAudioPath)}`)

        const jobId = startSunoPipeline({
            prompt: prompt,
            title: title || 'Manual Audio Render',
            description: description || '',
            enhance: false,
            model: 'manual',
            manualAudioPath: manualAudioPath
        })

        recordAudit({
            actorId: req.controlUser?.id || null,
            actorRole: req.controlUser?.role || null,
            action: 'music:manual_upload',
            target: jobId || 'suno-job',
            result: 'allowed',
            correlationId: req.id || null
        })

        res.json({
            success: true,
            message: 'Manual upload successfully queued.',
            jobId: jobId
        })
    } catch (err) {
        logger.error(`[Music/ManualUpload] Error: ${err.message}`)
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})

router.post('/api/music/upload-temp', authenticateCreatorOrServiceToken(PERMISSIONS.CREATOR_OPERATE), uploadSingleSafe('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded.' })
        }

        const filePath = req.file.path
        const originalName = path.basename(req.file.originalname || 'upload')
        const size = req.file.size
        const mimeType = req.file.mimetype

        let duration = 0
        let metadataTitle = ''

        const isAudio = mimeType.startsWith('audio/') ||
                        originalName.endsWith('.mp3') ||
                        originalName.endsWith('.wav') ||
                        originalName.endsWith('.mpeg') ||
                        originalName.endsWith('.m4a')

        if (isAudio) {
            try {
                const probe = spawnSync('ffmpeg', ['-i', filePath], { encoding: 'utf8', timeout: 15000 })
                const output = `${probe.stdout || ''}${probe.stderr || ''}`

                // Parse duration
                const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1], 10)
                    const minutes = parseInt(durationMatch[2], 10)
                    const seconds = parseFloat(durationMatch[3])
                    duration = hours * 3600 + minutes * 60 + seconds
                }

                // Parse Title tag
                const titleMatch = output.match(/title\s*:\s*(.+)/i)
                if (titleMatch) {
                    metadataTitle = titleMatch[1].trim()
                }
            } catch (probeErr) {
                logger.error(`[UploadTemp/Probe] Error probing audio file: ${probeErr.message}`)
            }
        }

        logger.info(`[Music] Received temp file upload. Stored: ${path.basename(filePath)}, Size: ${size} bytes, Type: ${mimeType}, Duration: ${duration}s`)

        res.json({
            success: true,
            file: {
                path: filePath,
                originalName: originalName,
                size: size,
                mimeType: mimeType,
                duration: duration,
                metadataTitle: metadataTitle || null
            }
        })
    } catch (err) {
        logger.error(`[Music/UploadTemp] Error: ${err.message}`)
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})

router.post('/api/music/playlist-generate', express.json(), authenticateCreatorOrServiceToken(PERMISSIONS.CREATOR_OPERATE), async (req, res) => {
    try {
        const { songs, outputTitle, playlistDescription, transitionStyle, generateMotion, vignetteMode } = req.body || {}
        if (!songs || !Array.isArray(songs) || songs.length === 0) {
            return res.status(400).json({ success: false, message: 'Lagu-lagu playlist tidak boleh kosong.' })
        }
        if (!outputTitle) {
            return res.status(400).json({ success: false, message: 'Judul Playlist YouTube wajib diisi.' })
        }

        logger.info(`[Music/PlaylistGenerate] Triggering playlist generation from HTTP: ${outputTitle} (${songs.length} songs)`)

        const { startPlaylistPipeline } = await import('../../services/suno.js')
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

        recordAudit({
            actorId: req.controlUser?.id || null,
            actorRole: req.controlUser?.role || null,
            action: 'music:playlist_generate',
            target: jobId || outputTitle,
            result: 'allowed',
            correlationId: req.id || null
        })

        res.json({ success: true, jobId })
    } catch (err) {
        logger.error(`[Music/PlaylistGenerate] Error: ${err.message}`)
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})


router.post('/api/music/update-cookie', express.json(), authenticateControlJwt, requirePermission(PERMISSIONS.SECRETS_MANAGE), async (req, res) => {
    try {
        const { cookie } = req.body || {}
        if (!cookie || typeof cookie !== 'string' || /[\r\n]/.test(cookie)) {
            return res.status(400).json({ success: false, message: 'Valid single-line cookie is required.' })
        }

        process.env.SUNO_COOKIE = cookie
        setAppSetting('SUNO_COOKIE', cookie, req.controlUser.id)
        logger.info('[Music/CookieSync] Suno session cookie updated in runtime & app_settings.')

        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'secrets:update_suno_cookie',
            target: 'SUNO_COOKIE',
            result: 'allowed',
            correlationId: req.id || null
        })

        res.json({
            success: true,
            message: 'Suno session cookie successfully synchronized (stored in protected runtime settings).'
        })
    } catch (err) {
        logger.error(`[Music/CookieSync] Error: ${err.message}`)
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})

router.get('/api/music/config', authenticateControlJwt, requirePermission(PERMISSIONS.CREATOR_READ), async (req, res) => {
    try {
        res.json({
            success: true,
            tunnelUrl: process.env.SUNO_API_URL || '',
            cookieConfigured: Boolean(process.env.SUNO_COOKIE)
        })
    } catch (err) {
        logger.error(`[Music/Config] Error: ${err.message}`)
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})

router.post('/api/music/update-tunnel', express.json(), authenticateControlJwt, requirePermission(PERMISSIONS.SECRETS_MANAGE), async (req, res) => {
    try {
        const { tunnelUrl } = req.body || {}
        if (!tunnelUrl || typeof tunnelUrl !== 'string' || /[\r\n]/.test(tunnelUrl)) {
            return res.status(400).json({ success: false, message: 'Valid Tunnel URL is required.' })
        }

        let parsed
        try {
            parsed = new URL(tunnelUrl.trim())
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                throw new Error('Invalid protocol')
            }
        } catch {
            return res.status(400).json({ success: false, message: 'Tunnel URL must be a valid http/https URL.' })
        }

        const cleanUrl = parsed.toString().replace(/\/$/, '')
        process.env.SUNO_API_URL = cleanUrl
        setAppSetting('SUNO_API_URL', cleanUrl, req.controlUser.id)
        logger.info(`[Music/TunnelSync] Suno API URL updated in runtime & app_settings.`)

        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'secrets:update_suno_tunnel',
            target: 'SUNO_API_URL',
            result: 'allowed',
            correlationId: req.id || null
        })

        res.json({
            success: true,
            message: 'Suno API Tunnel URL successfully synchronized.'
        })
    } catch (err) {
        logger.error(`[Music/TunnelSync] Error: ${err.message}`)
        res.status(500).json({ success: false, message: safeErrorMessage(err) })
    }
})

// ----------------------------------------------------
// CE F CLASS PORTAL INTEGRATION: /api/yt/trim & /trim
// ----------------------------------------------------
router.get(['/api/yt/trim', '/trim'], trimRateLimiter, async (req, res) => {
    const { url, start = 0, duration = 30 } = req.query
    if (!url) {
        return res.status(400).json({ success: false, error: 'Parameter "url" (YouTube URL atau videoId) wajib diisi.' })
    }

    const targetUrl = validateYouTubeTarget(String(url))
    if (!targetUrl) {
        return res.status(400).json({ success: false, error: 'URL atau videoId YouTube tidak valid.' })
    }

    const safeStart = Math.max(0, Number(start) || 0)
    const safeDuration = Math.min(Math.max(Number(duration) || 30, 1), 120)

    logger.info(`[Music/TrimAPI] Trimming: ${targetUrl} [Start: ${safeStart}s, Dur: ${safeDuration}s]`)

    try {
        const { spawn } = await import('child_process')

        // ── STRATEGY 1: yt-dlp → direct audio URL → ffmpeg ───────────────
        // yt-dlp handles YouTube auth/bot-detection far better than play-dl.
        const ytdlpAvailable = await new Promise(resolve => {
            const check = spawn('yt-dlp', ['--version'])
            check.on('close', code => resolve(code === 0))
            check.on('error', () => resolve(false))
        })

        if (ytdlpAvailable) {
            logger.info('[Music/TrimAPI] Using yt-dlp strategy')

            // Extra yt-dlp args — add cookies file if configured
            const cookiesFile = process.env.YTDLP_COOKIES_FILE
            const ytdlpArgs = [
                '--no-playlist',
                '--format', 'bestaudio/best',
                '--get-url',
                ...(cookiesFile ? ['--cookies', cookiesFile] : []),
                targetUrl
            ]

            const ytdlpProc = spawn('yt-dlp', ytdlpArgs)
            let directUrl = ''
            let ytdlpErr = ''

            ytdlpProc.stdout.on('data', chunk => { directUrl += chunk.toString() })
            ytdlpProc.stderr.on('data', chunk => { ytdlpErr += chunk.toString() })

            const ytdlpCode = await new Promise(resolve => ytdlpProc.on('close', resolve))

            directUrl = directUrl.trim().split('\n')[0] // take first URL if multiple

            if (ytdlpCode === 0 && directUrl) {
                const ffmpeg = spawn('ffmpeg', [
                    '-y',
                    '-ss', String(safeStart),
                    '-t', String(safeDuration),
                    '-i', directUrl,
                    '-f', 'mp3',
                    '-c:a', 'libmp3lame',
                    '-b:a', '192k',
                    'pipe:1'
                ])

                res.setHeader('Content-Type', 'audio/mpeg')
                res.setHeader('Content-Disposition', `inline; filename="trim_${safeStart}_${safeDuration}s.mp3"`)
                ffmpeg.stdout.pipe(res)

                ffmpeg.on('error', err => {
                    logger.error(`[Music/TrimAPI] FFmpeg (yt-dlp) error: ${err.message}`)
                    if (!res.headersSent) res.status(500).json({ success: false, error: safeErrorMessage(err) })
                })
                req.on('close', () => { try { ffmpeg.kill() } catch {} })
                return
            }

            logger.warn(`[Music/TrimAPI] yt-dlp failed (code ${ytdlpCode}): ${ytdlpErr.slice(0, 200)}`)
        }

        // ── STRATEGY 2: play-dl with optional YouTube cookie ─────────────
        logger.info('[Music/TrimAPI] Falling back to play-dl strategy')
        const playdlMod = await import('play-dl')
        const playdl = playdlMod.default ?? playdlMod

        // Inject cookie if provided in env
        if (process.env.YOUTUBE_COOKIE) {
            try {
                await playdl.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } })
            } catch (e) {
                logger.warn(`[Music/TrimAPI] play-dl setToken failed: ${e.message}`)
            }
        }

        let stream = null
        try {
            const streamData = await playdl.stream(targetUrl)
            if (streamData?.stream) stream = streamData.stream
        } catch (streamErr) {
            logger.warn(`[Music/TrimAPI] playdl.stream failed: ${streamErr.message}`)
        }

        if (stream) {
            const ffmpeg = spawn('ffmpeg', [
                '-y',
                '-ss', String(safeStart),
                '-t', String(safeDuration),
                '-i', 'pipe:0',
                '-f', 'mp3',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                'pipe:1'
            ])

            res.setHeader('Content-Type', 'audio/mpeg')
            res.setHeader('Content-Disposition', `inline; filename="trim_${safeStart}_${safeDuration}s.mp3"`)
            stream.pipe(ffmpeg.stdin)
            ffmpeg.stdout.pipe(res)

            ffmpeg.on('error', err => {
                logger.error(`[Music/TrimAPI] FFmpeg (play-dl) error: ${err.message}`)
                if (!res.headersSent) res.status(500).json({ success: false, error: safeErrorMessage(err) })
            })
            req.on('close', () => { try { ffmpeg.kill() } catch {} })
        } else {
            // Last resort: video_info direct CDN URL
            const info = await playdl.video_info(targetUrl)
            const formats = (info?.format) || []
            const audioFormat = formats.find(f => f.url && f.mimeType?.toLowerCase().includes('audio')) || formats.find(f => f.url)
            if (!audioFormat?.url) {
                return res.status(500).json({ success: false, error: 'Tidak dapat menemukan format audio. Coba update yt-dlp cookies atau set YOUTUBE_COOKIE di .env.' })
            }

            const ffmpeg = spawn('ffmpeg', [
                '-y',
                '-ss', String(safeStart),
                '-t', String(safeDuration),
                '-i', audioFormat.url,
                '-f', 'mp3',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                'pipe:1'
            ])

            res.setHeader('Content-Type', 'audio/mpeg')
            res.setHeader('Content-Disposition', `inline; filename="trim_${safeStart}_${safeDuration}s.mp3"`)
            ffmpeg.stdout.pipe(res)

            ffmpeg.on('error', err => {
                logger.error(`[Music/TrimAPI] FFmpeg (video_info) error: ${err.message}`)
                if (!res.headersSent) res.status(500).json({ success: false, error: safeErrorMessage(err) })
            })
            req.on('close', () => { try { ffmpeg.kill() } catch {} })
        }
    } catch (err) {
        logger.error(`[Music/TrimAPI] Error: ${err.message}`)
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message })
        }
    }
})

export default router
