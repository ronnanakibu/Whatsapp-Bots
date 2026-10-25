// src/commands/ai/rangkum.js
import { hermesService } from '../../services/hermes.js'
import { dbService } from '../../services/db.js'

export default {
    name: 'rangkum',
    aliases: ['summarize', 'summarizechat', 'recapchat', 'rangkuman'],
    category: 'ai',
    description: 'Merangkum percakapan grup/chat terkini (hingga 500 pesan) menggunakan Hermes Agent tanpa sensor.',
    usage: '.summarize [jumlah pesan, default: 100, maks: 500] atau .rangkum [jumlah pesan]',
    cooldown: 10,
    execute: async (ctx) => {
        const { sock, reply, react, args, chatId, isGroup } = ctx

        // Jika user memberikan URL, teruskan ke pembaca artikel (.baca)
        if (args[0] && (args[0].startsWith('http://') || args[0].startsWith('https://'))) {
            const { default: bacaCmd } = await import('../utility/baca.js')
            return bacaCmd.execute(ctx)
        }

        let count = 100
        if (args[0] && !isNaN(args[0])) {
            count = Math.min(500, Math.max(10, parseInt(args[0], 10)))
        }

        await react('⏳')

        const messages = dbService.getRecentDialogue(chatId, count)

        if (!messages || messages.length < 5) {
            await react('⚠️')
            return reply(`⚠️ Belum ada cukup riwayat pesan yang terekam di chat ini (minimal 5 pesan). Bot baru merekam *${messages ? messages.length : 0}* pesan.`)
        }

        await reply(`⏳ Sedang membaca & merangkum *${messages.length}* pesan terakhir via *Hermes Agent*... Mohon tunggu sebentar.`)

        let groupName = ''
        if (isGroup && sock?.groupMetadata) {
            try {
                const meta = await sock.groupMetadata(chatId)
                if (meta?.subject) groupName = meta.subject
            } catch (_) {}
        }

        try {
            const summary = await hermesService.summarize(chatId, messages, groupName)
            await react('✅')

            const title = groupName ? `📋 *RANGKUMAN OBROLAN "${groupName.toUpperCase()}" (${messages.length} PESAN)*\n` : `📋 *RANGKUMAN OBROLAN (${messages.length} PESAN)*\n`
            const responseText = `${title}` +
                `🤖 *Powered by Hermes Agent*\n\n` +
                `${summary}`

            await reply(responseText)
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal merangkum obrolan grup: ${err.message}`)
        }
    }
}
