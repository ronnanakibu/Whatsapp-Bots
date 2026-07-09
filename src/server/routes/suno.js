// src/server/routes/suno.js
import express from 'express'
import { startSunoPipeline, getActiveJobs } from '../../services/suno.js'
import { authenticateJwt } from '../middleware/auth.js'

const router = express.Router()

router.post('/generate', authenticateJwt, async (req, res) => {
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

router.get('/jobs', authenticateJwt, (req, res) => {
    res.json({ success: true, data: getActiveJobs() })
})

export default router
