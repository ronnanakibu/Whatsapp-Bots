// src/commands/ai/hermes.js
import { hermesService } from '../../services/hermes.js'

export default {
    name: 'hermes',
    aliases: ['hermesagent', 'agentstatus'],
    category: 'ai',
    description: 'Mengecek status koneksi ke NousResearch Hermes Agent API Gateway.',
    usage: '!hermes',
    cooldown: 5,
    execute: async (ctx) => {
        const { reply, react } = ctx
        await react('🤖')

        const health = await hermesService.checkHealth()

        if (health.ok) {
            await reply(
                `🤖 *NousResearch Hermes Agent Status*\n\n` +
                `✅ *Status:* Online & Connected\n` +
                `🔗 *Endpoint:* \`${hermesService.baseUrl}\`\n` +
                `🧠 *Model:* \`${hermesService.model}\`\n\n` +
                `*Hermes Agent* aktif melayani percakapan WhatsApp.`
            )
            await react('✅')
        } else {
            await reply(
                `🤖 *NousResearch Hermes Agent Status*\n\n` +
                `❌ *Status:* Offline / Cannot Reach Gateway\n` +
                `🔗 *Endpoint:* \`${hermesService.baseUrl}\`\n` +
                `⚠️ *Error:* ${health.error}\n\n` +
                `💡 *Panduan:* Jalankan \`hermes gateway\` di server kamu untuk mengaktifkan API server.`
            )
            await react('⚠️')
        }
    }
}
