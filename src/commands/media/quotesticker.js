// src/commands/media/quotesticker.js
import mediaService from '../../services/media.js'
import { unwrapMessage } from '../../utils/message.js'

export default {
    name: 'anomali',
    aliases: ['qs', 'qc', 'brat'],
    category: 'media',
    description: 'Mengubah teks menjadi stiker anomali kurus tipis ala brat generator',
    usage: '.anomali <teks kamu>',
    cooldown: 3,
    permissions: ['user'],
    async execute(ctx) {
        const { messageContent, args, reply, replyMedia } = ctx

        let targetText = args.join(' ').trim()
        let lqPercent = 0

        // Parse --lq flag (e.g. --lq 90, --lq90, --lq)
        const lqMatch = targetText.match(/--lq\s*(\d{1,3})?/i)
        if (lqMatch) {
            lqPercent = Math.min(100, Math.max(1, parseInt(lqMatch[1] ?? '50', 10)))
            targetText = targetText.replace(/--lq\s*\d{0,3}/gi, '').trim()
        }

        if (!targetText) {
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const unwrappedQuoted = unwrapMessage(quotedMsg)
            if (unwrappedQuoted) {
                const mType = Object.keys(unwrappedQuoted)[0]
                if (mType === 'conversation') {
                    targetText = unwrappedQuoted.conversation
                } else {
                    targetText = unwrappedQuoted[mType]?.text || unwrappedQuoted[mType]?.caption || ''
                }
            }
        }

        if (!targetText) {
            return reply('⚠️ Mana teksnya, cuy? 😭\n\nKetik perintah beserta teks seperti */anomali teks lu* atau balas chat orang lain pakai perintah */anomali*!')
        }

        await reply('⏳ Merender stiker teks anomali kurus tipis...')

        try {
            const buffer = await mediaService.toQuoteSticker(targetText, lqPercent)
            await replyMedia(buffer, 'sticker')
        } catch (err) {
            console.error('❌ Anomali sticker error:', err.message)
            await reply('❌ Gagal meracik stiker anomali, coba cek teksnya lagi cuy!')
        }
    }
}