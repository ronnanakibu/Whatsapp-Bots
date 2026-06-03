// src/commands/group/mute.js
import { botLogger } from '../../utils/logger.js'
import { guardGroup } from '../../utils/group.js'

export default {
    name: 'mute',
    aliases: ['closechat'],
    category: 'admin',
    description: 'Kunci grup (hanya admin yang bisa kirim pesan).',
    usage: '!mute',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { reply, react, chatId, sock, sender } = ctx

        botLogger.admin('mute', chatId, sender)

        if (!await guardGroup(ctx)) return

        try {
            botLogger.debug('admin', `Muting group ${chatId}`)
            await sock.groupSettingUpdate(chatId, 'announcement')
            botLogger.info('admin', `Group muted: ${chatId}`)
            await react('🔇')
            return reply('🔇 *Grup dikunci.*\nHanya admin yang bisa kirim pesan sekarang.')
        } catch (err) {
            botLogger.err('admin', err, 'mute')
            return reply(`❌ Gagal kunci grup: ${err.message}`)
        }
    }
}
