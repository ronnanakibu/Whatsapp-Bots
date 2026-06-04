// src/commands/group/info.js
import { botLogger } from '../../utils/logger.js'

export default {
    name: 'groupinfo',
    aliases: ['ginfo'],
    category: 'admin',
    description: 'Menampilkan informasi dan daftar admin grup.',
    usage: '.groupinfo',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { reply, chatId, sock, sender, isGroup } = ctx
        const commandName = ctx.commandName?.toLowerCase()

        botLogger.admin(commandName, chatId, sender)

        if (!isGroup) return reply('🚫 Hanya untuk grup.')

        try {
            botLogger.debug('admin', `Fetching group metadata for ${chatId}`)
            const meta = await sock.groupMetadata(chatId)

            const admins = meta.participants.filter(p => p.admin)
            const members = meta.participants.length
            const adminList = admins.map(a => `  • @${a.id.split('@')[0]}`).join('\n')
            const created = new Date(meta.creation * 1000).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
            })

            botLogger.info('admin', `Group info fetched: ${meta.subject} (${members} members)`)

            return reply(
                `📋 *Info Grup*\n\n` +
                `👥 *Nama:* ${meta.subject}\n` +
                `📝 *Deskripsi:* ${meta.desc ?? '(tidak ada)'}\n` +
                `👤 *Anggota:* ${members} orang\n` +
                `👑 *Admin (${admins.length}):*\n${adminList}\n` +
                `📅 *Dibuat:* ${created}`,
                { mentions: admins.map(a => a.id) }
            )
        } catch (err) {
            botLogger.err('admin', err, 'groupinfo')
            return reply(`❌ Gagal ambil info grup: ${err.message}`)
        }
    }
}
