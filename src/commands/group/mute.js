// src/commands/group/mute.js
import { botLogger } from '../../utils/logger.js'

export default {
    name: 'mute',
    aliases: ['closechat'],
    category: 'group',
    description: 'Kunci grup (hanya admin yang bisa kirim pesan).',
    usage: '.mute',
    example: '.mute',
    cooldown: 5,
    permissions: ['admin'],
    requireBotAdmin: true,
    tags: ['mute', 'closechat', 'tutupgrup', 'kunci', 'group', 'admin'],
    params: {
        type: 'object',
        properties: {},
        required: []
    },

    async execute(ctx) {
        const { reply, react, chatId, sock, sender } = ctx

        botLogger.admin('mute', chatId, sender)

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
