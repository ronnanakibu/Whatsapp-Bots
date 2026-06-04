// src/middleware/groupGuard.js
// FIXED: Reuse robust checks from permission.js to handle @lid and proper normalization

import { isBotAdmin, isGroupAdmin, isOwner, normalizeJid } from './permission.js'

function jidToPhone(jid = '') {
    return normalizeJid(jid)
        .replace(/@.+$/, '')
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

/**
 * Ambil semua admin JID dari grup, sudah dinormalisasi.
 */
export async function getGroupAdmins(sock, groupId) {
    try {
        const metadata = await sock.groupMetadata(groupId)
        return metadata.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => normalizeJid(p.id))
    } catch (err) {
        console.error('[groupGuard] getGroupAdmins error:', err.message)
        return []
    }
}

/**
 * Cek apakah bot adalah admin di grup.
 */
export async function checkBotAdmin(sock, groupId) {
    return isBotAdmin(sock, groupId)
}

// Keep isBotAdmin naming for compatibility
export { isBotAdmin }

/**
 * Cek apakah sender adalah admin/superadmin di grup.
 */
export async function isSenderAdmin(sock, groupId, senderJid) {
    return isGroupAdmin(sock, groupId, senderJid)
}

/**
 * Cek apakah sender adalah owner bot.
 */
export function isBotOwner(senderJid) {
    return isOwner(senderJid)
}

/**
 * Full group guard — validasi semua kondisi sebelum eksekusi command.
 * Returns: { ok: boolean }
 */
export async function groupGuard(ctx, { requireBotAdmin = true, requireSenderAdmin = true } = {}) {
    const { sock, chatId, sender, isGroup, reply } = ctx

    if (!isGroup) {
        await reply('❌ Command ini hanya bisa dipakai di dalam grup.')
        return { ok: false }
    }

    if (requireBotAdmin) {
        const botIsAdminCheck = await isBotAdmin(sock, chatId)
        if (!botIsAdminCheck) {
            const botJid = normalizeJid(sock.user?.id ?? '')
            console.warn(`[groupGuard] Bot bukan admin. botJid=${botJid}, groupId=${chatId}`)
            await reply(
                `❌ *Bot harus jadi admin grup dulu.*\n\n` +
                `Caranya: Buka info grup → Jadikan bot sebagai admin\n` +
                `Setelah itu coba command ini lagi.`
            )
            return { ok: false }
        }
    }

    if (requireSenderAdmin) {
        const ownerCheck = isOwner(sender)
        const adminCheck = await isGroupAdmin(sock, chatId, sender)

        if (!ownerCheck && !adminCheck) {
            console.warn(`[groupGuard] Sender bukan admin. sender=${sender}`)
            await reply(`❌ Command ini hanya untuk *admin grup*.`)
            return { ok: false }
        }
    }

    return { ok: true }
}

/**
 * Parse target JID dari mention atau nomor HP di args.
 */
export function parseTargetJid(args, msg) {
    const mentionedJid =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        ?? msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        ?? null

    if (mentionedJid) return mentionedJid

    const numArg = args.find(a => /^\+?\d{8,15}$/.test(a.replace(/[\s\-().]/g, '')))
    if (numArg) {
        const cleaned = numArg.replace(/[+\s\-().]/g, '')
        const normalized = cleaned.startsWith('0') ? '62' + cleaned.slice(1) : cleaned
        return `${normalized}@s.whatsapp.net`
    }

    return null
}

/**
 * Format JID jadi nomor yang readable untuk display di pesan.
 */
export function formatJidForDisplay(jid = '') {
    return normalizeJid(jid).replace('@s.whatsapp.net', '').replace('@g.us', '')
}