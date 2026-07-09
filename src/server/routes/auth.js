// src/server/routes/auth.js
import express from 'express'
import crypto from 'crypto'
import { userService } from '../../services/user-v2.js'
import { authenticateJwt, normalizeUserAgent } from '../middleware/auth.js'
import { streamTokens } from '../radio.js'

const router = express.Router()

router.post('/anonymous', async (req, res) => {
    try {
        const session = await userService.registerAnonymous()
        res.json({
            success: true,
            token: session.token,
            profile: {
                id: session.user.id,
                nickname: session.user.nickname,
                avatarUrl: session.user.avatarUrl,
                isGuest: true
            }
        })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

router.post('/register', authenticateJwt, async (req, res) => {
    const { username, password } = req.body
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username dan password wajib diisi.' })
    }
    try {
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
        await userService.claimAccount(req.user.jid, username, passwordHash)
        res.json({
            success: true,
            message: 'Akun berhasil didaftarkan.'
        })
    } catch (err) {
        res.status(400).json({ success: false, error: err.message })
    }
})

router.post('/stream-token', authenticateJwt, (req, res) => {
    const userId = req.user.jid
    const userAgent = req.headers['user-agent'] || ''
    const normalizedUa = normalizeUserAgent(userAgent)
    const userAgentHash = crypto.createHash('sha256').update(normalizedUa).digest('hex')
    const token = crypto.randomUUID()
    const createdAt = Date.now()
    const expiresAt = createdAt + 300000 // 5 minutes

    const tokenObj = {
        token,
        userId,
        userAgentHash,
        createdAt,
        expiresAt,
        consumed: false
    }

    streamTokens.set(token, tokenObj)

    res.json({
        success: true,
        data: {
            token,
            expiresAt
        }
    })
})

export default router
