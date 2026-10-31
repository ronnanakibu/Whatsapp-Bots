// src/commands/group/demote.js
import { botLogger } from '../../utils/logger.js'
import { parseTargetJid } from '../../utils/group.js'
import { isOwner } from '../../middleware/permission.js'

export default {
    name: 'demote',
    aliases: ['turunkan'],
    category: 'group',
    description: 'Copot jabatan admin dari anggota.',
    usage: '.demote @user',
    example: '.demote @user',
    cooldown: 5,
    permissions: ['admin'],
    requireBotAdmin: true,
    tags: ['demote', 'turunkan', 'admin', 'group', 'member'],
    params: {
        type: 'object',
        properties: {
            user: {
                type: 'string',
                description: 'Nomor atau tag admin yang ingin diturunkan jabatannya',
                required: true
            }
        },
        required: ['user']
    },

    async execute(ctx) {
        const { args, reply, react, chatId, sock, sender, messageContent } = ctx
        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []

        botLogger.admin('demote', chatId, sender)

        const targetJid = parseTargetJid(args, mentionedJids)
        if (!targetJid) return reply(`❌ Tag orang yang mau di-demote.\n*!demote @nomor*`)

        if (isOwner(targetJid)) return reply(`❌ Tidak bisa demote owner bot.`)

        try {
            botLogger.debug('admin', `Demoting ${targetJid} in ${chatId}`)
            await sock.groupParticipantsUpdate(chatId, [targetJid], 'demote')
            botLogger.info('admin', `Demoted ${targetJid} in ${chatId}`)
            await react('🔽')
            return reply(`🔽 *@${targetJid.split('@')[0]}* dicopot dari admin grup.`, { mentions: [targetJid] })
        } catch (err) {
            botLogger.err('admin', err, 'demote')
            return reply(`❌ Gagal demote: ${err.message}`)
        }
    }
}
