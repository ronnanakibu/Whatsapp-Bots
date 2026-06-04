// src/commands/group/listadmin.js
import { botLogger } from '../../utils/logger.js'

export default {
    name: 'listadmin',
    category: 'admin',
    description: 'Menampilkan daftar admin di grup.',
    usage: '.listadmin',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { reply, chatId, sock, sender, isGroup } = ctx
        
        botLogger.admin('listadmin', chatId, sender)

        if (!isGroup) return reply('🚫 Hanya untuk grup.')

        try {
            const meta = await sock.groupMetadata(chatId)
            const admins = meta.participants.filter(p => p.admin)

            if (!admins.length) return reply('Tidak ada admin di grup ini.')

            const list = admins.map((a, i) => {
                const tag = a.admin === 'superadmin' ? '👑' : '⭐'
                return `${i + 1}. ${tag} @${a.id.split('@')[0]}`
            }).join('\n')

            return reply(`👑 *Daftar Admin (${admins.length}):*\n\n${list}`, { mentions: admins.map(a => a.id) })
        } catch (err) {
            botLogger.err('admin', err, 'listadmin')
            return reply(`❌ Gagal: ${err.message}`)
        }
    }
}
