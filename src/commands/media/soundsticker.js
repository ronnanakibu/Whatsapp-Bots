// src/commands/media/soundsticker.js
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import soundStickerService from '../../services/soundSticker.js'
import mediaService from '../../services/media.js'
import { logger } from '../../utils/logger.js'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'

export default {
    name: 'soundsticker',
    aliases: ['sa', 'stikersuara', 'soundstiker', 'stickersound', 'stikersound'],
    category: 'media',
    description: 'Convert video atau gambar+audio menjadi stiker bersuara (WhatsApp Sound Sticker)',
    usage: '.sa [--1] [--rmbg] [--s2x] [--max 10] [--lq 80] [Teks Atas | Teks Bawah]',
    example: '.sa (reply video/gif) | .sa Lucu Banget | Wkwk',
    cooldown: 5,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['sticker', 'soundsticker', 'sa', 'stikersuara', 'audio', 'media'],
    params: {
        type: 'object',
        properties: {
            topText: {
                type: 'string',
                description: 'Teks meme di bagian atas stiker'
            },
            bottomText: {
                type: 'string',
                description: 'Teks meme di bagian bawah stiker'
            }
        },
        required: []
    },

    async execute(ctx) {
        const { msg, messageContent, type, args, reply, react, from, sock } = ctx

        const isMediaMsg = (m) => {
            if (!m) return false
            const mType = Object.keys(m)[0]
            if (mType === 'imageMessage' || mType === 'videoMessage' || mType === 'ptvMessage' || mType === 'stickerMessage' || mType === 'audioMessage') return true
            if (mType === 'documentMessage') {
                const mime = m.documentMessage?.mimetype || ''
                return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')
            }
            return false
        }

        const isAudioMsg = (m) => {
            if (!m) return false
            const mType = Object.keys(m)[0]
            if (mType === 'audioMessage') return true
            if (mType === 'documentMessage') {
                const mime = m.documentMessage?.mimetype || ''
                return mime.startsWith('audio/')
            }
            return false
        }

        const unwrappedDirect = unwrapMessage(messageContent)
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        const hasDirectMedia = isMediaMsg(unwrappedDirect)
        const hasQuotedMedia = isMediaMsg(unwrappedQuoted)

        if (!hasDirectMedia && !hasQuotedMedia) {
            return reply('🔊 *WhatsApp Sound Sticker Generator*\n\n⚠️ Silakan kirim video atau balas video/GIF dengan perintah *.sa [Teks Atas | Teks Bawah]*!\n\n💡 *Tips:* Kamu juga bisa membalas voice note/audio sambil mengirim gambar dengan caption *.sa* untuk membuat stiker bergambar dengan suara tersebut!')
        }

        logger.info('⏳ Meracik stiker bersuara (WhatsApp Sound Sticker)...')

        try {
            let primaryBuffer = null
            let audioBuffer = null

            // Download primary media
            if (hasDirectMedia) {
                const reconstructedMsg = {
                    key: msg.key,
                    message: unwrappedDirect
                }
                primaryBuffer = await downloadMediaMessage(reconstructedMsg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })
            }

            // Download quoted media if available
            if (hasQuotedMedia) {
                const quotedKey = messageContent?.extendedTextMessage?.contextInfo
                const reconstructedQuotedMsg = {
                    key: {
                        remoteJid: from,
                        id: quotedKey?.stanzaId ?? '',
                        fromMe: quotedKey?.participant === sock.user?.id,
                    },
                    message: unwrappedQuoted,
                }
                const quotedBuffer = await downloadMediaMessage(reconstructedQuotedMsg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })

                if (!primaryBuffer) {
                    primaryBuffer = quotedBuffer
                } else if (isAudioMsg(unwrappedQuoted)) {
                    audioBuffer = quotedBuffer
                } else if (isAudioMsg(unwrappedDirect)) {
                    audioBuffer = primaryBuffer
                    primaryBuffer = quotedBuffer
                }
            }

            if (!primaryBuffer) {
                return reply('❌ Gagal mengunduh media sumber untuk stiker bersuara.')
            }

            // ── Flag parser ──
            let fullText = args.join(' ').trim()
            let noCrop = false
            let removeBg = false
            let lqPercent = 0
            let speedMultiplier = 1.0
            let maxDuration = 10 // WhatsApp sound sticker ideal duration is up to 10s

            if (fullText.includes('--1')) {
                noCrop = true
                fullText = fullText.replace(/--1/g, '').trim()
            }
            if (fullText.includes('--rmbg')) {
                removeBg = true
                fullText = fullText.replace(/--rmbg/g, '').trim()
            }
            const speedMatch = fullText.match(/--s(\d+(?:\.\d+)?)(?:x)?/i)
            if (speedMatch) {
                speedMultiplier = Math.min(10.0, Math.max(0.1, parseFloat(speedMatch[1])))
                fullText = fullText.replace(/--s\d+(?:\.\d+)?(?:x)?/gi, '').trim()
            }
            const maxMatch = fullText.match(/--max(?:\s*(\d{1,3}))?/i)
            if (maxMatch) {
                maxDuration = Math.min(10, Math.max(1, parseInt(maxMatch[1] || '10', 10)))
                fullText = fullText.replace(/--max(?:\s*\d{0,3})?/gi, '').trim()
            }
            const lqMatch = fullText.match(/--lq\s*(\d{1,3})?/i)
            if (lqMatch) {
                lqPercent = Math.min(100, Math.max(1, parseInt(lqMatch[1] ?? '50', 10)))
                fullText = fullText.replace(/--lq\s*\d{0,3}/gi, '').trim()
            }

            fullText = fullText.replace(/\s+/g, ' ').trim()
            let topText = ''
            let bottomText = ''
            if (fullText) {
                const parts = fullText.split('|')
                topText = parts[0] ? parts[0].trim() : ''
                bottomText = parts[1] ? parts[1].trim() : ''
            }

            // Check if primary buffer is video / animated
            const isVideo = (hasDirectMedia && (unwrappedDirect.videoMessage || unwrappedDirect.ptvMessage)) ||
                            (hasQuotedMedia && (unwrappedQuoted?.videoMessage || unwrappedQuoted?.ptvMessage))

            const isStatic = !isVideo && !audioBuffer

            await react('⏳')

            const result = await soundStickerService.createSoundStickerData(primaryBuffer, {
                audioBuffer,
                topText,
                bottomText,
                noCrop,
                removeBg,
                lqPercent,
                speedMultiplier,
                maxDuration,
                isStatic
            })

            if (result.hasAudio && result.audio) {
                // Send as official WhatsApp Sound Sticker
                await soundStickerService.sendSoundSticker(sock, from, {
                    sticker: result.sticker,
                    audio: result.audio,
                    durationMs: result.durationMs,
                    quoted: getCleanQuoted(msg)
                })
                await react('🔊')
            } else {
                // Fallback to normal sticker if video has no audio
                await sock.sendMessage(from, { sticker: result.sticker }, { quoted: getCleanQuoted(msg) })
                await react('✅')
                await reply('⚠️ *Catatan:* Media ini tidak memiliki trek audio/suara, jadi dikirim sebagai stiker biasa ya cuy!')
            }

            // Log to internal channel if configured
            if (process.env.LOG_CHANNEL_JID) {
                const { logToChannel } = await import('../../utils/channelLogger.js')
                await logToChannel(sock, { sticker: result.sticker })
            }

        } catch (err) {
            logger.error(err, '❌ [SoundSticker Command Error]')
            await react('❌')
            await reply(`❌ Gagal meracik stiker bersuara: ${err.message}`)
        }
    }
}
