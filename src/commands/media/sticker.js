// src/commands/media/sticker.js
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import mediaService from '../../services/media.js'
import { logger } from '../../utils/logger.js'

export default {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    category: 'media',
    description: 'Convert media to sticker (Original Ratio: --1 | Remove Background: --rmbg)',
    usage: '.sticker [--1] [--rmbg] Teks Atas | Teks Bawah',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { msg, messageContent, type, args, reply, react, from, pushName, sender, sock } = ctx

        // 1. Cek validasi keberadaan media (langsung atau via quoted reply)
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
                buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })
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
                buffer = await downloadMediaMessage(reconstructedQuotedMsg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })
            }

            // ── 🌟 LOGIKA PARSER PARAMETER (OR CONDITION / ANYWHERE PLACEMENT) ──
            let fullText = args.join(' ').trim()
            let noCrop = false
            let removeBg = false

            // Deteksi global flag --1 di mana saja dan bersihkan dari teks utama
            if (fullText.includes('--1')) {
                noCrop = true
                fullText = fullText.replace(/--1/g, '').trim()
            }

            // Deteksi global flag --rmbg di mana saja dan bersihkan dari teks utama
            if (fullText.includes('--rmbg')) {
                removeBg = true
                fullText = fullText.replace(/--rmbg/g, '').trim()
            }

            // Normalkan space yang ganda akibat proses replace regex di atas
            fullText = fullText.replace(/\s+/g, ' ').trim()

            let topText = ''
            let bottomText = ''

            if (fullText) {
                const parts = fullText.split('|')
                topText = parts[0] ? parts[0].trim() : ''
                bottomText = parts[1] ? parts[1].trim() : ''
            }

            // 2. Deteksi status animasi media (Video / GIF / Sticker Animasi)
            let isAnimated = false
            if (isMedia) {
                isAnimated = type === 'videoMessage' || msg.message?.videoMessage?.gifPlayback || (type === 'stickerMessage' && msg.message?.stickerMessage?.isAnimated)
            } else if (finalQuotedMsg) {
                isAnimated = finalQuotedType === 'videoMessage' || finalQuotedMsg[finalQuotedType]?.gifPlayback || (finalQuotedType === 'stickerMessage' && finalQuotedMsg[finalQuotedType]?.isAnimated)
            }

            // Fallback: Cek biner header WebP jika tipe datanya tidak terbaca langsung oleh Baileys
            if (!isAnimated && buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
                isAnimated = buffer.includes(Buffer.from('ANIM'))
            }

            // 3. Alirkan buffer ke core service pemrosesan masing-masing
            let stickerBuffer
            if (isAnimated) {
                logger.info(`⏳ Menjalankan rendering ANIMASI (noCrop: ${noCrop}, removeBg: ${removeBg})`)
                if (removeBg) {
                    await reply('🔥 *Siksa CPU Dimulai:* Memecah frame & memproses batch rmbg hulu animasi. Tunggu sebentar ya, cuy...')
                }
                stickerBuffer = await mediaService.toAnimatedMemeSticker(buffer, topText, bottomText, noCrop, removeBg)
            } else {
                logger.info(`⏳ Menjalankan rendering STATIS (noCrop: ${noCrop}, removeBg: ${removeBg})`)
                stickerBuffer = await mediaService.toMemeSticker(buffer, topText, bottomText, noCrop, removeBg)
            }

            // 4. Kirimkan stiker hasil komposit ke room obrolan
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg })

            // Kirimkan salinan log ke channel internal jika dikonfigurasi
            if (process.env.LOG_CHANNEL_JID) {
                const { logToChannel } = await import('../../utils/channelLogger.js')
                await logToChannel(sock, { sticker: stickerBuffer })
                await logToChannel(sock, { text: `[LOG STICKER]\nDibuat oleh: ${pushName}\nCommand Text: ${fullText || '(tanpa teks)'}\nNoCrop: ${noCrop} | RemoveBg: ${removeBg}` })
            }

            await react('✅')

        } catch (err) {
            logger.error('❌ [Sticker Command Error]:', err.message)
            await react('❌')
            await reply(`❌ Gagal mengeksekusi stiker: ${err.message}`)
        }
    }
}