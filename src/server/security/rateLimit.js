// src/server/security/rateLimit.js
// Lightweight in-memory sliding-window rate limiter middleware

/**
 * Creates an Express rate-limiting middleware.
 * @param {object} options
 * @param {number} [options.windowMs=300000]
 * @param {number} [options.max=10]
 * @param {(req: import('express').Request) => string} [options.keyFn]
 * @param {string} [options.message]
 */
export function createRateLimiter({
    windowMs = 5 * 60 * 1000,
    max = 10,
    keyFn = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
    message = 'Too many requests. Please try again later.'
} = {}) {
    const hits = new Map()

    const cleanupInterval = setInterval(() => {
        const now = Date.now()
        for (const [key, timestamps] of hits.entries()) {
            const valid = timestamps.filter(ts => now - ts < windowMs)
            if (valid.length === 0) {
                hits.delete(key)
            } else {
                hits.set(key, valid)
            }
        }
    }, Math.max(windowMs, 60_000))
    cleanupInterval.unref?.()

    return (req, res, next) => {
        const now = Date.now()
        const key = String(keyFn(req))
        const existing = hits.get(key) || []
        const recent = existing.filter(ts => now - ts < windowMs)

        if (recent.length >= max) {
            const oldest = recent[0]
            const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
            res.setHeader('Retry-After', String(retryAfterSec))
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMITED',
                    message,
                    retryAfterSec
                }
            })
        }

        recent.push(now)
        hits.set(key, recent)
        next()
    }
}
