import { memoryService } from '../../services/memory.js'

export default {
    name: 'resetparamai',
    aliases: ['resetparam'],
    category: 'ai',
    description: 'Mengembalikan settingan engine AI chat ini ke default (Groq).',
    usage: '.resetparamai',
    cooldown: 5,
    permissions: ['admin', 'owner'],
    async execute(ctx) {
        const { reply, react, chatId } = ctx

        try {
            await react('⏳')
            memoryService.setAiProvider(chatId, null)
            await react('✅')
            await reply('✅ Preferensi AI telah berhasil di-reset ke pengaturan default (Groq).')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal mereset pengaturan AI: ${err.message}`)
        }
    }
}
