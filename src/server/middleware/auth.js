// src/server/middleware/auth.js
import { getControlJwtSecret, getRadioJwtSecret, verifyRadioJwt, verifyControlToken, recordAudit } from '../security/controlAuth.js'
import { hasPermission } from '../security/rbac.js'

export function verifyJwt(token) {
    return verifyRadioJwt(token)
}

export function getActiveJwtSecret() {
    return getRadioJwtSecret()
}

export function getActiveControlJwtSecret() {
    return getControlJwtSecret()
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

function isLoopbackIp(ip = '') {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/**
 * Public Radio / Listener JWT authentication middleware.
 * Isolated from Control Center RBAC: must NOT be used to authorize administrative endpoints.
 */
export function authenticateJwt(req, res, next) {
    const isDev = process.env.NODE_ENV === 'development'
    const bypassEnabled = process.env.DEV_BYPASS_AUTH === 'true'
    const remoteIp = req.ip || req.socket?.remoteAddress || ''

    if (isDev && bypassEnabled && isLoopbackIp(remoteIp)) {
        const testJid = req.headers['x-test-jid'] || req.query.jid || 'dev-listener@s.whatsapp.net'
        req.user = {
            jid: String(testJid),
            name: String(testJid).split('@')[0],
            role: 'user',
            scope: 'radio'
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

    const token = authHeader.substring(7).trim()
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
        role: payload.role || 'user',
        scope: payload.scope || 'radio'
    }
    next()
}

export function optionalJwt(req, res, next) {
    const authHeader = req.headers['authorization']
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim()
        const payload = verifyJwt(token)
        if (payload && payload.jid) {
            req.user = {
                jid: payload.jid,
                name: payload.name || payload.jid.split('@')[0],
                role: payload.role || 'user',
                scope: payload.scope || 'radio'
            }
            return next()
        }
    }
    const testJid = req.headers['x-test-jid'] || req.query.jid || req.body?.userJid || 'web-listener@s.whatsapp.net'
    req.user = {
        jid: String(testJid),
        name: 'Web Listener',
        role: 'guest',
        scope: 'radio'
    }
    next()
}

/**
 * Private Control Center JWT authentication middleware.
 * Rejects unauthenticated requests (401) and Radio/guest tokens (403).
 */
export function authenticateControlJwt(req, res, next) {
    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Control Center authentication required.'
            }
        })
    }

    const token = authHeader.substring(7).trim()
    const result = verifyControlToken(token)
    if (!result.user) {
        return res.status(result.status || 401).json({
            success: false,
            error: {
                code: result.code || 'UNAUTHORIZED',
                message: result.error || 'Authentication failed.'
            }
        })
    }

    req.controlUser = result.user
    next()
}

/**
 * Enforces a specific Control Center RBAC permission (default-deny).
 * @param {string} permission
 */
export function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.controlUser) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
            })
        }

        if (!hasPermission(req.controlUser, permission)) {
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: `http:${req.method}:${req.originalUrl || req.url}`,
                target: permission,
                result: 'denied',
                correlationId: req.id || null
            })
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: `Insufficient permissions: ${permission} required.`
                }
            })
        }

        next()
    }
}

/**
 * Enforces that the authenticated Control Center user holds at least one of the listed permissions.
 * @param {string[]} permissions
 */
export function requireAnyPermission(permissions) {
    return (req, res, next) => {
        if (!req.controlUser) {
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
            })
        }

        const allowed = permissions.some(p => hasPermission(req.controlUser, p))
        if (!allowed) {
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: `http:${req.method}:${req.originalUrl || req.url}`,
                target: permissions.join('|'),
                result: 'denied',
                correlationId: req.id || null
            })
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Insufficient permissions.'
                }
            })
        }

        next()
    }
}

/**
 * Requires explicit confirmation boolean for destructive or high-impact mutations.
 */
export function requireConfirmation(req, res, next) {
    if (req.body?.confirm !== true) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'CONFIRMATION_REQUIRED',
                message: 'Explicit confirmation ({ confirm: true }) is required for this operation.'
            }
        })
    }
    next()
}
