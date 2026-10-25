// src/commands/owner/catchup.js
import { isOwner } from '../../utils/permissions.js'
import { dbService } from '../../services/db.js'
import { hermesService } from '../../services/hermes.js'
import { logger } from '../../utils/logger.js'

/**
 * Core handler for executive catch-up (What have I been missing)
 */
export async function handleOwnerCatchup(ctx, forceHours = null) {
    const { sock, reply, react, sender, isGroup, isDM, chatId, args = [] } = ctx

    if (!isOwner(sender)) {
        await react('🚫')
        return
    }

    await react('⏳')

    // Determine target recipient (always DM if initiated from group)
    const targetJid = isDM ? chatId : sender

    // Parse force hours if provided
    let hours = forceHours
    if (!hours && args[0] && !isNaN(args[0])) {
        hours = Math.max(1, Math.min(168, parseFloat(args[0])))
    }

    try {
        const groups = dbService.getAllGroupsWithUnreadForOwner(24, 500, hours)

        if (!groups || groups.length === 0) {
            await react('✅')
            const noMissMsg = `✨ *Semua Up to Date!* ✨\n\nTidak ada obrolan baru di grup-grup kamu sejak terakhir kali kamu aktif/baca. Kamu tidak ketinggalan apa-apa, Bro! 😎`
            if (isGroup) {
                await reply(`✨ Semua grup sudah up to date. Tidak ada pesan baru sejak terakhir dicek.`)
            } else {
                await reply(noMissMsg)
            }
            return
        }

        const totalMsgs = groups.reduce((acc, g) => acc + g.count, 0)

        // Notice in current chat
        if (isGroup) {
            await reply(`🔍 *Executive Catch-Up:* Ditemukan *${groups.length} grup* dengan *${totalMsgs} pesan baru*. Menyiapkan ringkasan eksekutif ke chat pribadi (DM) demi menjaga privasi obrolan grup...`)
        } else {
            await reply(`🔍 *Mengecek apa yang kamu lewatkan...*\nDitemukan *${groups.length} grup* dengan total *${totalMsgs} pesan baru* sejak kamu terakhir aktif. Hermes Agent sedang menganalisis & merangkum...`)
        }

        const summaries = []

        // Process each group with Hermes Agent
        for (const g of groups) {
            let groupName = 'Grup WhatsApp'
            try {
                const meta = await sock.groupMetadata(g.chatJid)
                if (meta?.subject) groupName = meta.subject
            } catch (_) {
                groupName = g.chatJid.split('@')[0]
            }

            try {
                const summary = await hermesService.summarizeGroupCompact(groupName, g.dialogue)
                summaries.push({
                    chatJid: g.chatJid,
                    groupName,
                    count: g.count,
                    text: summary
                })
            } catch (err) {
                logger.warn(`[CatchUp] Failed to summarize ${groupName}: ${err.message}`)
                summaries.push({
                    chatJid: g.chatJid,
                    groupName,
                    count: g.count,
                    text: `⚠️ Gagal merangkum: ${err.message}\n• Terakhir: ${g.dialogue.slice(-2).join(' | ')}`
                })
            }
        }

        // Mark all these groups as read for owner
        dbService.markAllGroupsAsReadForOwner(groups.map(g => g.chatJid))

        // Build report
        const dateStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
        const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

        let header = `🌟 *EXECUTIVE BRIEFING: WHAT YOU'VE BEEN MISSING* 🌟\n` +
            `👤 *Untuk:* Owner | 🕒 *${dateStr}, ${timeStr} WIB*\n` +
            `📊 *Statistik:* ${groups.length} grup aktif (${totalMsgs} pesan baru)\n` +
            `🤖 *Powered by:* Hermes Agent\n` +
            `────────────────────────────\n\n`

        const groupBlocks = summaries.map((s, idx) => {
            return `👥 *${idx + 1}. ${s.groupName}* (${s.count} pesan baru)\n` +
                `${s.text}\n`
        })

        const footer = `────────────────────────────\n` +
            `✅ *Catatan:* Semua grup di atas telah ditandai sudah dibaca untuk akunmu. Gunakan \`.catchup [jam]\` jika ingin menarik ulang rentang waktu tertentu.`

        // Chunking if message exceeds 3500 chars
        const chunks = []
        let currentChunk = header

        for (const block of groupBlocks) {
            if ((currentChunk + block).length > 3500) {
                chunks.push(currentChunk)
                currentChunk = `*(Lanjutan Catch-Up)*\n\n` + block
            } else {
                currentChunk += block + `\n`
            }
        }
        currentChunk += footer
        chunks.push(currentChunk)

        // Send to owner's DM
        for (const chunk of chunks) {
            await sock.sendMessage(targetJid, { text: chunk })
        }

        await react('✅')
    } catch (err) {
        logger.error('[CatchUp] Error during catchup execution:', err.message)
        await react('❌')
        await reply(`❌ Gagal mengecek catch-up: ${err.message}`)
    }
}

export default {
    name: 'catchup',
    aliases: ['whatmissed', 'recapall', 'summarizeall', 'ketinggalan', 'missed'],
    category: 'owner',
    description: '[OWNER] Merangkum seluruh obrolan grup WhatsApp yang belum dibaca sejak owner terakhir aktif.',
    usage: '.catchup [opsional: jam, contoh: .catchup atau .catchup 12]',
    cooldown: 5,
    permissions: ['owner'],

    async execute(ctx) {
        await handleOwnerCatchup(ctx)
    }
}
