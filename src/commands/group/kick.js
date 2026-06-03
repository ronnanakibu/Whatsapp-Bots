// src/commands/group/kick.js
import { botLogger } from '../../utils/logger.js'
import { parseTargetJid, guardGroup } from '../../utils/group.js'
import { isOwner, isGroupAdmin, normalizeJid } from '../../middleware/permission.js'

export default {
    name: 'kick',
    aliases: ['remove'],
    category: 'admin',
    description: 'Keluarkan anggota dari grup.',
    usage: '!kick @user',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { args, reply, react, chatId, sock, sender, messageContent } = ctx
        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []

        botLogger.admin('kick', chatId, sender)

        if (!await guardGroup(ctx)) return

        const targetJid = parseTargetJid(args, mentionedJids)
        if (!targetJid) {
            return reply(`❌ Tag atau masukkan nomor yang mau dikick.\n*!kick @nomor*`)
        }

        const botJid = normalizeJid(sock.user?.id ?? '')
        if (targetJid === botJid) return reply(`❌ Tidak bisa kick bot sendiri 😅`)

        if (isOwner(targetJid)) {
            return reply(`❌ Tidak bisa kick owner bot.`)
        }

        const targetIsAdmin = await isGroupAdmin(sock, chatId, targetJid)
        const senderIsOwner = isOwner(sender)
        if (targetIsAdmin && !senderIsOwner) {
            return reply(`❌ Tidak bisa kick admin grup. Demote dulu.`)
        }

        try {
            botLogger.debug('admin', `Kicking ${targetJid} from ${chatId}`)
            await sock.groupParticipantsUpdate(chatId, [targetJid], 'remove')
            botLogger.info('admin', `Kicked ${targetJid} from ${chatId}`)
            await react('👢')
            return reply(`👢 *@${targetJid.split('@')[0]}* telah dikeluarkan dari grup.`, { mentions: [targetJid] })
        } catch (err) {
            botLogger.err('admin', err, 'kick')
            return reply(`❌ Gagal kick: ${err.message}`)
        }
    }
}
