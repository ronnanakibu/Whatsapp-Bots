// src/commands/group/unmute.js
import { botLogger } from '../../utils/logger.js'

export default {
    name: 'unmute',
    aliases: ['openchat'],
    category: 'group',
    description: 'Buka grup (semua anggota bisa kirim pesan).',
    usage: '.unmute',
    example: '.unmute',
    cooldown: 5,
    permissions: ['admin'],
    requireBotAdmin: true,
    tags: ['unmute', 'openchat', 'bukagrup', 'group', 'admin'],
    params: {
        type: 'object',
        properties: {},
        required: []
    },

    async execute(ctx) {
        const { reply, react, chatId, sock, sender } = ctx

        botLogger.admin('unmute', chatId, sender)

        try {
            botLogger.debug('admin', `Unmuting group ${chatId}`)
            await sock.groupSettingUpdate(chatId, 'not_announcement')
            botLogger.info('admin', `Group unmuted: ${chatId}`)
            await react('🔊')
            return reply('🔊 *Grup dibuka.*\nSemua anggota bisa kirim pesan lagi.')
        } catch (err) {
            botLogger.err('admin', err, 'unmute')
            return reply(`❌ Gagal buka grup: ${err.message}`)
        }
    }
}
