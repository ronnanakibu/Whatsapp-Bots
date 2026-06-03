// src/utils/group.js
import { isBotAdmin, normalizeJid } from '../middleware/permission.js'

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
    const { isGroup, chatId, sock, reply } = ctx

    if (!isGroup) {
        await reply('🚫 Command ini hanya untuk grup.')
        return false
    }

    const botIsAdmin = await isBotAdmin(sock, chatId)
    if (!botIsAdmin) {
        await reply('🚫 Bot harus jadi *admin grup* dulu baru bisa jalanin command ini.\nMinta admin untuk promote bot.')
        return false
    }

    return true
}
