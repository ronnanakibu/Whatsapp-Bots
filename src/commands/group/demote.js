// src/commands/group/demote.js
import { botLogger } from '../../utils/logger.js'
import { parseTargetJid, guardGroup } from '../../utils/group.js'
import { isOwner } from '../../middleware/permission.js'

export default {
    name: 'demote',
    category: 'admin',
    description: 'Copot jabatan admin dari anggota.',
    usage: '.demote @user',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { args, reply, react, chatId, sock, sender, messageContent } = ctx
        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []

        botLogger.admin('demote', chatId, sender)

        if (!await guardGroup(ctx)) return

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
