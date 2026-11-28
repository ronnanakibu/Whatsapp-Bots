// src/server/routes/suno.js
import express from 'express'
import { startSunoPipeline, getActiveJobs } from '../../services/suno.js'
import { authenticateControlJwt, requirePermission } from '../middleware/auth.js'
import { PERMISSIONS } from '../security/rbac.js'
import { safeErrorMessage } from '../security/redaction.js'
import { recordAudit } from '../security/controlAuth.js'

const router = express.Router()

router.post('/generate', authenticateControlJwt, requirePermission(PERMISSIONS.CREATOR_OPERATE), async (req, res) => {
    const { prompt, title, enhance } = req.body || {}
    if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt wajib diisi.' })
    }
    try {
        const jobId = await startSunoPipeline({ prompt, title, enhance, source: 'api' })
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'suno:generate',
            target: jobId || 'suno-job',
            result: 'allowed',
            correlationId: req.id || null
        })
        res.json({ success: true, jobId })
    } catch (err) {
        res.status(500).json({ success: false, error: safeErrorMessage(err) })
    }
})

router.get('/jobs', authenticateControlJwt, requirePermission(PERMISSIONS.CREATOR_READ), (req, res) => {
    res.json({ success: true, data: getActiveJobs() })
})

export default router
