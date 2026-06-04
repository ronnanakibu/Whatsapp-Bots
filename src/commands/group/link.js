// src/commands/group/link.js
import { botLogger } from '../../utils/logger.js'
import { isBotAdmin } from '../../middleware/permission.js'

export default {
    name: 'grouplink',
    aliases: ['link', 'invitelink'],
    category: 'admin',
    description: 'Ambil link undangan grup.',
    usage: '.grouplink',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { reply, react, chatId, sock, sender, isGroup } = ctx
        const commandName = ctx.commandName?.toLowerCase()

        botLogger.admin(commandName, chatId, sender)

        if (!isGroup) return reply('🚫 Hanya untuk grup.')

        const botIsAdmin = await isBotAdmin(sock, chatId)
        if (!botIsAdmin) return reply('🚫 Bot harus jadi admin untuk ambil link grup.')

        try {
            botLogger.debug('admin', `Fetching group invite link for ${chatId}`)
            const code = await sock.groupInviteCode(chatId)
            const link = `https://chat.whatsapp.com/${code}`

            botLogger.info('admin', `Group link fetched: ${link}`)
            await react('🔗')
            return reply(`🔗 *Link Grup*\n\n${link}\n\n_Link ini bisa di-revoke dengan !revokelink_`)
        } catch (err) {
            botLogger.err('admin', err, 'grouplink')
            return reply(`❌ Gagal ambil link grup.\nError: ${err.message}`)
        }
    }
}
