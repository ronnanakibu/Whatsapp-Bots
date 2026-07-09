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

export default router
