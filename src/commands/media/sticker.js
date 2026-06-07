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
        const { msg, messageContent, type, args, reply, react, from, pushName, sender, sock } = ctx

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
            let buffer
            if (isMedia) {
                buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                        logger: console,
                        reconnectCount: 3,
                        reuploadRequest: sock.updateMediaMessage
                    }
                )
            } else {
                const quotedKey = messageContent?.extendedTextMessage?.contextInfo
                const reconstructedQuotedMsg = {
                    key: {
                        remoteJid: from,
                        id: quotedKey?.stanzaId ?? '',
                        fromMe: quotedKey?.participant === sock.user?.id,
                    },
                    message: finalQuotedMsg,
                }
                buffer = await downloadMediaMessage(
                    reconstructedQuotedMsg,
                    'buffer',
                    {},
                    {
                        logger: console,
                        reconnectCount: 3,
                        reuploadRequest: sock.updateMediaMessage
                    }
                )
            }

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

            // FALLBACK: Kadang WA pembuat stiker bawaan gak nge-set isAnimated=true di metadata.
            // Jadi kita cek langsung dari dalam struktur biner file WebP-nya!
            if (!isAnimated && buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
                isAnimated = buffer.includes(Buffer.from('ANIM'))
            }

            let stickerBuffer
            if (isAnimated) {
                logger.info('⏳ Processing ANIMATED sticker with FFmpeg...')
                stickerBuffer = await mediaService.toAnimatedMemeSticker(buffer, topText, bottomText)
            } else {
                logger.info('⏳ Processing STATIC sticker with Sharp...')
                stickerBuffer = await mediaService.toMemeSticker(buffer, topText, bottomText)
            }

            // Kirim balasan
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg })

            // Log ke channel
            if (process.env.LOG_CHANNEL_JID) {
                const { logToChannel } = await import('../../utils/channelLogger.js')
                await logToChannel(sock, { sticker: stickerBuffer })
                await logToChannel(sock, { text: `[LOG STICKER]\nDibuat oleh: ${pushName} (@${sender.split('@')[0]})\nCommand: ${fullText || '(no text)'}` })
            }

            await react('✅')

        } catch (err) {
            logger.error('❌ [Sticker] Error:', err.message)
            await react('❌')
            await reply('❌ Waduh, gagal bikin stikernya. Pastikan gambarnya jelas atau coba teks yang lebih pendek.')
        }
    }
}