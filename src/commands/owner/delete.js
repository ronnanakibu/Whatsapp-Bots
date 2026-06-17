// src/commands/owner/delete.js
// Hapus pesan bot dari grup — dua mode:
//   .delete             → (reply pesan bot) hapus hanya pesan yang di-reply
//   .delete --N         → hapus N pesan terbaru dari bot di grup ini (max 50)

import { isOwner } from '../../utils/permissions.js'
import { store }   from '../../services/store.js'
import { logger }  from '../../utils/logger.js'

const MAX_BULK = 50  // Batas atas bulk delete biar tidak abuse

export default {
    name: 'delete',
    aliases: ['del', 'unsend', 'hapus'],
    category: 'owner',
    description: '[Owner] Hapus pesan bot dari grup. Reply pesan bot atau gunakan --N untuk bulk.',
    usage: '.delete [--N] | .delete (reply pesan bot)',
    example: '.delete --10  →  hapus 10 pesan terbaru bot di grup ini',
    cooldown: 3,
    permissions: ['owner'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, messageContent, isGroup } = ctx

        // Permission guard (double-check selain middleware)
        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        // Hanya untuk grup (di mana pesan bot ada konteks grup)
        if (!isGroup) {
            return reply('⚠️ Command ini hanya bisa dipakai di dalam grup.')
        }

        // ─────────────────────────────────────────
        // MODE 1: Reply ke pesan bot → hapus 1 pesan
        // ─────────────────────────────────────────
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsgId   = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        // Tentukan fromMe: isReplyToBot (in-memory) ATAU participant = bot JID
        const botJid = (sock.user?.id ?? '').replace(/:\d+@/, '@')
        const isReplyToBot = ctx.isReplyToBot
            || (quotedParticipant && (quotedParticipant.replace(/:\d+@/, '@') === botJid))

        if (quotedMsgId && args.length === 0) {
            // Hanya boleh hapus pesan dari bot sendiri
            if (!isReplyToBot) {
                await react('❌')
                return reply('❌ Hanya bisa menghapus pesan *dari bot sendiri*.\nReply ke pesan bot, bukan pesan orang lain.')
            }

            await react('⏳')
            try {
                const key = {
                    remoteJid: from,
                    fromMe: true,
                    id: quotedMsgId,
                    participant: isGroup ? quotedParticipant : undefined
                }
                await sock.sendMessage(from, { delete: key })
                await react('🗑️')
                logger.info(`[Delete] Deleted 1 message (id: ${quotedMsgId}) in ${from}`)
            } catch (err) {
                logger.error('[Delete] Failed to delete quoted msg:', err.message)
                await react('❌')
                return reply(`❌ Gagal menghapus pesan: ${err.message}`)
            }
            return
        }

        // ─────────────────────────────────────────
        // MODE 2: .delete --N  →  bulk delete N pesan bot terbaru
        // ─────────────────────────────────────────
        const countArg = args.find(a => a.startsWith('--'))
        if (!countArg) {
            return reply(
                `⚠️ *Cara pakai:*\n` +
                `- *(reply pesan bot)* .delete — hapus 1 pesan\n` +
                `- *.delete --20* — hapus 20 pesan terbaru bot di grup ini\n\n` +
                `_Maks bulk: ${MAX_BULK} pesan_`
            )
        }

        const countRaw = parseInt(countArg.replace('--', ''), 10)
        if (isNaN(countRaw) || countRaw < 1) {
            return reply(`❌ Angka tidak valid: \`${countArg}\`\nContoh: *.delete --20*`)
        }

        const count = Math.min(countRaw, MAX_BULK)

        // Ambil pesan dari store, filter hanya pesan bot (`fromMe`) di grup ini
        const chatMsgs = store.messages[from] ?? []
        const botMsgs = chatMsgs
            .filter(m => m.key?.fromMe === true)
            .slice(-count)   // ambil N terbaru

        if (botMsgs.length === 0) {
            await react('⚠️')
            return reply(`⚠️ Tidak ada pesan bot yang tersimpan di memori untuk grup ini.\n_Pesan harus dikirim setelah bot restart terakhir._`)
        }

        await react('⏳')
        const statusMsg = await reply(`🗑️ Menghapus *${botMsgs.length}* pesan bot... harap tunggu.`)

        let successCount = 0
        let failCount = 0

        for (const botMsg of botMsgs) {
            try {
                await sock.sendMessage(from, { delete: botMsg.key })
                successCount++
                // Throttle agar tidak kena rate-limit WA
                await new Promise(r => setTimeout(r, 250))
            } catch (err) {
                failCount++
                logger.warn(`[Delete] Failed to delete msg ${botMsg.key.id}: ${err.message}`)
            }
        }

        // Hapus status message itu sendiri juga kalau masih ada
        try {
            if (statusMsg?.key) {
                await sock.sendMessage(from, { delete: statusMsg.key })
            }
        } catch (_) {}

        await react('✅')

        const summary = failCount > 0
            ? `✅ Berhasil hapus *${successCount}* pesan, gagal *${failCount}* pesan.`
            : `✅ Berhasil menghapus *${successCount}* pesan bot dari grup ini.`

        logger.info(`[Delete] Bulk delete in ${from}: ${successCount} ok, ${failCount} fail`)
        return reply(summary)
    }
}
