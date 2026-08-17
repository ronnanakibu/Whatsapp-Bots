// src/commands/ai/hermes.js
import { hermesService } from '../../services/hermes.js'

export default {
    name: 'hermes',
    aliases: ['hermesagent', 'agentmemory', 'hermesmem'],
    category: 'ai',
    description: 'Mengecek status, arsitektur model, memori & pengaturan reasoning Hermes Agent untuk chat ini.',
    usage: '!hermes [memory|reasoning|status]',
    cooldown: 3,
    execute: async (ctx) => {
        const { reply, react, args, chatId, pushName, isGroup, sock } = ctx
        await react('🤖')

        const subCmd = (args[0] || '').toLowerCase()

        if (subCmd === 'reasoning' || subCmd === 'think' || subCmd === 'reason') {
            const val = (args[1] || '').toLowerCase()

            if (val === 'true' || val === 'on' || val === '1' || val === 'enable') {
                await hermesService.setReasoning(chatId, true)
                await reply(`⏱️ *Hermes Agent Reasoning Mode*\n\nReasoning header & proses berpikir DeepSeek R1 *AKTIF* (True) untuk chat ini.`)
                await react('🧠')
                return
            } else if (val === 'false' || val === 'off' || val === '0' || val === 'disable') {
                await hermesService.setReasoning(chatId, false)
                await reply(`⏱️ *Hermes Agent Reasoning Mode*\n\nReasoning header & proses berpikir *NONAKTIF* (False) untuk chat ini. Respon akan langsung dikirim tanpa header 'Thought for...'.`)
                await react('⚡')
                return
            } else {
                const statusRes = await hermesService.getReasoning(chatId)
                const isEnabled = statusRes.reasoning
                await reply(
                    `⏱️ *Hermes Agent Reasoning Mode*\n\n` +
                    `Status saat ini: *${isEnabled ? 'AKTIF (True)' : 'NONAKTIF (False)'}*\n\n` +
                    `Gunakan command:\n` +
                    `• \`.hermes reasoning true\` (Aktifkan header & proses berpikir)\n` +
                    `• \`.hermes reasoning false\` (Nonaktifkan header reasoning)`
                )
                await react('ℹ️')
                return
            }
        }

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

        if (subCmd === 'logs' || subCmd === 'log') {
            try {
                const { hfLogsStreamer } = await import('../../services/hfLogsStreamer.js')
                const recentLogs = hfLogsStreamer.getRecentLogs(8)

                if (recentLogs.length === 0) {
                    await reply(`📜 *Hugging Face Space Live Logs*\n\nBelum ada log real-time yang tercatat dari HF Space saat ini.`)
                    await react('ℹ️')
                    return
                }

                let text = `📜 *Hugging Face Space Live Logs (Real-Time)*\n\n`
                for (const item of recentLogs) {
                    text += `• \`${item.text.slice(0, 120)}\`\n`
                }

                await reply(text.trim())
                await react('📜')
                return
            } catch (err) {
                await reply(`📜 *HF Logs Error:* ${err.message}`)
                await react('⚠️')
                return
            }
        }

        // Default: Status & Rich Architecture Info
        const health = await hermesService.checkHealth()
        const reasoningStatus = await hermesService.getReasoning(chatId)
        const reasoningLabel = reasoningStatus.reasoning ? 'Aktif (True)' : 'Nonaktif (False)'

        if (health.ok) {
            await reply(
                `🤖 *NousResearch Multi-Model Hermes Agent*\n\n` +
                `✅ *Status:* Online & Active (ZeroGPU Hosted)\n` +
                `🔗 *Endpoint:* \`${hermesService.baseUrl}\`\n\n` +
                `🧠 *Reasoning Judge:* \`DeepSeek R1 (Reasoning Engine)\` (*${reasoningLabel}*)\n` +
                `⚡ *Knowledge Workers:* \`Hermes 3 (405B)\` + \`Llama 3.3 (70B)\`\n` +
                `🌐 *Real-Time Search:* \`Live Google / DDG Web Search\`\n` +
                `💾 *Session Memory:* \`Active & Isolated\`\n\n` +
                `💡 *Tip:* Ketik \`.hermes reasoning true / false\` untuk mengatur mode reasoning.`
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

