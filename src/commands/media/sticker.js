// src/commands/media/sticker.js
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import mediaService from '../../services/media.js'
import { logger } from '../../utils/logger.js'

export default {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    category: 'media',
    description: 'Convert image to a clean square-cropped meme sticker with text overlay',
    usage: '.sticker Teks Atas | Teks Bawah',
    cooldown: 5,
    permissions: ['user'],
    async execute(ctx) {
        const { msg, messageContent, type, args, reply, replyMedia } = ctx

        // Cek Apakah pesan berupa gambar/video/stiker langsung atau meng-quote gambar/video/stiker
        let isMedia = type === 'imageMessage' || type === 'videoMessage' || type === 'stickerMessage'
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage

        let finalQuotedMsg = quotedMsg
        if (quotedMsg) {
            const quotedType = Object.keys(quotedMsg)[0]
            const wrapperTypes = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            if (wrapperTypes.includes(quotedType)) {
                finalQuotedMsg = quotedMsg[quotedType].message
            }
        }

        const finalQuotedType = finalQuotedMsg ? Object.keys(finalQuotedMsg)[0] : null
        let isQuotedMedia = finalQuotedType === 'imageMessage' || finalQuotedType === 'videoMessage' || finalQuotedType === 'stickerMessage'

        if (!isMedia && !isQuotedMedia) {
            return reply('⚠️ Mana gambarnya, cuy? 😭\n\nKirim gambar/video/stiker dengan caption atau balas media lama dengan perintah *.s Teks Atas | Teks Bawah* !')
        }

        logger.info('⏳ Sedang di-masak Dik, stiker teks meme lu lagi diproses...')

        try {
            const targetMessage = isMedia ? msg : { message: quotedMsg, key: msg.key }

            // Unduh buffer biner media dari server WA
            const buffer = await downloadMediaMessage(
                targetMessage,
                'buffer',
                {},
                {
                    logger: console,
                    reconnectCount: 3
                }
            )

            // 🌟 LOGIKA SPLITTER PARSER: Ambil teks setelah command dan bagi berdasarkan karakter "|"
            const fullText = args.join(' ')
            let topText = ''
            let bottomText = ''

            if (fullText) {
                const parts = fullText.split('|')
                topText = parts[0] ? parts[0].trim() : ''
                bottomText = parts[1] ? parts[1].trim() : ''
            }

            let isAnimated = false
            if (isMedia) {
                isAnimated = type === 'videoMessage' || msg.message?.videoMessage?.gifPlayback || (type === 'stickerMessage' && msg.message?.stickerMessage?.isAnimated)
            } else if (finalQuotedMsg) {
                isAnimated = finalQuotedType === 'videoMessage' || finalQuotedMsg[finalQuotedType]?.gifPlayback || (finalQuotedType === 'stickerMessage' && finalQuotedMsg[finalQuotedType]?.isAnimated)
            }

            let stickerBuffer
            if (isAnimated) {
                logger.info('⏳ Processing ANIMATED sticker with FFmpeg...')
                stickerBuffer = await mediaService.toAnimatedMemeSticker(buffer, topText, bottomText)
            } else {
                logger.info('⏳ Processing STATIC sticker with Sharp...')
                stickerBuffer = await mediaService.toMemeSticker(buffer, topText, bottomText)
            }

            // Muntahkan hasilnya dalam wujud stiker berkas WebP
            await replyMedia(stickerBuffer, 'sticker')

        } catch (err) {
            console.error('❌ Meme sticker command error:', err.message)
            await reply('❌ Waduh sorry cuy, gagal total pas meracik stiker teks meme. Pastikan gambarnya aman!')
        }
    }
}