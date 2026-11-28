// src/server/routes/control.js
// Dedicated private Control Center authentication, user/role management, audit log,
// and read-only database metadata routes (/api/v2/control/*).

import express from 'express'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { db } from '../../services/db.js'
import { metricsService } from '../../services/metrics.js'
import { memoryService } from '../../services/memory.js'
import { moderatorService } from '../../services/moderator.js'
import { inboxService, INBOX_MAX_MEDIA_BYTES } from '../../services/inbox.js'
import { commands, getAllCommands } from '../../core/registry.js'
import { eventBus } from '../../events/bus.js'
import { getSocket } from '../../utils/logger.js'
import { buildAiProviderTelemetry, buildControlAnalyticsSnapshot, buildControlMetricsSnapshot } from '../telemetry.js'
import { getPairingSnapshot, getWhatsAppStatusSnapshot } from '../whatsappOps.js'
import { authenticateControlJwt, requirePermission } from '../middleware/auth.js'
import { PERMISSIONS, ROLES, isValidRole } from '../security/rbac.js'
import { createRateLimiter } from '../security/rateLimit.js'
import {
    authenticateControlUser,
    createControlUser,
    getAuditLogs,
    getControlUserById,
    listControlUsers,
    recordAudit,
    revokeControlSession,
    updateControlUser
} from '../security/controlAuth.js'
import { safeErrorMessage } from '../security/redaction.js'

const router = express.Router()

const loginRateLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: Number(process.env.CONTROL_LOGIN_MAX_ATTEMPTS || 10),
    message: 'Too many login attempts. Please wait before trying again.'
})

// POST /api/v2/control/auth/login
router.post('/auth/login', loginRateLimiter, (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'Username and password are required.' }
        })
    }

    const session = authenticateControlUser(username, password)
    if (!session) {
        recordAudit({
            actorId: null,
            actorRole: null,
            action: 'control:auth:login',
            target: String(username),
            result: 'denied',
            correlationId: req.id || null
        })
        return res.status(401).json({
            success: false,
            error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }
        })
    }

    recordAudit({
        actorId: session.user.id,
        actorRole: session.user.role,
        action: 'control:auth:login',
        target: session.user.username,
        result: 'allowed',
        correlationId: req.id || null
    })

    return res.json({
        success: true,
        data: {
            token: session.token,
            expiresAt: session.expiresAt,
            user: {
                id: session.user.id,
                username: session.user.username,
                role: session.user.role,
                permissions: session.user.permissions
            }
        }
    })
})

// POST /api/v2/control/auth/logout
router.post('/auth/logout', authenticateControlJwt, (req, res) => {
    revokeControlSession(req.controlUser.jti)
    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:auth:logout',
        target: req.controlUser.username,
        result: 'allowed',
        correlationId: req.id || null
    })
    return res.json({ success: true, message: 'Session revoked.' })
})

// GET /api/v2/control/auth/me
router.get('/auth/me', authenticateControlJwt, (req, res) => {
    return res.json({
        success: true,
        data: {
            user: {
                id: req.controlUser.id,
                username: req.controlUser.username,
                role: req.controlUser.role,
                scope: req.controlUser.scope,
                permissions: req.controlUser.permissions
            }
        }
    })
})

// GET /api/v2/control/users
router.get('/users', authenticateControlJwt, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
    return res.json({
        success: true,
        data: { users: listControlUsers() }
    })
})

// POST /api/v2/control/users
router.post('/users', authenticateControlJwt, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
    const { username, password, role, extraPermissions } = req.body || {}
    if (!username || !password || !role) {
        return res.status(400).json({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'username, password, and role are required.' }
        })
    }
    if (!isValidRole(role)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_ROLE', message: 'Unsupported role.' }
        })
    }
    if (role === ROLES.OWNER && req.controlUser.role !== ROLES.OWNER) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:users:create',
            target: username,
            result: 'denied',
            correlationId: req.id || null,
            metadata: { reason: 'non-owner attempted owner creation' }
        })
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only an Owner can create another Owner.' }
        })
    }

    try {
        const created = createControlUser({ username, password, role, extraPermissions, grantor: req.controlUser })
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:users:create',
            target: created.id,
            result: 'allowed',
            correlationId: req.id || null,
            metadata: { role: created.role }
        })
        return res.status(201).json({ success: true, data: { user: created } })
    } catch (err) {
        return res.status(400).json({
            success: false,
            error: { code: 'USER_CREATE_FAILED', message: safeErrorMessage(err, 'Failed to create user.') }
        })
    }
})

// PATCH /api/v2/control/users/:id
router.patch('/users/:id', authenticateControlJwt, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
    const target = getControlUserById(req.params.id)
    if (!target) {
        return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Control user not found.' }
        })
    }

    const { role, isActive, extraPermissions, password } = req.body || {}
    if (role !== undefined && !isValidRole(role)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_ROLE', message: 'Unsupported role.' }
        })
    }

    // Prevent non-owners from modifying owners or escalating any account to owner
    if ((target.role === ROLES.OWNER || role === ROLES.OWNER) && req.controlUser.role !== ROLES.OWNER) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:users:update',
            target: target.id,
            result: 'denied',
            correlationId: req.id || null,
            metadata: { reason: 'owner escalation or target protection' }
        })
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only an Owner can modify Owner accounts or assign Owner role.' }
        })
    }

    try {
        const updated = updateControlUser(target.id, { role, isActive, extraPermissions, password }, req.controlUser)
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:users:update',
            target: target.id,
            result: 'allowed',
            correlationId: req.id || null
        })
        return res.json({ success: true, data: { user: updated } })
    } catch (err) {
        return res.status(400).json({
            success: false,
            error: { code: 'USER_UPDATE_FAILED', message: safeErrorMessage(err, 'Failed to update user.') }
        })
    }
})

// GET /api/v2/control/audit
router.get('/audit', authenticateControlJwt, requirePermission(PERMISSIONS.AUDIT_READ), (req, res) => {
    return res.json({
        success: true,
        data: { logs: getAuditLogs(req.query.limit) }
    })
})

// GET /api/v2/control/metrics (Truthful overview telemetry with explicit provenance)
router.get('/metrics', authenticateControlJwt, requirePermission(PERMISSIONS.OVERVIEW_READ), (req, res) => {
    const dbPath = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
    let dbSizeBytes = null
    let usersCount = null
    try { dbSizeBytes = fs.statSync(dbPath).size } catch {}
    try { usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count } catch {}

    return res.json({
        success: true,
        data: {
            metrics: buildControlMetricsSnapshot({
                db,
                metricsService,
                usersCount,
                dbSizeBytes
            }),
            analytics: buildControlAnalyticsSnapshot({ metricsService })
        }
    })
})

// GET /api/v2/control/ai/health (Real orchestrator providerHealth state, zero secrets)
router.get('/ai/health', authenticateControlJwt, requirePermission(PERMISSIONS.AI_HEALTH_READ), (req, res) => {
    return res.json({
        success: true,
        data: buildAiProviderTelemetry()
    })
})

// GET /api/v2/control/db/tables (Safe read-only metadata replacement for arbitrary db:query)
router.get('/db/tables', authenticateControlJwt, requirePermission(PERMISSIONS.DB_METADATA_READ), (req, res) => {
    try {
        const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all()
        const tables = tableRows.map(({ name }) => {
            const safeIdent = `"${String(name).replace(/"/g, '""')}"`
            let rowCount = null
            try {
                rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${safeIdent}`).get().count
            } catch {
                rowCount = null
            }
            return { name, rowCount }
        })
        return res.json({
            success: true,
            data: { engine: 'sqlite', readOnly: true, tables }
        })
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'DB_METADATA_ERROR', message: safeErrorMessage(err) }
        })
    }
})

// ─────────────────────────────────────────────
// PHASE 1A — WHATSAPP OPERATIONS ROUTES
// ─────────────────────────────────────────────

const GROUP_JID_REGEX = /^\d{5,25}(?:-\d{1,15})?@g\.us$/

function normalizeJidPhone(jid = '') {
    return String(jid || '').split('@')[0].split(':')[0].trim()
}

function readGroupDbConfigMap() {
    const dbConfigs = {}
    if (!db) return dbConfigs
    try {
        const rows = db.prepare(`
            SELECT
                c.chat_id as id,
                c.persona,
                c.ai_enabled,
                c.ai_provider,
                m.enabled as mod_enabled,
                m.max_warnings
            FROM chat_config c
            LEFT JOIN moderation_config m ON c.chat_id = m.chat_id
            WHERE c.chat_id LIKE '%@g.us'
        `).all()
        for (const row of rows) {
            dbConfigs[row.id] = row
        }
    } catch {
        // Ignore if optional config tables are unpopulated
    }
    return dbConfigs
}

// GET /api/v2/control/whatsapp/status
router.get('/whatsapp/status', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_STATUS_READ), (req, res) => {
    return res.json({
        success: true,
        data: getWhatsAppStatusSnapshot()
    })
})

// GET /api/v2/control/whatsapp/pairing
router.get('/whatsapp/pairing', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_PAIRING_READ), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
    const pairing = await getPairingSnapshot()
    // Audit pairing access without ever recording QR strings or pairing codes
    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:pairing:read',
        target: 'whatsapp_pairing',
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            state: pairing.state,
            hasQr: pairing.hasQr,
            hasPairingCode: pairing.hasPairingCode,
            expired: pairing.expired
        }
    })
    return res.json({
        success: true,
        data: pairing
    })
})

// GET /api/v2/control/whatsapp/groups
router.get('/whatsapp/groups', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUPS_READ), async (req, res) => {
    const sock = getSocket()
    const statusSnap = getWhatsAppStatusSnapshot(sock)
    let groupsMeta = {}
    let liveMetadataLoaded = false

    if (sock && typeof sock.groupFetchAllParticipating === 'function') {
        try {
            groupsMeta = (await sock.groupFetchAllParticipating()) || {}
            liveMetadataLoaded = true
        } catch {
            groupsMeta = {}
            liveMetadataLoaded = false
        }
    }

    const dbConfigs = readGroupDbConfigMap()
    const botPhone = normalizeJidPhone(sock?.user?.id)
    const allJids = new Set([...Object.keys(groupsMeta), ...Object.keys(dbConfigs)])

    const groups = Array.from(allJids).map((chatId) => {
        const meta = groupsMeta[chatId] || null
        const dbConf = dbConfigs[chatId] || null
        const participants = Array.isArray(meta?.participants) ? meta.participants : []
        const botParticipant = botPhone
            ? participants.find(p => normalizeJidPhone(p?.id) === botPhone)
            : null

        return {
            chatId,
            name: meta?.subject || chatId.split('@')[0],
            desc: typeof meta?.desc === 'string' && meta.desc.trim() ? meta.desc : null,
            members: typeof meta?.size === 'number' ? meta.size : participants.length,
            botIsMember: Boolean(meta && (botParticipant || !botPhone)),
            botIsAdmin: Boolean(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin')),
            announce: typeof meta?.announce === 'boolean' ? meta.announce : null,
            restrict: typeof meta?.restrict === 'boolean' ? meta.restrict : null,
            aiEnabled: dbConf ? Boolean(dbConf.ai_enabled) : false,
            moderationEnabled: dbConf ? Boolean(dbConf.mod_enabled) : false,
            aiProvider: dbConf?.ai_provider || 'groq',
            maxWarnings: dbConf?.max_warnings ?? 3,
            metadataAvailable: Boolean(meta)
        }
    })

    return res.json({
        success: true,
        data: {
            connected: statusSnap.connected,
            liveMetadataLoaded,
            groups,
            timestamp: Date.now()
        }
    })
})

// PATCH /api/v2/control/whatsapp/groups/:chatId
router.patch('/whatsapp/groups/:chatId', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_GROUP_CONFIG), async (req, res) => {
    const chatId = String(req.params.chatId || '').trim()
    if (!GROUP_JID_REGEX.test(chatId)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_GROUP_JID', message: 'Valid WhatsApp group JID (@g.us) is required.' }
        })
    }

    const { aiEnabled, moderationEnabled, subject, description } = req.body || {}
    const hasAiToggle = aiEnabled !== undefined
    const hasModToggle = moderationEnabled !== undefined
    const hasSubject = subject !== undefined
    const hasDescription = description !== undefined

    if (!hasAiToggle && !hasModToggle && !hasSubject && !hasDescription) {
        return res.status(400).json({
            success: false,
            error: { code: 'BAD_REQUEST', message: 'At least one group configuration field is required.' }
        })
    }
    if (hasAiToggle && typeof aiEnabled !== 'boolean') {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'aiEnabled must be a boolean.' }
        })
    }
    if (hasModToggle && typeof moderationEnabled !== 'boolean') {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'moderationEnabled must be a boolean.' }
        })
    }
    if (hasSubject && (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 100)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_SUBJECT', message: 'Group subject must be 1-100 characters.' }
        })
    }
    if (hasDescription && (typeof description !== 'string' || description.length > 2048)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_DESCRIPTION', message: 'Group description must be a string up to 2048 characters.' }
        })
    }

    if (hasSubject || hasDescription) {
        const sock = getSocket()
        if (!sock) {
            return res.status(503).json({
                success: false,
                error: { code: 'WHATSAPP_OFFLINE', message: 'WhatsApp connection is offline.' }
            })
        }

        let groupMeta = null
        try {
            if (typeof sock.groupMetadata === 'function') {
                groupMeta = await sock.groupMetadata(chatId)
            } else if (typeof sock.groupFetchAllParticipating === 'function') {
                const all = await sock.groupFetchAllParticipating()
                groupMeta = all?.[chatId] || null
            }
        } catch (err) {
            return res.status(502).json({
                success: false,
                error: { code: 'WHATSAPP_API_ERROR', message: safeErrorMessage(err, 'Failed to inspect target group metadata.') }
            })
        }

        if (!groupMeta) {
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'control:whatsapp:group:config',
                target: chatId,
                result: 'denied',
                correlationId: req.id || null,
                metadata: { reason: 'bot_not_in_group' }
            })
            return res.status(404).json({
                success: false,
                error: { code: 'BOT_NOT_IN_GROUP', message: 'Bot is not a member of the target group or group was not found.' }
            })
        }

        const botPhone = normalizeJidPhone(sock?.user?.id)
        const participants = Array.isArray(groupMeta.participants) ? groupMeta.participants : []
        const botParticipant = botPhone
            ? participants.find(p => normalizeJidPhone(p?.id) === botPhone)
            : null

        if (botPhone && !botParticipant) {
            return res.status(403).json({
                success: false,
                error: { code: 'BOT_NOT_IN_GROUP', message: 'Bot account is not a participant of this group.' }
            })
        }

        const botIsAdmin = Boolean(botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin'))
        if (!botIsAdmin) {
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'control:whatsapp:group:config',
                target: chatId,
                result: 'denied',
                correlationId: req.id || null,
                metadata: { reason: 'bot_lacks_group_admin' }
            })
            return res.status(403).json({
                success: false,
                error: { code: 'BOT_NOT_GROUP_ADMIN', message: 'Bot requires group admin privileges to update group subject or description.' }
            })
        }

        try {
            if (hasSubject) {
                await sock.groupUpdateSubject(chatId, subject.trim())
            }
            if (hasDescription) {
                await sock.groupUpdateDescription(chatId, description)
            }
        } catch (err) {
            recordAudit({
                actorId: req.controlUser.id,
                actorRole: req.controlUser.role,
                action: 'control:whatsapp:group:config',
                target: chatId,
                result: 'failed',
                correlationId: req.id || null,
                metadata: { reason: 'baileys_mutation_failed' }
            })
            return res.status(502).json({
                success: false,
                error: { code: 'WHATSAPP_API_ERROR', message: safeErrorMessage(err, 'WhatsApp failed to update group configuration.') }
            })
        }
    }

    if (hasAiToggle) {
        memoryService.setAiEnabled(chatId, aiEnabled)
    }
    if (hasModToggle) {
        await moderatorService.setModerationEnabled(chatId, moderationEnabled)
    }

    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:group:config',
        target: chatId,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            ...(hasAiToggle ? { aiEnabled } : {}),
            ...(hasModToggle ? { moderationEnabled } : {}),
            ...(hasSubject ? { subjectUpdated: true } : {}),
            ...(hasDescription ? { descriptionUpdated: true } : {})
        }
    })

    eventBus.emitEvent('control:groups:update', { chatId })

    return res.json({
        success: true,
        data: {
            chatId,
            ...(hasAiToggle ? { aiEnabled } : {}),
            ...(hasModToggle ? { moderationEnabled } : {}),
            ...(hasSubject ? { subject: subject.trim() } : {}),
            ...(hasDescription ? { description } : {})
        }
    })
})

// GET /api/v2/control/whatsapp/commands
router.get('/whatsapp/commands', authenticateControlJwt, requirePermission(PERMISSIONS.COMMANDS_READ), (req, res) => {
    const uniqueCmds = Array.from(getAllCommands().values())
    const items = uniqueCmds.map((cmd) => ({
        name: cmd.name,
        category: cmd.category || 'general',
        description: cmd.description || '',
        aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
        permissions: Array.isArray(cmd.permissions) ? cmd.permissions : ['user'],
        enabled: cmd.enabled !== false,
        cooldown: cmd.cooldown ?? 3
    }))

    return res.json({
        success: true,
        data: {
            total: items.length,
            persistence: 'in-memory',
            persistenceNote: 'Command enable/disable state operates on the active process registry and resets to module defaults upon restart.',
            commands: items
        }
    })
})

// PATCH /api/v2/control/whatsapp/commands/:name
router.patch('/whatsapp/commands/:name', authenticateControlJwt, requirePermission(PERMISSIONS.COMMANDS_TOGGLE), (req, res) => {
    const name = String(req.params.name || '').trim().toLowerCase()
    const { enabled } = req.body || {}
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'enabled must be a boolean.' }
        })
    }

    const cmd = commands.get(name)
    if (!cmd) {
        return res.status(404).json({
            success: false,
            error: { code: 'COMMAND_NOT_FOUND', message: `Command "${name}" not found.` }
        })
    }

    const perms = Array.isArray(cmd.permissions) ? cmd.permissions : []
    if (perms.includes('owner') && req.controlUser.role !== ROLES.OWNER) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:commands:toggle',
            target: cmd.name,
            result: 'denied',
            correlationId: req.id || null,
            metadata: { reason: 'owner_command_toggle_restricted' }
        })
        return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only Owner can toggle owner-scoped commands.' }
        })
    }

    cmd.enabled = enabled
    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:commands:toggle',
        target: cmd.name,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: { enabled }
    })
    eventBus.emitEvent('control:commands:update', { name: cmd.name, enabled })

    return res.json({
        success: true,
        data: {
            name: cmd.name,
            category: cmd.category || 'general',
            enabled: cmd.enabled,
            persistence: 'in-memory'
        }
    })
})

// ─────────────────────────────────────────────
// PHASE 1B — WHATSAPP INBOX & MANUAL MESSAGING ROUTES
// ─────────────────────────────────────────────

const inboxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: INBOX_MAX_MEDIA_BYTES }
})

function handleInboxMediaUpload(req, res, next) {
    inboxUpload.single('file')(req, res, (err) => {
        if (!err) return next()
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: {
                    code: 'MEDIA_TOO_LARGE',
                    message: `File exceeds max upload limit of ${Math.round(INBOX_MAX_MEDIA_BYTES / (1024 * 1024))}MB.`
                }
            })
        }
        return res.status(400).json({
            success: false,
            error: { code: 'UPLOAD_ERROR', message: safeErrorMessage(err, 'Invalid file upload.') }
        })
    })
}

// GET /api/v2/control/whatsapp/inbox/conversations
router.get('/whatsapp/inbox/conversations', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_READ), (req, res) => {
    const result = inboxService.listConversations({
        controlUserId: req.controlUser.id,
        q: req.query.q ? String(req.query.q) : '',
        unreadOnly: req.query.unreadOnly === 'true',
        chatType: req.query.chatType ? String(req.query.chatType) : 'all',
        before: req.query.before ? Number(req.query.before) : null,
        limit: req.query.limit ? Number(req.query.limit) : 30
    })
    return res.json({ success: true, data: result })
})

// GET /api/v2/control/whatsapp/inbox/conversations/:chatId/messages
router.get('/whatsapp/inbox/conversations/:chatId/messages', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_READ), (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    if (!inboxService.isSupportedInboxJid(chatId)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
        })
    }
    const timeline = inboxService.getTimeline({
        chatJid: chatId,
        beforeId: req.query.beforeId ? Number(req.query.beforeId) : null,
        limit: req.query.limit ? Number(req.query.limit) : 50
    })
    return res.json({ success: true, data: timeline })
})

// POST /api/v2/control/whatsapp/inbox/conversations/:chatId/read
router.post('/whatsapp/inbox/conversations/:chatId/read', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_READ), (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    if (!inboxService.isSupportedInboxJid(chatId)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
        })
    }
    const result = inboxService.markConversationRead(req.controlUser.id, chatId)
    return res.json({ success: true, data: result })
})

// POST /api/v2/control/whatsapp/inbox/conversations/:chatId/messages
router.post('/whatsapp/inbox/conversations/:chatId/messages', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_OPERATE), async (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    const { text, idempotencyKey } = req.body || {}
    const outcome = await inboxService.sendManualText({
        sock: getSocket(),
        controlUserId: req.controlUser.id,
        chatJid: chatId,
        text,
        idempotencyKey
    })

    if (outcome.errorStatus) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:inbox:send_text',
            target: chatId,
            result: 'failed',
            correlationId: req.id || null,
            metadata: { code: outcome.code }
        })
        return res.status(outcome.errorStatus).json({
            success: false,
            error: { code: outcome.code, message: outcome.message }
        })
    }

    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:inbox:send_text',
        target: chatId,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            messageId: outcome.data.messageId,
            deduplicated: outcome.deduplicated
        }
    })

    return res.json({
        success: true,
        deduplicated: outcome.deduplicated,
        data: outcome.data
    })
})

// POST /api/v2/control/whatsapp/inbox/conversations/:chatId/media
router.post('/whatsapp/inbox/conversations/:chatId/media', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_OPERATE), handleInboxMediaUpload, async (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : ''
    const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : ''

    const outcome = await inboxService.sendManualMedia({
        sock: getSocket(),
        controlUserId: req.controlUser.id,
        chatJid: chatId,
        file: req.file,
        caption,
        idempotencyKey
    })

    if (outcome.errorStatus) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:inbox:send_media',
            target: chatId,
            result: 'failed',
            correlationId: req.id || null,
            metadata: { code: outcome.code }
        })
        return res.status(outcome.errorStatus).json({
            success: false,
            error: { code: outcome.code, message: outcome.message }
        })
    }

    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:inbox:send_media',
        target: chatId,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            messageId: outcome.data.messageId,
            mediaId: outcome.data.mediaId,
            deduplicated: outcome.deduplicated
        }
    })

    return res.json({
        success: true,
        deduplicated: outcome.deduplicated,
        data: outcome.data
    })
})

// GET /api/v2/control/whatsapp/inbox/media/:mediaId
router.get('/whatsapp/inbox/media/:mediaId', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_READ), (req, res) => {
    const mediaRecord = inboxService.getMediaRecord(req.params.mediaId)
    if (!mediaRecord) {
        return res.status(404).json({
            success: false,
            error: { code: 'MEDIA_NOT_FOUND', message: 'Media file not found or unavailable.' }
        })
    }

    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Type', mediaRecord.mime_type)
    res.setHeader('Content-Disposition', `inline; filename="${mediaRecord.original_name || mediaRecord.storage_filename}"`)
    return res.sendFile(mediaRecord.filePath)
})

// ─────────────────────────────────────────────
// PHASE 1C — HUMAN TAKEOVER ROUTES
// ─────────────────────────────────────────────

function resolveTakeoverHttpWaitMs(req) {
    const headerVal = req.headers?.['x-takeover-wait-ms']
    if (headerVal !== undefined) {
        const parsedHeader = Number(headerVal)
        if (Number.isFinite(parsedHeader) && parsedHeader >= 20 && parsedHeader <= 30000) {
            return Math.floor(parsedHeader)
        }
    }
    const envVal = Number(process.env.TAKEOVER_HTTP_WAIT_MS)
    if (Number.isFinite(envVal) && envVal >= 50 && envVal <= 60000) {
        return Math.floor(envVal)
    }
    return 15000
}

async function awaitWithBoundedHttpWait(opPromise, waitMs) {
    let timer = null
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), waitMs)
        timer.unref?.()
    })
    const wrappedOp = Promise.resolve(opPromise).then((value) => ({ settled: true, value }))
    wrappedOp.catch(() => {})
    try {
        return await Promise.race([wrappedOp, timeoutPromise])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

// GET /api/v2/control/whatsapp/inbox/conversations/:chatId/takeover
router.get('/whatsapp/inbox/conversations/:chatId/takeover', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_INBOX_READ), async (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    if (!inboxService.isSupportedInboxJid(chatId)) {
        return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CHAT_JID', message: 'Unsupported or invalid WhatsApp chat JID.' }
        })
    }

    const lock = inboxService.getConversationLockState(chatId)
    const state = lock.locked
        ? inboxService.getTakeoverState(chatId, { skipExpiryMutation: true })
        : await inboxService.reconcileTakeoverExpiry(chatId)

    return res.json({ success: true, data: state, lock })
})

// POST /api/v2/control/whatsapp/inbox/conversations/:chatId/takeover
router.post('/whatsapp/inbox/conversations/:chatId/takeover', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_TAKEOVER), async (req, res) => {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    const { ttlMinutes, reason, force } = req.body || {}
    const parsedTtl = ttlMinutes === undefined || ttlMinutes === null || ttlMinutes === '' ? null : Number(ttlMinutes)

    const waitMs = resolveTakeoverHttpWaitMs(req)
    let raceOutcome
    try {
        raceOutcome = await awaitWithBoundedHttpWait(
            inboxService.activateTakeover({
                chatJid: chatId,
                actor: req.controlUser,
                ttlMinutes: parsedTtl,
                reason: reason || '',
                force: force === true
            }),
            waitMs
        )
    } catch (err) {
        const status = err?.code === 'CONVERSATION_QUEUE_FULL' ? 503 : 500
        return res.status(status).json({
            success: false,
            error: { code: err?.code || 'TAKEOVER_FAILED', message: err?.message || 'Takeover request failed.' }
        })
    }

    if (!raceOutcome.settled) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:takeover:activate',
            target: chatId,
            result: 'pending',
            correlationId: req.id || null,
            metadata: { code: 'TAKEOVER_PENDING_INFLIGHT_SEND', waitMs, force: force === true }
        })
        return res.status(202).json({
            success: false,
            pending: true,
            error: {
                code: 'TAKEOVER_PENDING_INFLIGHT_SEND',
                message: 'An in-flight WhatsApp send is still settling; takeover transition is queued and not yet confirmed. Query takeover state to reconcile.'
            },
            data: {
                chatId,
                pending: true,
                lock: inboxService.getConversationLockState(chatId),
                currentTakeover: inboxService.getTakeoverState(chatId, { skipExpiryMutation: true })
            }
        })
    }

    const outcome = raceOutcome.value
    if (outcome.errorStatus) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:takeover:activate',
            target: chatId,
            result: outcome.errorStatus === 409 ? 'denied' : 'failed',
            correlationId: req.id || null,
            metadata: {
                code: outcome.code,
                previousState: outcome.previousState || null,
                previousOwnerUserId: outcome.previousOwnerUserId || null,
                previousOwnerUsername: outcome.previousOwnerUsername || null,
                force: force === true
            }
        })
        return res.status(outcome.errorStatus).json({
            success: false,
            error: { code: outcome.code, message: outcome.message }
        })
    }

    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:takeover:activate',
        target: chatId,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            previousState: outcome.previousState || null,
            newState: outcome.takeover.state,
            previousOwnerUserId: outcome.previousOwnerUserId || null,
            previousOwnerUsername: outcome.previousOwnerUsername || null,
            reason: outcome.reason || null,
            expiresAt: outcome.takeover.expiresAt,
            version: outcome.takeover.version,
            force: force === true
        }
    })
    return res.json({ success: true, data: outcome.takeover })
})

async function handleReleaseTakeoverRoute(req, res) {
    const chatId = inboxService.normalizeChatJid(decodeURIComponent(req.params.chatId || ''))
    const force = req.query.force === 'true' || req.body?.force === true
    const reason = req.body?.reason || ''
    const waitMs = resolveTakeoverHttpWaitMs(req)

    let raceOutcome
    try {
        raceOutcome = await awaitWithBoundedHttpWait(
            inboxService.releaseTakeover({
                chatJid: chatId,
                actor: req.controlUser,
                force,
                reason
            }),
            waitMs
        )
    } catch (err) {
        const status = err?.code === 'CONVERSATION_QUEUE_FULL' ? 503 : 500
        return res.status(status).json({
            success: false,
            error: { code: err?.code || 'RELEASE_FAILED', message: err?.message || 'Resume request failed.' }
        })
    }

    if (!raceOutcome.settled) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:takeover:release',
            target: chatId,
            result: 'pending',
            correlationId: req.id || null,
            metadata: { code: 'TAKEOVER_PENDING_INFLIGHT_SEND', waitMs, force }
        })
        return res.status(202).json({
            success: false,
            pending: true,
            error: {
                code: 'TAKEOVER_PENDING_INFLIGHT_SEND',
                message: 'An in-flight WhatsApp operation is still settling; resume transition is queued and not yet confirmed. Query takeover state to reconcile.'
            },
            data: {
                chatId,
                pending: true,
                lock: inboxService.getConversationLockState(chatId),
                currentTakeover: inboxService.getTakeoverState(chatId, { skipExpiryMutation: true })
            }
        })
    }

    const outcome = raceOutcome.value
    if (outcome.errorStatus) {
        recordAudit({
            actorId: req.controlUser.id,
            actorRole: req.controlUser.role,
            action: 'control:whatsapp:takeover:release',
            target: chatId,
            result: outcome.errorStatus === 409 ? 'denied' : 'failed',
            correlationId: req.id || null,
            metadata: {
                code: outcome.code,
                previousState: outcome.previousState || null,
                previousOwnerUserId: outcome.previousOwnerUserId || null,
                previousOwnerUsername: outcome.previousOwnerUsername || null,
                force
            }
        })
        return res.status(outcome.errorStatus).json({
            success: false,
            error: { code: outcome.code, message: outcome.message }
        })
    }

    recordAudit({
        actorId: req.controlUser.id,
        actorRole: req.controlUser.role,
        action: 'control:whatsapp:takeover:release',
        target: chatId,
        result: 'allowed',
        correlationId: req.id || null,
        metadata: {
            previousState: outcome.previousState || null,
            newState: outcome.takeover.state,
            previousOwnerUserId: outcome.previousOwnerUserId || null,
            previousOwnerUsername: outcome.previousOwnerUsername || null,
            reason: outcome.reason || null,
            force,
            version: outcome.takeover.version
        }
    })
    return res.json({ success: true, data: outcome.takeover })
}

// DELETE /api/v2/control/whatsapp/inbox/conversations/:chatId/takeover
router.delete('/whatsapp/inbox/conversations/:chatId/takeover', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_TAKEOVER), handleReleaseTakeoverRoute)

// POST /api/v2/control/whatsapp/inbox/conversations/:chatId/resume
router.post('/whatsapp/inbox/conversations/:chatId/resume', authenticateControlJwt, requirePermission(PERMISSIONS.WHATSAPP_TAKEOVER), handleReleaseTakeoverRoute)

export default router
