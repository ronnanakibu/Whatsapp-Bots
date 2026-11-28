// src/server/security/controlAuth.js
// Central Control Center authentication, scrypt password hashing, session revocation,
// unified JWT secret management, audit logging, and runtime settings persistence.

import crypto from 'crypto'
import { db } from '../../services/db.js'
import { logger } from '../../utils/logger.js'
import { ROLES, SCOPES, VALID_ROLES, VALID_PERMISSIONS, OWNER_ONLY_PERMISSIONS, getEffectivePermissions } from './rbac.js'
import { redactSensitive } from './redaction.js'

const WEAK_KNOWN_SECRETS = new Set([
    'ronnbot-default-jwt-secret-key-123456!',
    'ronnbot_default_jwt_secret_key_123456!',
    'make_this_a_long_random_hash',
    'secret',
    'changeme',
    'default'
])

let ephemeralDevSecrets = { control: null, radio: null }
const SESSION_TTL_SECONDS = 12 * 60 * 60 // 12 hours

// Ensure Control Center security tables exist in SQLite
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS control_users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'operator', 'viewer')),
            extra_permissions TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS control_sessions (
            jti TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY(user_id) REFERENCES control_users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_control_sessions_user ON control_sessions(user_id, revoked);

        CREATE TABLE IF NOT EXISTS security_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id TEXT,
            actor_role TEXT,
            action TEXT NOT NULL,
            target TEXT,
            result TEXT NOT NULL,
            correlation_id TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_by TEXT,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)
} catch (err) {
    logger.error('[Security/DB] Failed to initialize control security tables:', err.message)
}

/**
 * Constant-time string comparison using SHA-256 digests so lengths do not leak or throw.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
    const ha = crypto.createHash('sha256').update(a).digest()
    const hb = crypto.createHash('sha256').update(b).digest()
    return crypto.timingSafeEqual(ha, hb)
}

export function isPlaceholderSecret(secret) {
    if (!secret || typeof secret !== 'string') return true
    const s = secret.trim().toLowerCase()
    if (
        s.startsWith('replace_with_') ||
        s.startsWith('your_') ||
        s.includes('placeholder') ||
        s.includes('example') ||
        s.includes('insert_secret') ||
        s.includes('changeme')
    ) {
        return true
    }
    return WEAK_KNOWN_SECRETS.has(s)
}

export function validateDistinctProductionDualSecrets() {
    if (process.env.NODE_ENV !== 'production') return
    const ctrl = (process.env.CONTROL_JWT_SECRET || '').trim()
    const radio = (process.env.RADIO_JWT_SECRET || '').trim()

    if (!ctrl) {
        throw new Error('FATAL: CONTROL_JWT_SECRET must be explicitly set in production.')
    }
    if (!radio) {
        throw new Error('FATAL: RADIO_JWT_SECRET must be explicitly set in production.')
    }
    if (isPlaceholderSecret(ctrl) || ctrl.length < 32) {
        throw new Error('FATAL: CONTROL_JWT_SECRET contains a placeholder or weak template value in production (must be >= 32 chars).')
    }
    if (isPlaceholderSecret(radio) || radio.length < 32) {
        throw new Error('FATAL: RADIO_JWT_SECRET contains a placeholder or weak template value in production (must be >= 32 chars).')
    }
    if (timingSafeEqualStr(ctrl, radio)) {
        throw new Error('FATAL: CONTROL_JWT_SECRET and RADIO_JWT_SECRET must be distinct in production.')
    }
}

function resolveScopedJwtSecret(primaryKey, fallbackKey, scopeName) {
    validateDistinctProductionDualSecrets()
    const primaryRaw = (process.env[primaryKey] || '').trim()
    const fallbackRaw = (process.env[fallbackKey] || '').trim()

    if (process.env.NODE_ENV === 'production') {
        if (!primaryRaw) {
            throw new Error(`FATAL: ${primaryKey} must be independently configured in production (shared ${fallbackKey} fallback is disabled in production).`)
        }
        if (isPlaceholderSecret(primaryRaw) || primaryRaw.length < 32) {
            throw new Error(`FATAL: ${primaryKey} must be set to a strong secret (>= 32 chars) in production.`)
        }
        return primaryRaw
    }

    const raw = primaryRaw || fallbackRaw
    const isWeak = !raw || raw.length < 16 || isPlaceholderSecret(raw)

    if (!isWeak) {
        return raw
    }

    if (!ephemeralDevSecrets[scopeName]) {
        ephemeralDevSecrets[scopeName] = crypto.randomBytes(32).toString('hex')
        logger.warn(`[Security] ${primaryKey}/${fallbackKey} missing or weak; generated ephemeral non-production ${scopeName} secret.`)
    }
    return ephemeralDevSecrets[scopeName]
}

/**
 * Resolves Control Center JWT signing secret (`CONTROL_JWT_SECRET` with safe legacy `JWT_SECRET` fallback).
 */
export function getControlJwtSecret() {
    return resolveScopedJwtSecret('CONTROL_JWT_SECRET', 'JWT_SECRET', 'control')
}

/**
 * Resolves Public Radio JWT signing secret (`RADIO_JWT_SECRET` with safe legacy `JWT_SECRET` fallback).
 */
export function getRadioJwtSecret() {
    return resolveScopedJwtSecret('RADIO_JWT_SECRET', 'JWT_SECRET', 'radio')
}

/**
 * Unified fail-closed JWT secret resolver alias (Control scope).
 */
export function getJwtSecret() {
    return getControlJwtSecret()
}

/**
 * Hashes password using scrypt with a 16-byte per-user random salt.
 * @param {string} password
 * @returns {string}
 */
export function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('Password must be a string of at least 8 characters.')
    }
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = crypto.scryptSync(password, salt, 64).toString('hex')
    return `scrypt$${salt}$${derived}`
}

/**
 * Verifies a plaintext password against a stored scrypt$<salt>$<hash> string.
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
export function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false
    const parts = storedHash.split('$')
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false
    const [, salt, hashHex] = parts
    try {
        const expected = Buffer.from(hashHex, 'hex')
        const actual = crypto.scryptSync(password, salt, expected.length)
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    } catch {
        return false
    }
}

export function signJwtPayload(payload, secretOverride = null) {
    const secret = secretOverride || getControlJwtSecret()
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sigB64 = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url')
    return `${headerB64}.${payloadB64}.${sigB64}`
}

export function signRadioJwtPayload(payload) {
    return signJwtPayload(payload, getRadioJwtSecret())
}

export function verifyRawJwt(token, secretOverride = null) {
    if (typeof token !== 'string' || !token) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, signatureB64] = parts

    let header
    try {
        header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    } catch {
        return null
    }
    if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
        return null
    }

    let secret
    try {
        secret = secretOverride || getControlJwtSecret()
    } catch {
        return null
    }

    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url')

    if (!timingSafeEqualStr(signatureB64, expectedSig)) {
        return null
    }

    try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        if (!payload || typeof payload !== 'object') return null
        const nowSec = Math.floor(Date.now() / 1000)
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
            return null
        }
        return payload
    } catch {
        return null
    }
}

export function verifyRadioJwt(token) {
    let secret
    try {
        secret = getRadioJwtSecret()
    } catch {
        return null
    }
    return verifyRawJwt(token, secret)
}

function parseExtraPermissions(raw) {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : []
    } catch {
        return []
    }
}

export function validateGrantAuthority(grantor, targetRole, extraPermissions = []) {
    if (!grantor) return // internal / bootstrap initialization

    const isGrantorOwner = grantor.role === ROLES.OWNER
    if (targetRole === ROLES.OWNER && !isGrantorOwner) {
        throw new Error('Only an Owner can assign the Owner role.')
    }

    const grantorPerms = new Set(grantor.permissions || getEffectivePermissions(grantor))

    for (const perm of extraPermissions) {
        if (!VALID_PERMISSIONS.has(perm)) {
            throw new Error(`Unknown permission: "${perm}".`)
        }
        if (!isGrantorOwner) {
            if (OWNER_ONLY_PERMISSIONS.has(perm)) {
                throw new Error(`Permission "${perm}" is highly sensitive and can only be granted by an Owner.`)
            }
            if (!grantorPerms.has(perm)) {
                throw new Error(`Cannot delegate permission "${perm}" which is not held by the grantor.`)
            }
        }
    }
}

export function createControlUser({ username, password, role, extraPermissions = [], grantor = null }) {
    const cleanUser = String(username || '').trim()
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(cleanUser)) {
        throw new Error('Username must be 3-50 alphanumeric, dot, underscore, or dash characters.')
    }
    if (!VALID_ROLES.includes(role)) {
        throw new Error('Invalid role specified.')
    }
    if (grantor) {
        validateGrantAuthority(grantor, role, extraPermissions)
    }
    const passwordHash = hashPassword(password)
    const id = crypto.randomUUID()
    const permsJson = JSON.stringify(Array.isArray(extraPermissions) ? extraPermissions : [])

    db.prepare(`
        INSERT INTO control_users (id, username, password_hash, role, extra_permissions, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, cleanUser, passwordHash, role, permsJson)

    return {
        id,
        username: cleanUser,
        role,
        extraPermissions: Array.isArray(extraPermissions) ? extraPermissions : [],
        isActive: true
    }
}

export function authenticateControlUser(username, password) {
    const cleanUser = String(username || '').trim()
    if (!cleanUser || typeof password !== 'string' || !password) return null

    const row = db.prepare('SELECT * FROM control_users WHERE username = ?').get(cleanUser)
    if (!row || !row.is_active) return null
    if (!verifyPassword(password, row.password_hash)) return null

    const jti = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + SESSION_TTL_SECONDS

    db.prepare(`
        INSERT INTO control_sessions (jti, user_id, role, revoked, expires_at)
        VALUES (?, ?, ?, 0, ?)
    `).run(jti, row.id, row.role, expiresAt)

    const extraPermissions = parseExtraPermissions(row.extra_permissions)
    const userObj = {
        id: row.id,
        username: row.username,
        role: row.role,
        extraPermissions,
        scope: SCOPES.CONTROL,
        jti
    }

    const token = signJwtPayload({
        sub: row.id,
        username: row.username,
        role: row.role,
        scope: SCOPES.CONTROL,
        jti,
        iat: now,
        exp: expiresAt
    })

    return {
        token,
        expiresAt,
        user: {
            ...userObj,
            permissions: getEffectivePermissions(userObj)
        }
    }
}

/**
 * Validates a Control Center JWT, checking signature, scope isolation, session revocation,
 * expiration, and current server-side user role/active status.
 * @param {string} token
 * @returns {{ user?: object, error?: string, code?: string, status?: number }}
 */
export function verifyControlToken(token) {
    const payload = verifyRawJwt(token)
    if (!payload) {
        return { error: 'Invalid or expired authentication token.', code: 'UNAUTHORIZED', status: 401 }
    }

    // Strict security domain isolation: reject Radio/guest tokens on Control Center
    if (payload.scope !== SCOPES.CONTROL) {
        return { error: 'Token scope is not permitted on Control Center.', code: 'FORBIDDEN_SCOPE', status: 403 }
    }

    if (!payload.sub || !payload.jti) {
        return { error: 'Malformed control session token.', code: 'UNAUTHORIZED', status: 401 }
    }

    const now = Math.floor(Date.now() / 1000)
    const session = db.prepare('SELECT * FROM control_sessions WHERE jti = ?').get(payload.jti)
    if (!session || session.revoked || session.expires_at <= now || session.user_id !== payload.sub) {
        return { error: 'Control session has been revoked or expired.', code: 'SESSION_REVOKED', status: 401 }
    }

    const userRow = db.prepare('SELECT * FROM control_users WHERE id = ?').get(payload.sub)
    if (!userRow || !userRow.is_active) {
        return { error: 'Control user account is inactive or missing.', code: 'UNAUTHORIZED', status: 401 }
    }

    const extraPermissions = parseExtraPermissions(userRow.extra_permissions)
    const user = {
        id: userRow.id,
        username: userRow.username,
        role: userRow.role, // Resolved from DB, never trusted blindly from JWT
        extraPermissions,
        scope: SCOPES.CONTROL,
        jti: session.jti
    }

    return {
        user: {
            ...user,
            permissions: getEffectivePermissions(user)
        }
    }
}

export function revokeControlSession(jti) {
    if (!jti) return false
    const res = db.prepare('UPDATE control_sessions SET revoked = 1 WHERE jti = ?').run(jti)
    return res.changes > 0
}

export function listControlUsers() {
    const rows = db.prepare('SELECT id, username, role, extra_permissions, is_active, created_at, updated_at FROM control_users ORDER BY created_at ASC').all()
    return rows.map(r => ({
        id: r.id,
        username: r.username,
        role: r.role,
        extraPermissions: parseExtraPermissions(r.extra_permissions),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }))
}

export function getControlUserById(id) {
    const r = db.prepare('SELECT id, username, role, extra_permissions, is_active, created_at, updated_at FROM control_users WHERE id = ?').get(id)
    if (!r) return null
    return {
        id: r.id,
        username: r.username,
        role: r.role,
        extraPermissions: parseExtraPermissions(r.extra_permissions),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }
}

export function updateControlUser(id, patch = {}, grantor = null) {
    const existing = db.prepare('SELECT * FROM control_users WHERE id = ?').get(id)
    if (!existing) return null

    const nextRole = patch.role !== undefined ? patch.role : existing.role
    if (!VALID_ROLES.includes(nextRole)) {
        throw new Error('Invalid role.')
    }
    const nextActive = patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.is_active
    const nextExtraArray = patch.extraPermissions !== undefined
        ? (Array.isArray(patch.extraPermissions) ? patch.extraPermissions : [])
        : parseExtraPermissions(existing.extra_permissions)

    if (grantor) {
        validateGrantAuthority(grantor, nextRole, nextExtraArray)
    }

    // Last-Owner protection: Prevent demoting or deactivating the last active owner
    if (existing.role === ROLES.OWNER) {
        const isDemoting = nextRole !== ROLES.OWNER
        const isDeactivating = nextActive === 0
        if (isDemoting || isDeactivating) {
            const row = db.prepare('SELECT COUNT(*) as count FROM control_users WHERE role = ? AND is_active = 1').get(ROLES.OWNER)
            const activeOwners = row?.count || 0
            if (activeOwners <= 1) {
                throw new Error('Cannot demote or deactivate the last remaining active Owner.')
            }
        }
    }

    const nextExtra = JSON.stringify(nextExtraArray)
    const nextHash = patch.password ? hashPassword(patch.password) : existing.password_hash

    db.prepare(`
        UPDATE control_users
        SET role = ?, is_active = ?, extra_permissions = ?, password_hash = ?, updated_at = unixepoch()
        WHERE id = ?
    `).run(nextRole, nextActive, nextExtra, nextHash, id)

    // Revoke sessions if role, active status, or extra permissions changed
    const permissionsChanged = nextExtra !== existing.extra_permissions
    if (!nextActive || nextRole !== existing.role || permissionsChanged) {
        db.prepare('UPDATE control_sessions SET revoked = 1 WHERE user_id = ?').run(id)
    }

    return getControlUserById(id)
}

export function recordAudit({ actorId = null, actorRole = null, action, target = null, result = 'allowed', correlationId = null, metadata = null }) {
    try {
        const safeMeta = metadata ? JSON.stringify(redactSensitive(metadata)) : null
        const safeTarget = target ? String(redactSensitive(String(target))).slice(0, 255) : null
        db.prepare(`
            INSERT INTO security_audit_logs (actor_id, actor_role, action, target, result, correlation_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(actorId, actorRole, String(action), safeTarget, String(result), correlationId, safeMeta)
    } catch (err) {
        logger.warn(`[Security/Audit] Failed to record audit event: ${err.message}`)
    }
}

export function getAuditLogs(limit = 100) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500)
    const rows = db.prepare('SELECT * FROM security_audit_logs ORDER BY id DESC LIMIT ?').all(safeLimit)
    return rows.map(r => ({
        id: r.id,
        actorId: r.actor_id,
        actorRole: r.actor_role,
        action: r.action,
        target: r.target,
        result: r.result,
        correlationId: r.correlation_id,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata) } catch { return null } })() : null,
        createdAt: r.created_at
    }))
}

export function setAppSetting(key, value, updatedBy = null) {
    db.prepare(`
        INSERT INTO app_settings (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = unixepoch()
    `).run(String(key), String(value), updatedBy)
}

export function getAppSetting(key) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(String(key))
    return row ? row.value : null
}

/**
 * Bootstraps an initial Owner account ONLY if zero owners exist and explicit env credentials
 * (CONTROL_OWNER_USERNAME + CONTROL_OWNER_PASSWORD) are provided. Never uses default passwords.
 */
export function bootstrapOwnerFromEnv() {
    try {
        const ownerCount = db.prepare("SELECT COUNT(*) as count FROM control_users WHERE role = 'owner'").get().count
        if (ownerCount > 0) return false

        const username = (process.env.CONTROL_OWNER_USERNAME || '').trim()
        const password = process.env.CONTROL_OWNER_PASSWORD || ''
        if (!username || !password) {
            logger.warn('[Security] No Control Center owner account exists. Set CONTROL_OWNER_USERNAME and CONTROL_OWNER_PASSWORD to bootstrap an initial owner.')
            return false
        }

        createControlUser({ username, password, role: ROLES.OWNER })
        logger.info(`[Security] Bootstrapped initial Control Center owner account: ${username}`)
        return true
    } catch (err) {
        logger.error('[Security] Owner bootstrap failed:', err.message)
        return false
    }
}
