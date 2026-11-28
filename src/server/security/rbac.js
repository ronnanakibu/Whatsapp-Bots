// src/server/security/rbac.js
// Centralized, default-deny multi-role RBAC policy for RonnBot Control Center

export const ROLES = Object.freeze({
    OWNER: 'owner',
    ADMIN: 'admin',
    OPERATOR: 'operator',
    VIEWER: 'viewer'
})

export const VALID_ROLES = Object.freeze(Object.values(ROLES))

export const SCOPES = Object.freeze({
    CONTROL: 'control',
    RADIO: 'radio'
})

export const PERMISSIONS = Object.freeze({
    OVERVIEW_READ: 'overview:read',
    WHATSAPP_STATUS_READ: 'whatsapp:status:read',
    WHATSAPP_PAIRING_READ: 'whatsapp:pairing:read',
    WHATSAPP_GROUPS_READ: 'whatsapp:groups:read',
    WHATSAPP_GROUP_CONFIG: 'whatsapp:group:config',
    WHATSAPP_GROUP_BROADCAST: 'whatsapp:group:broadcast',
    WHATSAPP_GROUP_LEAVE: 'whatsapp:group:leave',
    WHATSAPP_INBOX_READ: 'whatsapp:inbox:read',
    WHATSAPP_INBOX_OPERATE: 'whatsapp:inbox:operate',
    WHATSAPP_TAKEOVER: 'whatsapp:takeover',
    COMMANDS_READ: 'commands:read',
    COMMANDS_TOGGLE: 'commands:toggle',
    AI_HEALTH_READ: 'ai:health:read',
    CREATOR_READ: 'creator:read',
    CREATOR_OPERATE: 'creator:operate',
    LOGS_READ_SUMMARY: 'logs:read:summary',
    LOGS_READ_FULL: 'logs:read:full',
    DB_METADATA_READ: 'db:metadata:read',
    SYSTEM_RESTART: 'system:restart',
    SECRETS_MANAGE: 'secrets:manage',
    USERS_MANAGE: 'users:manage',
    AUDIT_READ: 'audit:read'
})

export const VALID_PERMISSIONS = Object.freeze(new Set(Object.values(PERMISSIONS)))

export const OWNER_ONLY_PERMISSIONS = Object.freeze(new Set([
    PERMISSIONS.SECRETS_MANAGE,
    PERMISSIONS.SYSTEM_RESTART,
    PERMISSIONS.WHATSAPP_GROUP_BROADCAST,
    PERMISSIONS.WHATSAPP_GROUP_LEAVE,
    PERMISSIONS.USERS_MANAGE
]))

const VIEWER_PERMISSIONS = [
    PERMISSIONS.OVERVIEW_READ,
    PERMISSIONS.WHATSAPP_STATUS_READ,
    PERMISSIONS.WHATSAPP_GROUPS_READ,
    PERMISSIONS.COMMANDS_READ,
    PERMISSIONS.AI_HEALTH_READ,
    PERMISSIONS.CREATOR_READ,
    PERMISSIONS.LOGS_READ_SUMMARY
]

const OPERATOR_PERMISSIONS = [
    ...VIEWER_PERMISSIONS,
    PERMISSIONS.CREATOR_OPERATE,
    PERMISSIONS.WHATSAPP_INBOX_READ,
    PERMISSIONS.WHATSAPP_INBOX_OPERATE,
    PERMISSIONS.WHATSAPP_TAKEOVER
]

const ADMIN_PERMISSIONS = [
    ...OPERATOR_PERMISSIONS,
    PERMISSIONS.WHATSAPP_PAIRING_READ,
    PERMISSIONS.WHATSAPP_GROUP_CONFIG,
    PERMISSIONS.COMMANDS_TOGGLE,
    PERMISSIONS.LOGS_READ_FULL,
    PERMISSIONS.DB_METADATA_READ,
    PERMISSIONS.AUDIT_READ
]

const OWNER_PERMISSIONS = Object.values(PERMISSIONS)

export const ROLE_PERMISSIONS = Object.freeze({
    [ROLES.VIEWER]: Object.freeze(VIEWER_PERMISSIONS),
    [ROLES.OPERATOR]: Object.freeze(OPERATOR_PERMISSIONS),
    [ROLES.ADMIN]: Object.freeze(ADMIN_PERMISSIONS),
    [ROLES.OWNER]: Object.freeze(OWNER_PERMISSIONS)
})

/**
 * Computes effective permission list for an authenticated Control Center user.
 * @param {object} user
 * @returns {string[]}
 */
export function getEffectivePermissions(user) {
    if (!user || user.scope !== SCOPES.CONTROL) return []
    const base = ROLE_PERMISSIONS[user.role]
    if (!base) return []

    const set = new Set(base)
    if (Array.isArray(user.extraPermissions)) {
        for (const perm of user.extraPermissions) {
            if (typeof perm === 'string' && VALID_PERMISSIONS.has(perm)) {
                set.add(perm)
            }
        }
    }
    return Array.from(set)
}

/**
 * Default-deny authorization check.
 * @param {object} user
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(user, permission) {
    if (!user || user.scope !== SCOPES.CONTROL) return false
    if (!permission || !VALID_PERMISSIONS.has(permission)) return false
    if (!ROLE_PERMISSIONS[user.role]) return false
    if (user.role === ROLES.OWNER) return true
    return getEffectivePermissions(user).includes(permission)
}

export function isValidRole(role) {
    return VALID_ROLES.includes(role)
}
