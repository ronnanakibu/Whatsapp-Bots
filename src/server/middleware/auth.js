// src/server/middleware/auth.js
import crypto from 'crypto'

export const JWT_SECRET = process.env.JWT_SECRET || 'ronnbot-default-jwt-secret-key-123456!'

export function verifyJwt(token) {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const [headerB64, payloadB64, signatureB64] = parts

        const hmac = crypto.createHmac('sha256', JWT_SECRET)
        hmac.update(`${headerB64}.${payloadB64}`)
        const expectedSignature = hmac.digest('base64url')

        if (signatureB64 !== expectedSignature) {
            return null
        }

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null
        }
        return payload
    } catch (_) {
        return null
    }
}

export function normalizeUserAgent(ua) {
    const lower = (ua || '').toLowerCase().trim()
    // Normalize Android clients, players, and okhttp libraries to a single standard string
    if (lower.includes('android') || lower.includes('dalvik') || lower.includes('exoplayer') || lower.includes('stagefright') || lower.includes('okhttp')) {
        return 'android-radio-client'
    }
    // Normalize iOS clients
    if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod') || lower.includes('cfnetwork')) {
        return 'ios-radio-client'
    }
    return lower
}

export function authenticateJwt(req, res, next) {
    const isDev = process.env.NODE_ENV !== 'production'
    const bypassEnabled = process.env.DEV_BYPASS_AUTH === 'true'

    if (isDev && bypassEnabled) {
        const testJid = req.headers['x-test-jid'] || req.query.jid || '6285172013920@s.whatsapp.net'
        req.user = {
            jid: String(testJid),
            name: String(testJid).split('@')[0],
            role: 'owner'
        }
        return next()
    }

    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Header otentikasi tidak lengkap atau tidak valid.'
            }
        })
    }

    const token = authHeader.substring(7)
    const payload = verifyJwt(token)
    if (!payload || !payload.jid) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Token otentikasi tidak valid atau telah kedaluwarsa.'
            }
        })
    }

    req.user = {
        jid: payload.jid,
        name: payload.name || payload.jid.split('@')[0],
        role: payload.role || 'user'
    }
    next()
}
