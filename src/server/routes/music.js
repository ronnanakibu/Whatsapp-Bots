// src/server/routes/music.js
import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { radioService } from '../../services/radio.js'
import { logger } from '../../utils/logger.js'
import { startSunoPipeline } from '../../services/suno.js'
import { authenticateJwt } from '../middleware/auth.js'
import { db } from '../radio.js'

const router = express.Router()

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
        const ext = path.extname(file.originalname) || '.mp3'
        const uniqueName = `${crypto.randomUUID()}${ext}`
        cb(null, uniqueName)
    }
})

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // limit to 50MB
})

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

router.post('/api/v2/music/request', authenticateJwt, async (req, res) => {
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
// SUNO SYNC / UPLOAD / CONFIG ENDPOINTS (LEGACY DIRECT APP ROUTING)
// ----------------------------------------------------

router.post('/api/music/manual-upload', upload.single('audio'), async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No audio file uploaded.' })
        }

        const { prompt, title, description } = req.body
        if (!prompt) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ success: false, message: 'Prompt/Description is required.' })
        }

        const manualAudioPath = req.file.path
        logger.info(`[Music] Received manual audio upload. File: ${req.file.originalname} -> ${manualAudioPath}`)

        const jobId = startSunoPipeline({
            prompt: prompt,
            title: title || 'Manual Audio Render',
            description: description || '',
            enhance: false,
            model: 'manual',
            manualAudioPath: manualAudioPath
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
        res.status(500).json({ success: false, message: err.message })
    }
})

router.post('/api/music/upload-temp', upload.single('file'), async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded.' })
        }

        const filePath = req.file.path
        const originalName = req.file.originalname
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
                const { execSync } = await import('child_process')
                let output = ''
                try {
                    output = execSync(`ffmpeg -i "${filePath}"`, { stdio: 'pipe' }).toString()
                } catch (err) {
                    output = (err.stdout || '').toString() + (err.stderr || '').toString()
                }

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

        logger.info(`[Music] Received temp file upload. Name: ${originalName}, Size: ${size} bytes, Type: ${mimeType}, Path: ${filePath}, Duration: ${duration}s, Title Tag: ${metadataTitle}`)

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
        res.status(500).json({ success: false, message: err.message })
    }
})

router.post('/api/music/playlist-generate', express.json(), async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }

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

        res.json({ success: true, jobId })
    } catch (err) {
        logger.error(`[Music/PlaylistGenerate] Error: ${err.message}`)
        res.status(500).json({ success: false, message: err.message })
    }
})


router.post('/api/music/update-cookie', express.json(), async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }

        const { cookie } = req.body
        if (!cookie) {
            return res.status(400).json({ success: false, message: 'Cookie is required.' })
        }

        process.env.SUNO_COOKIE = cookie
        logger.info('[Music/CookieSync] Suno session cookie successfully updated in-memory.')

        const envPath = path.resolve('./.env')
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8')
            const regex = /^SUNO_COOKIE=.*$/m
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `SUNO_COOKIE=${cookie}`)
            } else {
                envContent += `\nSUNO_COOKIE=${cookie}`
            }
            fs.writeFileSync(envPath, envContent, 'utf8')
            logger.info('[Music/CookieSync] Suno session cookie successfully written to .env file.')
        }

        res.json({
            success: true,
            message: 'Suno session cookie successfully synchronized.'
        })
    } catch (err) {
        logger.error(`[Music/CookieSync] Error: ${err.message}`)
        res.status(500).json({ success: false, message: err.message })
    }
})

router.get('/api/music/config', async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }
        res.json({
            success: true,
            tunnelUrl: process.env.SUNO_API_URL || ''
        })
    } catch (err) {
        logger.error(`[Music/Config] Error: ${err.message}`)
        res.status(500).json({ success: false, message: err.message })
    }
})

router.post('/api/music/update-tunnel', express.json(), async (req, res) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || authHeader !== 'Bearer 6285172013920_2007') {
            return res.status(401).json({ success: false, message: 'Unauthorized access token.' })
        }

        const { tunnelUrl } = req.body
        if (!tunnelUrl) {
            return res.status(400).json({ success: false, message: 'Tunnel URL is required.' })
        }

        process.env.SUNO_API_URL = tunnelUrl.trim()
        logger.info(`[Music/TunnelSync] Suno API URL successfully updated in-memory to: ${tunnelUrl}`)

        const envPath = path.resolve('./.env')
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8')
            const regex = /^SUNO_API_URL=.*$/m
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `SUNO_API_URL=${tunnelUrl}`)
            } else {
                envContent += `\nSUNO_API_URL=${tunnelUrl}`
            }
            fs.writeFileSync(envPath, envContent, 'utf8')
            logger.info('[Music/TunnelSync] Suno API URL successfully written to .env file.')
        }

        res.json({
            success: true,
            message: 'Suno API Tunnel URL successfully synchronized.'
        })
    } catch (err) {
        logger.error(`[Music/TunnelSync] Error: ${err.message}`)
        res.status(500).json({ success: false, message: err.message })
    }
})

export default router
