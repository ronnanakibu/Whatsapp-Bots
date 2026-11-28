// src/server/security/redaction.js
// Centralized secret/PII redaction and safe error serialization

const REDACTED = '[REDACTED]'

const PATTERNS = [
    // Authorization headers & Bearer tokens
    { regex: /(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replace: `$1${REDACTED}` },
    { regex: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, replace: `$1${REDACTED}` },
    // JWT tokens (header.payload.signature)
    { regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: REDACTED },
    // Known API key / token prefixes
    { regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replace: REDACTED },
    { regex: /\bgsk_[A-Za-z0-9]{20,}\b/g, replace: REDACTED },
    { regex: /\bnvapi-[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
    { regex: /\bhf_[A-Za-z0-9]{16,}\b/g, replace: REDACTED },
    { regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: REDACTED },
    // WhatsApp pairing code & QR payload strings
    { regex: /(PAIRING\s+CODE\s*:\s*)[A-Z0-9-]{4,}/gi, replace: `$1${REDACTED}` },
    // Key-value secret assignments (env/query/JSON-like)
    {
        regex: /((?:password|passwd|pwd|token|secret|jwt_secret|api_?key|suno_cookie|cookie|ptero_api_key|private_key|authorization)\s*["']?\s*[:=]\s*["']?)([^\s"',;}\]]+)/gi,
        replace: `$1${REDACTED}`
    }
]

/**
 * Redacts sensitive tokens, credentials, and pairing codes from strings or nested objects.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function redactSensitive(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value

    if (typeof value === 'string') {
        let out = value
        for (const { regex, replace } of PATTERNS) {
            out = out.replace(regex, replace)
        }
        return out
    }

    if (typeof value !== 'object') return value

    if (value instanceof Error) {
        return redactSensitive(value.message)
    }

    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
        return value.map(item => redactSensitive(item, seen))
    }

    const out = {}
    for (const [k, v] of Object.entries(value)) {
        if (/^(password|passwordhash|secret|token|cookie|apikey|api_key|jwt|qr|pairingcode)$/i.test(k)) {
            out[k] = REDACTED
        } else {
            out[k] = redactSensitive(v, seen)
        }
    }
    return out
}

/**
 * Returns a safe, redacted error message stripped of stack traces and local file paths.
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeErrorMessage(err, fallback = 'Internal server error') {
    if (!err) return fallback
    const raw = typeof err === 'string' ? err : (err.message || fallback)
    const firstLine = String(raw).split(/\r?\n/)[0]
    const scrubbedPaths = firstLine.replace(/[A-Za-z]:\\[^\s:]+|\/(?:app|home|root|var|tmp|Users)\/[^\s:]+/g, '[path]')
    return String(redactSensitive(scrubbedPaths)).slice(0, 300) || fallback
}
