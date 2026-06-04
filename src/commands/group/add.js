// src/commands/group/add.js
import { botLogger } from '../../utils/logger.js'
import { parseTargetJid, guardGroup } from '../../utils/group.js'

export default {
    name: 'add',
    category: 'admin',
    description: 'Tambah anggota ke grup.',
    usage: '.add 628xxx . @user',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { args, reply, react, chatId, sock, messageContent } = ctx
        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []

        botLogger.admin('add', chatId, ctx.sender)

        if (!await guardGroup(ctx)) return

        const targetJid = parseTargetJid(args, mentionedJids)
        if (!targetJid) {
            return reply(
                `❌ Kasih nomor yang mau ditambah.\n\n` +
                `*!add 628xxxxxxxxxx*\natau tag orangnya: *!add @nomor*`
            )
        }

        try {
            botLogger.debug('admin', `Adding ${targetJid} to ${chatId}`)
            const result = await sock.groupParticipantsUpdate(chatId, [targetJid], 'add')
            const status = result?.[0]?.status

            botLogger.info('admin', `Add result: ${status} for ${targetJid}`)

            const statusMsg = {
                '200': `✅ *@${targetJid.split('@')[0]}* berhasil ditambahkan.`,
                '403': `❌ @${targetJid.split('@')[0]} tidak mengizinkan ditambahkan ke grup.`,
                '404': `❌ Nomor @${targetJid.split('@')[0]} tidak terdaftar di WhatsApp.`,
                '408': `❌ @${targetJid.split('@')[0]} sudah pernah diundang, tunggu undangan diterima.`,
                '409': `⚠️ @${targetJid.split('@')[0]} sudah ada di grup.`,
                '500': `❌ Gagal menambahkan. Internal error.`,
            }

            await react(status === '200' ? '✅' : '❌')
            return reply(statusMsg[status] ?? `Status: ${status}`, { mentions: [targetJid] })

        } catch (err) {
            botLogger.err('admin', err, 'add')
            return reply(`❌ Gagal tambah anggota: ${err.message}`)
        }
    }
}
