// src/commands/group/pin.js
import { guardGroup } from '../../utils/group.js'

export default {
    name: 'pin',
    category: 'admin',
    description: 'Pin atau unpin pesan yang di-reply.',
    usage: '.pin [24h/7d/30d/unpin] (reply pesan)',
    example: '.pin 24h',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { msg, args, reply, react, sock, chatId, isGroup } = ctx

        // Dapatkan informasi pesan yang di-reply
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsgId = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        if (!quotedMsgId) {
            return reply('⚠️ Silakan reply pesan yang ingin di-pin atau di-unpin!')
        }

        // Tentukan apakah pesan dikirim oleh bot sendiri
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
        const fromMe = ctx.isReplyToBot || (quotedParticipant ? (quotedParticipant.split(':')[0] + '@s.whatsapp.net' === botJid) : false)

        const key = {
            remoteJid: chatId,
            fromMe,
            id: quotedMsgId,
            participant: isGroup ? quotedParticipant : undefined
        }

        // Cek jika grup, pastikan bot adalah admin grup
        if (isGroup) {
            if (!await guardGroup(ctx)) return
        }

        const option = args[0]?.toLowerCase()
        let type = 1 // 1 = Pin
        let time = 604800 // default 7 hari

        if (option === 'unpin' || option === 'off' || option === 'remove' || option === 'batal') {
            type = 0
        } else if (option === '24h' || option === '1d' || option === '24jam') {
            time = 86400
        } else if (option === '30d' || option === '30hari') {
            time = 2592000
        } else if (option === '7d' || option === '7hari') {
            time = 604800
        }

        await react('⏳')
        try {
            await sock.sendMessage(chatId, {
                pin: {
                    type,
                    time,
                    key
                }
            })
            await react('✅')
            
            if (type === 1) {
                const durationText = time === 86400 ? '24 Jam' : time === 2592000 ? '30 Hari' : '7 Hari'
                return reply(`✅ Pesan berhasil di-pin selama ${durationText}.`)
            } else {
                return reply(`✅ Pesan berhasil di-unpin.`)
            }
        } catch (err) {
            await react('❌')
            return reply(`❌ Gagal pin/unpin pesan: ${err.message}`)
        }
    }
}
