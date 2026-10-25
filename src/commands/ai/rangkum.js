// src/commands/ai/rangkum.js
import { hermesService } from '../../services/hermes.js'
import { dbService } from '../../services/db.js'

export default {
    name: 'rangkum',
    aliases: ['tldr', 'recapchat', 'summarizechat', 'rangkuman'],
    category: 'ai',
    description: 'Merangkum percakapan grup/chat terkini (hingga 500 pesan) menggunakan Hermes Agent tanpa sensor.',
    usage: '.rangkum [jumlah pesan, default: 100, maks: 500]',
    cooldown: 10,
    execute: async (ctx) => {
        const { reply, react, args, chatId, isGroup } = ctx

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

        const waitMsg = await reply(`⏳ Sedang membaca & merangkum *${messages.length}* pesan terakhir via *Hermes Agent*... Mohon tunggu sebentar.`)

        try {
            const summary = await hermesService.summarize(chatId, messages)
            await react('✅')

            const responseText = `📋 *RANGKUMAN OBROLAN GRUP (${messages.length} PESAN)*\n` +
                `🤖 *Powered by Hermes Agent*\n\n` +
                `${summary}`

            await reply(responseText)
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal merangkum obrolan grup: ${err.message}`)
        }
    }
}
