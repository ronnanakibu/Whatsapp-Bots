// src/commands/group/kickme.js
import { botLogger } from '../../utils/logger.js'
import { isOwner } from '../../middleware/permission.js'

export default {
    name: 'kickme',
    aliases: ['kick-me'],
    category: 'admin',
    description: 'Keluar sendiri dari grup.',
    usage: '.kickme',
    cooldown: 3,
    permissions: ['admin'],
    requireBotAdmin: true,

    async execute(ctx) {
        const { reply, chatId, sock, sender } = ctx

        botLogger.admin('kickme', chatId, sender)

        if (isOwner(sender)) return reply(`😅 Owner ga perlu kickme, keluar manual aja cuy.`)

        try {
            botLogger.debug('admin', `Self-kick: ${sender} from ${chatId}`)
            await sock.groupParticipantsUpdate(chatId, [sender], 'remove')
            botLogger.info('admin', `Self-kicked: ${sender}`)
        } catch (err) {
            botLogger.err('admin', err, 'kickme')
            return reply(`❌ Gagal: ${err.message}`)
        }
    }
}
