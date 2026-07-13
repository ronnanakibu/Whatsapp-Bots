// src/server/routes/system.js
import express from 'express'
import { metricsService } from '../../services/metrics.js'
import { logger } from '../../utils/logger.js'
import { authenticateJwt } from '../middleware/auth.js'

const router = express.Router()

// SYSTEM RESTART Webhook (Bypasses Cloudflare Turnstile Panel protection)
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

router.get('/system/test-playlist', async (req, res) => {
    try {
        const { startPlaylistPipeline } = await import('../../services/suno.js')
        const jobId = await startPlaylistPipeline({
            songs: [
                {
                    audioPath: '/home/container/storage/media/tmp/uploads/7b4377d6-e2c5-4555-9db0-7a213ee269e7.m4a',
                    title: 'Test Song M4A',
                    artworkMode: 'system',
                    artworkPath: null,
                    artworkPrompt: ''
                }
            ],
            outputTitle: 'Diagnostic Test Playlist',
            playlistDescription: 'Diagnosing playlist generation direct start',
            transitionStyle: 'dissolve',
            generateMotion: false,
            vignetteMode: 'normal',
            source: 'web',
            chatId: null
        })
        res.json({ success: true, jobId })
    } catch (err) {
        logger.error(`[System/TestPlaylist] Error: ${err.message}`)
        res.status(500).json({ success: false, error: err.message, stack: err.stack })
    }
})

export default router

