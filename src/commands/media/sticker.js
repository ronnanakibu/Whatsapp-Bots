// src/commands/media/sticker.js
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import mediaService from '../../services/media.js'
import { logger } from '../../utils/logger.js'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'

export default {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    category: 'media',
    description: 'Convert media to sticker (Original Ratio: --1 | Remove BG: --rmbg | Speed: --s2x, --s1.5x | Low Quality: --lq [1-100])',
    usage: '.sticker [--1] [--rmbg] [--s2x] [--lq 80] Teks Atas | Teks Bawah',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { msg, messageContent, type, args, reply, react, from, pushName, sender, sock } = ctx


        // Helper to check if unwrapped message contains media
        const isMediaMsg = (m) => {
            if (!m) return false
            const mType = Object.keys(m)[0]
            if (mType === 'imageMessage' || mType === 'videoMessage' || mType === 'ptvMessage' || mType === 'stickerMessage') return true
            if (mType === 'documentMessage') {
                const mime = m.documentMessage?.mimetype || ''
                return mime.startsWith('image/') || mime.startsWith('video/')
            }
            return false
        }

        // Helper to check if media is animated (video, gif, animated sticker, ptv)
        const checkAnimated = (m) => {
            if (!m) return false
            const mType = Object.keys(m)[0]
            if (mType === 'videoMessage' || mType === 'ptvMessage') return true
            if (mType === 'stickerMessage' && m.stickerMessage?.isAnimated) return true
            if (mType === 'documentMessage') {
                const mime = m.documentMessage?.mimetype || ''
                return mime.startsWith('video/')
            }
            return false
        }

        // 1. Unwrap current message content and quoted message
        const unwrappedDirect = unwrapMessage(messageContent)
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        const hasDirectMedia = isMediaMsg(unwrappedDirect)
        const hasQuotedMedia = isMediaMsg(unwrappedQuoted)

        if (!hasDirectMedia && !hasQuotedMedia) {
            return reply('⚠️ Mana gambarnya, cuy? 😭\n\nKirim gambar/video/stiker dengan caption atau balas media lama dengan perintah *.s Teks Atas | Teks Bawah* !')
        }

        logger.info('⏳ Sedang di-masak Dik, stiker teks meme lu lagi diproses...')

        try {
            let buffer
            if (hasDirectMedia) {
                const reconstructedMsg = {
                    key: msg.key,
                    message: unwrappedDirect
                }
                buffer = await downloadMediaMessage(reconstructedMsg, 'buffer', {}, {
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
                    message: unwrappedQuoted,
                }
                buffer = await downloadMediaMessage(reconstructedQuotedMsg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })
            }

            // ── 🌟 LOGIKA PARSER PARAMETER (OR CONDITION / ANYWHERE PLACEMENT) ──
            let fullText = args.join(' ').trim()
            let noCrop = false
            let removeBg = false
            let lqPercent = 0
            let speedMultiplier = 1.0

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

            // Deteksi speed up flag --s<multiplier>x atau --s<multiplier> (misal --s2x, --s1.5x, --s0.5x, --s3x)
            const speedMatch = fullText.match(/--s(\d+(?:\.\d+)?)(?:x)?/i)
            if (speedMatch) {
                speedMultiplier = Math.min(10.0, Math.max(0.1, parseFloat(speedMatch[1])))
                fullText = fullText.replace(/--s\d+(?:\.\d+)?(?:x)?/gi, '').trim()
            }

            // Deteksi --lq [0-100]: bisa --lq 80 atau --lq80
            const lqMatch = fullText.match(/--lq\s*(\d{1,3})?/i)
            if (lqMatch) {
                lqPercent = Math.min(100, Math.max(1, parseInt(lqMatch[1] ?? '50', 10)))
                fullText = fullText.replace(/--lq\s*\d{0,3}/gi, '').trim()
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
            if (hasDirectMedia) {
                isAnimated = checkAnimated(unwrappedDirect)
            } else {
                isAnimated = checkAnimated(unwrappedQuoted)
            }

            // Fallback: Cek biner header WebP jika tipe datanya tidak terbaca langsung oleh Baileys
            if (!isAnimated && buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
                isAnimated = buffer.includes(Buffer.from('ANIM'))
            }

            // 3. Alirkan buffer ke core service pemrosesan masing-masing
            let stickerBuffer
            if (isAnimated) {
                logger.info(`⏳ Menjalankan rendering ANIMASI (noCrop: ${noCrop}, removeBg: ${removeBg}, lq: ${lqPercent}%, speed: ${speedMultiplier}x)`)
                if (removeBg) {
                    await reply('🔥 *Siksa CPU Dimulai:* Memecah frame & memproses batch rmbg hulu animasi. Tunggu sebentar ya, cuy...')
                }
                stickerBuffer = await mediaService.toAnimatedMemeSticker(buffer, topText, bottomText, noCrop, removeBg, lqPercent, speedMultiplier)
            } else {
                logger.info(`⏳ Menjalankan rendering STATIS (noCrop: ${noCrop}, removeBg: ${removeBg}, lq: ${lqPercent}%)`)
                stickerBuffer = await mediaService.toMemeSticker(buffer, topText, bottomText, noCrop, removeBg, lqPercent)
            }

            // 4. Kirimkan stiker hasil komposit ke room obrolan
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: getCleanQuoted(msg) })

            // Kirimkan salinan log ke channel internal jika dikonfigurasi
            if (process.env.LOG_CHANNEL_JID) {
                const { logToChannel } = await import('../../utils/channelLogger.js')
                await logToChannel(sock, { sticker: stickerBuffer })
                await logToChannel(sock, { text: `[LOG STICKER]\nDibuat oleh: ${pushName}\nCommand Text: ${fullText || '(tanpa teks)'}\nNoCrop: ${noCrop} | RemoveBg: ${removeBg} | LQ: ${lqPercent}% | Speed: ${speedMultiplier}x` })
            }


            await react('✅')

        } catch (err) {
            logger.error(err, '❌ [Sticker Command Error]')
            await react('❌')
            await reply(`❌ Gagal mengeksekusi stiker: ${err.message}`)
        }
    }
}