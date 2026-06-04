import { logger } from '../../utils/logger.js'
import { interactiveService } from '../../services/interactive.js'

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export default {
    name: 'broadcast',
    aliases: ['bc', 'announce', 'pengumuman'],
    category: 'owner',
    description: 'Kirim broadcast pengumuman ke grup bot.',
    usage: '.bc [pesan]',
    cooldown: 0,
    permissions: ['owner'],
    async execute(ctx) {
        const { msg, args, reply, react, sock, chatId, sender } = ctx

        if (!args.length) {
            return reply('⚠️ Mana pesannya cuy?\nContoh: `.bc Bot akan maintenance jam 12 malam!`')
        }

        const text = args.join(' ')
        await react('⏳')

        try {
            // Ambil semua grup tempat bot berada
            const groups = await sock.groupFetchAllParticipating()
            const groupList = Object.values(groups)

            if (!groupList.length) {
                return reply('⚠️ Bot belum bergabung ke grup manapun.')
            }

            let listText = `📢 *TARGET BROADCAST*\n\n`
            groupList.forEach((g, i) => {
                listText += `${i + 1}. ${g.subject}\n`
            })
            const allIndex = groupList.length + 1
            listText += `${allIndex}. Semua Grup (All)\n\n`
            listText += `Silakan balas pesan ini dengan nomor target (1-${allIndex}).`

            const sentMsg = await reply(listText)
            if (!sentMsg || !sentMsg.key) return

            // Register session
            interactiveService.createSession(sentMsg.key.id, chatId, sender, async (replyCtx, answer) => {
                // Parse batch inputs (e.g. "1, 3, 5")
                const choices = answer.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
                
                if (!choices.length) {
                    return replyCtx.reply('❌ Pilihan tidak valid. Broadcast dibatalkan.')
                }

                let targets = []
                let invalidChoices = []

                if (choices.includes(allIndex)) {
                    // Kalau ada milih All, otomatis target semua grup
                    targets = groupList
                } else {
                    // Masukkan grup-grup spesifik
                    for (const choice of choices) {
                        if (choice >= 1 && choice < allIndex) {
                            // Hindari duplikat target
                            const g = groupList[choice - 1]
                            if (!targets.some(t => t.id === g.id)) {
                                targets.push(g)
                            }
                        } else {
                            invalidChoices.push(choice)
                        }
                    }
                }

                if (!targets.length) {
                    return replyCtx.reply('❌ Semua pilihan nomor salah. Broadcast dibatalkan.')
                }

                await replyCtx.react('⏳')
                const warningMsg = invalidChoices.length > 0 ? `\n(⚠️ Nomor tidak valid diabaikan: ${invalidChoices.join(', ')})` : ''
                await replyCtx.reply(`⏳ Memulai broadcast ke ${targets.length} grup...${warningMsg}`)

                let success = 0
                let failed = 0

                for (const group of targets) {
                    try {
                        const participants = group.participants.map(p => p.id)
                        await sock.sendMessage(group.id, {
                            text: `📢 *PENGUMUMAN DARI DEVELOPER*\n\n${text}`,
                            mentions: participants
                        })
                        success++
                    } catch (e) {
                        failed++
                    }
                    if (targets.length > 1) await delay(2000)
                }

                await replyCtx.react('✅')
                await replyCtx.reply(`✅ Broadcast Selesai!\n\nBerhasil kirim ke: ${success} grup\nGagal kirim ke: ${failed} grup`)
            })

            await react('✅')
        } catch (err) {
            logger.error('❌ [Broadcast] Error:', err)
            await react('❌')
            await reply('❌ Gagal mengumpulkan data grup.')
        }
    }
}
