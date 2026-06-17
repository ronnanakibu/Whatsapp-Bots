// src/utils/permissions.js
// Utility permission check — dipakai di command files secara langsung.
// Sinkron dengan middleware/permission.js untuk konsistensi.

/**
 * Strip JID ke angka murni saja.
 * Handle semua format Baileys:
 *   628xxx@s.whatsapp.net
 *   628xxx:20@s.whatsapp.net  (multi-device)
 *   628xxx@lid
 *   188996495921395@lid       (LID format)
 */
export function normalizeNumber(jid = '') {
    return jid
        .replace(/:\d+@/, '@')     // hapus :device sebelum @
        .replace(/@.+$/, '')       // hapus @s.whatsapp.net / @lid / @g.us
        .replace(/[^0-9]/g, '')    // hapus semua non-digit
}

/**
 * Cek apakah sender adalah owner bot.
 * Support multi-owner (pisah koma di OWNER_NUMBER).
 * Support format: nomor biasa, @s.whatsapp.net, @lid, :device.
 */
export function isOwner(sender) {
    const ownerRaw = process.env.OWNER_NUMBER ?? ''

    // Split multi-owner, strip whitespace & non-digit dari masing-masing
    const ownerNumbers = ownerRaw
        .split(',')
        .map(n => n.trim().replace(/[^0-9]/g, ''))
        .filter(Boolean)

    if (ownerNumbers.length === 0) return false

    const senderNorm = normalizeNumber(sender ?? '')
    if (!senderNorm) return false

    // Cek apakah nomor sender cocok dengan salah satu owner
    return ownerNumbers.some(ownerNum => senderNorm === ownerNum)
}

/**
 * Cek apakah sender adalah admin grup (legacy, pakai groupMetadata langsung).
 * Untuk cek yang lebih robust pakai middleware/permission.js isGroupAdmin(sock, groupId, jid).
 */
export function isGroupAdmin(sender, groupMetadata) {
    if (!groupMetadata?.participants) return false
    const senderNorm = normalizeNumber(sender)
    return groupMetadata.participants.some(p => {
        const pNorm = normalizeNumber(p.id)
        return pNorm === senderNorm && (p.admin === 'admin' || p.admin === 'superadmin')
    })
}