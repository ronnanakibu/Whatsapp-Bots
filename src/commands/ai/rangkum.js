// src/commands/ai/rangkum.js
import { hermesService } from '../../services/hermes.js'
import { dbService } from '../../services/db.js'

export default {
    name: 'rangkum',
    aliases: ['summarize', 'summarizechat', 'recapchat', 'rangkuman'],
    category: 'ai',
    description: 'Merangkum percakapan grup/chat terkini (hingga 500 pesan) menggunakan Hermes Agent tanpa sensor.',
    usage: '.summarize [jumlah pesan, default: 100, maks: 500] atau .rangkum [jumlah pesan] [nama grup opsional]',
    cooldown: 10,
    execute: async (ctx) => {
        const { sock, reply, react, args, chatId, isGroup } = ctx

        // Jika user memberikan URL, teruskan ke pembaca artikel (.baca)
        if (args[0] && (args[0].startsWith('http://') || args[0].startsWith('https://'))) {
            const { default: bacaCmd } = await import('../utility/baca.js')
            return bacaCmd.execute(ctx)
        }

        let count = 100
        let targetChatId = chatId
        let groupName = ''

        const rawArgsText = args.join(' ')
        const numMatch = rawArgsText.match(/\b(\d{1,3})\b/)
        if (numMatch) {
            count = Math.min(500, Math.max(10, parseInt(numMatch[1], 10)))
        }

        // Cek apakah user menyebutkan nama grup tertentu (misal: "di grup learning C.St")
        if (sock?.groupFetchAllParticipating) {
            try {
                const groups = await sock.groupFetchAllParticipating()
                const stopWords = ['di', 'grup', 'group', 'ringkas', 'rangkum', 'recap', 'summarize', 'percakapan', 'obrolan', 'pesan', 'chat', 'terakhir', 'terkini', 'coba', 'tolong', 'minta', 'dong', 'buatkan', 'bikinin', 'pada', 'ke']
                const cleanQuery = rawArgsText.toLowerCase()
                    .replace(/\b(\d+)\b/g, ' ')
                    .replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w && !stopWords.includes(w))
                    .join(' ')
                    .trim()

                if (cleanQuery.length >= 2) {
                    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean)
                    let bestMatch = null
                    let maxScore = 0

                    for (const [gJid, gMeta] of Object.entries(groups)) {
                        const rawSubj = gMeta.subject || ''
                        const normSubj = rawSubj.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
                        
                        // 1. Direct normalized substring check
                        if (normSubj.includes(cleanQuery) || cleanQuery.includes(normSubj)) {
                            bestMatch = { id: gJid, subject: rawSubj }
                            break
                        }

                        // 2. Token overlap score
                        const subjTokens = normSubj.split(/\s+/)
                        let matchedTokens = 0
                        for (const qTok of queryTokens) {
                            if (subjTokens.some(sTok => sTok.includes(qTok) || qTok.includes(sTok))) {
                                matchedTokens++
                            }
                        }
                        const score = matchedTokens / queryTokens.length
                        if (score > maxScore && score >= 0.5) {
                            maxScore = score
                            bestMatch = { id: gJid, subject: rawSubj }
                        }
                    }

                    if (bestMatch) {
                        targetChatId = bestMatch.id
                        groupName = bestMatch.subject
                    }
                }
            } catch (_) {}
        }

        if (!groupName && isGroup && sock?.groupMetadata && targetChatId === chatId) {
            try {
                const meta = await sock.groupMetadata(chatId)
                if (meta?.subject) groupName = meta.subject
            } catch (_) {}
        }

        await react('⏳')

        const messages = dbService.getRecentDialogue(targetChatId, count)

        if (!messages || messages.length < 5) {
            await react('⚠️')
            const targetLabel = groupName ? `grup "${groupName}"` : 'chat ini'
            return reply(`⚠️ Belum ada cukup riwayat pesan yang terekam di ${targetLabel} (minimal 5 pesan). Bot baru merekam *${messages ? messages.length : 0}* pesan di database.`)
        }

        const targetLabel = groupName ? `grup "${groupName}"` : 'chat ini'
        await reply(`⏳ Sedang membaca & merangkum *${messages.length}* pesan terakhir dari ${targetLabel} via *Hermes Agent*... Mohon tunggu sebentar.`)

        try {
            const summary = await hermesService.summarize(targetChatId, messages, groupName)
            await react('✅')

            const title = groupName ? `📋 *RANGKUMAN OBROLAN "${groupName.toUpperCase()}" (${messages.length} PESAN)*\n` : `📋 *RANGKUMAN OBROLAN (${messages.length} PESAN)*\n`
            const responseText = `${title}` +
                `🤖 *Powered by Hermes Agent*\n\n` +
                `${summary}`

            await reply(responseText)
        } catch (err) {
            await react('❌')
            return reply(`❌ Gagal merangkum obrolan grup: ${err.message}`)
        }
    }
}
