// src/commands/ai/hermes.js
import { hermesService } from '../../services/hermes.js'

export default {
    name: 'hermes',
    aliases: ['hermesagent', 'agentmemory', 'hermesmem'],
    category: 'ai',
    description: 'Mengecek status & memori percakapan Hermes Agent untuk chat ini.',
    usage: '!hermes [memory|status]',
    cooldown: 3,
    execute: async (ctx) => {
        const { reply, react, args, chatId, pushName, isGroup, sock } = ctx
        await react('🤖')

        const subCmd = (args[0] || '').toLowerCase()

        if (subCmd === 'memory' || subCmd === 'mem' || subCmd === 'history') {
            const memResult = await hermesService.getMemory(chatId)
            
            if (memResult.ok && memResult.data) {
                const history = memResult.data.history || []
                const totalMsgs = memResult.data.total_messages || history.length

                if (history.length === 0) {
                    await reply(`🧠 *Hermes Agent Memory*\n\nBelum ada memori percakapan tersimpan untuk chat ini.`)
                    await react('ℹ️')
                    return
                }

                // Resolve profile/group name instead of raw JID
                let profileDisplay = pushName || 'User'
                if (isGroup) {
                    try {
                        const groupMeta = await sock.groupMetadata(chatId)
                        if (groupMeta?.subject) {
                            profileDisplay = `${groupMeta.subject} (by ${pushName || 'User'})`
                        }
                    } catch (_) {}
                }

                let text = `🧠 *Hermes Agent Memory (${totalMsgs} pesan tersimpan)*\n`
                text += `👤 *Profile:* ${profileDisplay}\n\n`

                const recent = history.slice(-6)
                for (const item of recent) {
                    const role = item.role === 'user' ? '❓ *Question*' : '💡 *Answer*'
                    const content = item.content?.length > 150 ? item.content.slice(0, 150) + '...' : item.content
                    text += `${role}: ${content}\n\n`
                }

                await reply(text.trim())
                await react('🧠')
                return
            } else {
                await reply(`🧠 *Hermes Agent Memory*\n\nTidak dapat mengambil memori: ${memResult.error || 'Unknown error'}`)
                await react('⚠️')
                return
            }
        }

        // Default: Status
        const health = await hermesService.checkHealth()

        if (health.ok) {
            await reply(
                `🤖 *NousResearch Hermes Agent Status*\n\n` +
                `✅ *Status:* Online & Connected\n` +
                `🔗 *Endpoint:* \`${hermesService.baseUrl}\`\n` +
                `🧠 *Model:* \`${hermesService.model}\`\n\n` +
                `💡 *Tip:* Ketik \`.hermes memory\` untuk melihat ingatan percakapan Hermes Agent di chat ini.`
            )
            await react('✅')
        } else {
            await reply(
                `🤖 *NousResearch Hermes Agent Status*\n\n` +
                `❌ *Status:* Offline / Cannot Reach Gateway\n` +
                `🔗 *Endpoint:* \`${hermesService.baseUrl}\`\n` +
                `⚠️ *Error:* ${health.error}`
            )
            await react('⚠️')
        }
    }
}
