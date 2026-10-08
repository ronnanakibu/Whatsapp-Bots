// src/commands/owner/delete.js
// Hapus pesan bot atau pesan member grup (jika bot admin) — dua mode:
//   .delete             → (reply pesan) hapus pesan yang di-reply
//   .delete [N]         → hapus N pesan bot terbaru di chat ini (contoh: .delete 1, .delete 5, .delete --20)

import { isOwner, normalizeNumber } from '../../utils/permissions.js'
import { store } from '../../services/store.js'
import { logger } from '../../utils/logger.js'

const MAX_BULK = 50 // Batas atas bulk delete biar aman

export default {
    name: 'delete',
    aliases: ['del', 'unsend', 'hapus'],
    category: 'owner',
    description: '[Owner] Hapus pesan bot atau pesan member (jika admin). Reply pesan atau gunakan jumlah untuk bulk.',
    usage: '.delete [1-50] | .delete (reply pesan)',
    example: '.delete 5  →  hapus 5 pesan terbaru bot di chat ini',
    cooldown: 2,
    permissions: ['owner'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, messageContent, isGroup } = ctx

        // Permission guard
        if (!isOwner(sender)) {
            await react('🚫')
            return reply('🚫 Hanya owner yang dapat menggunakan command delete.')
        }

        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsgId = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        // ─────────────────────────────────────────
        // MODE 1: Reply ke pesan → hapus 1 pesan
        // ─────────────────────────────────────────
        if (quotedMsgId) {
            await react('⏳')

            const rawBotId = sock.user?.id ?? ''
            const botNumbers = new Set([
                normalizeNumber(rawBotId),
                normalizeNumber(sock.user?.lid ?? ''),
                ...(process.env.BOT_NUMBER ?? '').split(',').map(normalizeNumber)
            ].filter(Boolean))

            // Cek apakah pesan berasal dari bot
            const storedMsg = store.loadMessage(from, quotedMsgId)
            const isFromBot = storedMsg?.key?.fromMe === true
                || (quotedParticipant && botNumbers.has(normalizeNumber(quotedParticipant)))
                || ctx.isReplyToBot

            try {
                if (isFromBot) {
                    // 1. Pesan dari bot sendiri
                    const key = {
                        remoteJid: from,
                        fromMe: true,
                        id: quotedMsgId,
                        participant: isGroup ? quotedParticipant : undefined
                    }
                    await sock.sendMessage(from, { delete: key })
                    await react('🗑️')
                    logger.info(`[Delete] Deleted bot message ${quotedMsgId} in ${from}`)
                    return
                }

                // 2. Pesan dari pengguna lain
                if (!isGroup) {
                    await react('❌')
                    return reply('❌ Di Direct Message (chat pribadi), bot hanya bisa menarik pesan yang dikirim oleh bot sendiri.')
                }

                // Di grup: periksa apakah bot adalah admin
                const groupMeta = await sock.groupMetadata(from).catch(() => null)
                const isBotAdmin = groupMeta?.participants?.some(p => {
                    const pNorm = normalizeNumber(p.id)
                    return botNumbers.has(pNorm) && (p.admin === 'admin' || p.admin === 'superadmin')
                })

                if (!isBotAdmin) {
                    await react('❌')
                    return reply('❌ Bot bukan admin di grup ini, sehingga hanya bisa menghapus pesan bot sendiri.\nJadikan bot sebagai admin grup untuk menghapus pesan member lain.')
                }

                // Bot admin di grup -> hapus pesan member lain untuk semua orang
                const key = {
                    remoteJid: from,
                    fromMe: false,
                    id: quotedMsgId,
                    participant: quotedParticipant
                }
                await sock.sendMessage(from, { delete: key })
                await react('🗑️')
                logger.info(`[Delete] Admin-deleted member message ${quotedMsgId} (${quotedParticipant}) in ${from}`)
                return
            } catch (err) {
                logger.error('[Delete] Failed to delete quoted msg:', err.message)
                await react('❌')
                return reply(`❌ Gagal menghapus pesan: ${err.message}`)
            }
        }

        // ─────────────────────────────────────────
        // MODE 2: .delete [N] / .delete --N → bulk delete N pesan bot terbaru
        // ─────────────────────────────────────────
        let count = 0
        if (args.length > 0) {
            // Bersihkan format: hilangkan strip, em-dash, dsb ('--', '-', '–')
            const cleanArg = args[0].replace(/^[–—\-]+/, '').trim()
            const parsedNum = parseInt(cleanArg, 10)
            if (!isNaN(parsedNum) && parsedNum > 0) {
                count = Math.min(parsedNum, MAX_BULK)
            }
        }

        if (count === 0) {
            return reply(
                `⚠️ *Cara pakai command .delete:*\n\n` +
                `1. *(Reply pesan)* \`.delete\`\n` +
                `   Menghapus 1 pesan yang di-reply (pesan bot, atau pesan siapa pun jika bot admin di grup).\n\n` +
                `2. \`.delete 5\` atau \`.delete --5\`\n` +
                `   Menghapus 5 pesan terbaru bot di chat ini.\n\n` +
                `_Maks bulk: ${MAX_BULK} pesan._`
            )
        }

        // Ambil pesan bot terbaru dari store
        const botMsgs = store.getRecentBotMessages(from, count)

        if (botMsgs.length === 0) {
            await react('⚠️')
            return reply(`⚠️ Tidak ada riwayat pesan bot yang tersimpan untuk chat ini.`)
        }

        await react('⏳')
        const statusMsg = await reply(`🗑️ Menghapus *${botMsgs.length}* pesan bot... harap tunggu.`)

        let successCount = 0
        let failCount = 0

        for (const botMsg of botMsgs) {
            try {
                await sock.sendMessage(from, { delete: botMsg.key })
                successCount++
                await new Promise(r => setTimeout(r, 250))
            } catch (err) {
                failCount++
                logger.warn(`[Delete] Failed to delete msg ${botMsg.key?.id}: ${err.message}`)
            }
        }

        // Hapus status message itu sendiri
        try {
            if (statusMsg?.key) {
                await sock.sendMessage(from, { delete: statusMsg.key })
            }
        } catch (_) {}

        await react('✅')
        const summary = failCount > 0
            ? `✅ Berhasil menghapus *${successCount}* pesan, gagal *${failCount}* pesan.`
            : `✅ Berhasil menghapus *${successCount}* pesan bot.`

        logger.info(`[Delete] Bulk delete in ${from}: ${successCount} ok, ${failCount} fail`)
        return reply(summary)
    }
}
