import { logger } from '../../utils/logger.js'

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export default {
    name: 'broadcast',
    aliases: ['bc', 'announce', 'pengumuman'],
    category: 'owner',
    description: 'Kirim broadcast pengumuman ke seluruh grup bot.',
    usage: '.bc [pesan]',
    cooldown: 0,
    permissions: ['owner'],
    async execute(ctx) {
        const { msg, args, reply, react, sock } = ctx

        if (!args.length) {
            return reply('⚠️ Mana pesannya cuy?\nContoh: `.bc Bot akan maintenance jam 12 malam!`')
        }

        const text = args.join(' ')
        await react('⏳')
        await reply('⏳ Mengumpulkan data grup dan memulai broadcast...')

        try {
            // Ambil semua grup tempat bot berada
            const groups = await sock.groupFetchAllParticipating()
            const groupList = Object.values(groups)

            let success = 0
            let failed = 0

            for (const group of groupList) {
                try {
                    // Ambil list semua member untuk fitur "mention all"
                    const participants = group.participants.map(p => p.id)

                    // Kirim pesan
                    await sock.sendMessage(group.id, {
                        text: `📢 *PENGUMUMAN DARI DEVELOPER*\n\n${text}`,
                        mentions: participants
                    })

                    success++
                } catch (e) {
                    failed++
                }
                
                // Kasih delay 2 detik biar gak kena ban WA (spam filter)
                await delay(2000)
            }

            await react('✅')
            await reply(`✅ Broadcast Selesai!\n\nBerhasil kirim ke: ${success} grup\nGagal kirim ke: ${failed} grup`)
        } catch (err) {
            logger.error('❌ [Broadcast] Error:', err)
            await react('❌')
            await reply('❌ Gagal melakukan broadcast.')
        }
    }
}
