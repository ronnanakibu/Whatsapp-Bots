// src/commands/group/promote.js
import { botLogger } from '../../utils/logger.js'
import { parseTargetJid } from '../../utils/group.js'

export default {
    name: 'promote',
    aliases: ['jadikanadmin'],
    category: 'group',
    description: 'Jadikan anggota sebagai admin grup.',
    usage: '.promote @user',
    example: '.promote @user',
    cooldown: 5,
    permissions: ['admin'],
    requireBotAdmin: true,
    tags: ['promote', 'jadikanadmin', 'admin', 'group', 'member'],
    params: {
        type: 'object',
        properties: {
            user: {
                type: 'string',
                description: 'Nomor WhatsApp atau tag anggota yang ingin dijadikan admin',
                required: true
            }
        },
        required: ['user']
    },

    async execute(ctx) {
        const { args, reply, react, chatId, sock, sender, messageContent } = ctx
        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []

        botLogger.admin('promote', chatId, sender)

        const targetJid = parseTargetJid(args, mentionedJids)
        if (!targetJid) return reply(`❌ Tag orang yang mau dipromote.\n*!promote @nomor*`)

        try {
            botLogger.debug('admin', `Promoting ${targetJid} in ${chatId}`)
            await sock.groupParticipantsUpdate(chatId, [targetJid], 'promote')
            botLogger.info('admin', `Promoted ${targetJid} in ${chatId}`)
            await react('⭐')
            return reply(`⭐ *@${targetJid.split('@')[0]}* sekarang jadi admin grup.`, { mentions: [targetJid] })
        } catch (err) {
            botLogger.err('admin', err, 'promote')
            return reply(`❌ Gagal promote: ${err.message}`)
        }
    }
}
