// src/utils/group.js
import { normalizeJid } from '../middleware/permission.js'
import { groupGuard } from '../middleware/groupGuard.js'

export function parseTargetJid(args, mentionedJids = []) {
    if (mentionedJids.length) {
        return normalizeJid(mentionedJids[0])
    }

    const raw = args[0]?.replace(/[^0-9]/g, '') ?? ''
    if (!raw) return null

    const normalized = raw.startsWith('0') ? '62' + raw.slice(1) : raw
    return normalized + '@s.whatsapp.net'
}

export async function guardGroup(ctx) {
    const result = await groupGuard(ctx, { requireBotAdmin: true, requireSenderAdmin: false })
    return result.ok
}
