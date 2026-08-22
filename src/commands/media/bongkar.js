import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'
import { getFfmpegPath } from '../../services/media.js'
import sharp from 'sharp'
import { exec } from 'child_process'
import util from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const execPromise = util.promisify(exec)

/**
 * Robust WebP animation detection:
 * 1. Binary chunk markers: WebP animation spec requires ANIM & ANMF chunks.
 * 2. WA metadata flag (if true).
 * 3. Sharp metadata pages count (> 1).
 */
async function detectWebPAnimated(buffer, flagFromMetadata) {
    // 1. Binary chunk checks (Official WebP specification for animated images)
    const hasANIM = buffer.includes(Buffer.from('ANIM'))
    const hasANMF = buffer.includes(Buffer.from('ANMF'))
    if (hasANIM && hasANMF) {
        logger.info('[Bongkar] Animation confirmed via WebP binary chunks (ANIM + ANMF)')
        return true
    }

    // 2. Metadata flag from WhatsApp (if explicitly true)
    if (flagFromMetadata === true) {
        logger.info('[Bongkar] Animation confirmed via WA message metadata flag')
        return true
    }

    // 3. Sharp metadata ground truth
    let sharpPages = 1
    try {
        const meta = await sharp(buffer, { animated: true }).metadata()
        sharpPages = meta.pages ?? 1
    } catch (e) {
        logger.warn('[Bongkar] Sharp metadata check warning:', e.message)
    }

    const isAnim = sharpPages > 1
    logger.info(`[Bongkar] Animation detection | metaFlag=${flagFromMetadata} | ANIM=${hasANIM} ANMF=${hasANMF} | pages=${sharpPages} | result=${isAnim}`)
    return isAnim
}

export default {
    name: 'bongkar',
    aliases: ['toimg', 'tomp4'],
    category: 'media',
    description: 'Bongkar stiker (ubah kembali menjadi gambar/video)',
    usage: 'Balas stiker dengan .bongkar',
    cooldown: 5,
    permissions: ['user'],
    async execute(ctx) {
        const { msg, messageContent, reply, react, sock, from } = ctx

        // Cari quoted message
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)
        if (!unwrappedQuoted) {
            return reply('⚠️ Balas stikernya dong pakai perintah .bongkar')
        }

        const finalQuotedType = Object.keys(unwrappedQuoted)[0]
        if (finalQuotedType !== 'stickerMessage') {
            return reply('⚠️ Yang dibalas harus berupa stiker, bukan teks atau gambar/video langsung.')
        }

        await react('⏳')
        const stickerMsg = unwrappedQuoted.stickerMessage

        try {
            // Download sticker buffer
            const stream = await downloadContentFromMessage(stickerMsg, 'sticker')
            let buffer = Buffer.from([])
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }

            if (!buffer || buffer.length === 0) {
                throw new Error('Buffer stiker kosong setelah diunduh.')
            }

            // Robust multi-layer animation detection
            const isAnimated = await detectWebPAnimated(buffer, stickerMsg.isAnimated)

            if (isAnimated) {
                // Animated sticker → Direct WebP to MP4 via FFmpeg
                const tmpDir = path.resolve('./storage/media/tmp')
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

                const id = crypto.randomBytes(4).toString('hex')
                const inputWebpPath = path.join(tmpDir, `${id}_in.webp`)
                const fallbackGifPath = path.join(tmpDir, `${id}_fallback.gif`)
                const outputPath = path.join(tmpDir, `${id}_out.mp4`)

                fs.writeFileSync(inputWebpPath, buffer)

                const ffmpegBin = getFfmpegPath()
                try {
                    // Try direct WebP decode in FFmpeg (fast, zero memory overhead, perfect color & full framerate)
                    await execPromise(
                        `${ffmpegBin} -y -i "${inputWebpPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -preset fast -movflags +faststart -an "${outputPath}"`
                    )
                } catch (directErr) {
                    logger.warn('⚠️ [Bongkar] Direct WebP decode failed, attempting GIF bridge fallback:', directErr.message)
                    try {
                        const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer()
                        fs.writeFileSync(fallbackGifPath, gifBuffer)
                        await execPromise(
                            `${ffmpegBin} -y -i "${fallbackGifPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -preset fast -movflags +faststart -an "${outputPath}"`
                        )
                    } catch (gifErr) {
                        logger.error('❌ [Bongkar] Fallback decode also failed:', gifErr.message)
                        throw new Error('Gagal mengonversi animasi WebP ke MP4.')
                    }
                }

                try {
                    const mp4Buffer = fs.readFileSync(outputPath)
                    await sock.sendMessage(from, {
                        video: mp4Buffer,
                        gifPlayback: true,
                        caption: '✅ Stiker animasi berhasil dibongkar!'
                    }, { quoted: getCleanQuoted(msg) })

                    if (process.env.LOG_CHANNEL_JID) {
                        const { logToChannel } = await import('../../utils/channelLogger.js')
                        await logToChannel(sock, {
                            video: mp4Buffer,
                            caption: `[LOG BONGKAR]\nDibongkar oleh: ${ctx.pushName} (@${ctx.sender.split('@')[0]})`
                        })
                    }
                } finally {
                    if (fs.existsSync(inputWebpPath)) fs.unlinkSync(inputWebpPath)
                    if (fs.existsSync(fallbackGifPath)) fs.unlinkSync(fallbackGifPath)
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
                }

            } else {
                // Static sticker → High quality PNG image
                const pngBuffer = await sharp(buffer, { animated: false, page: 0 }).png().toBuffer()
                await sock.sendMessage(from, {
                    image: pngBuffer,
                    caption: '✅ Stiker berhasil dibongkar menjadi gambar!'
                }, { quoted: getCleanQuoted(msg) })

                if (process.env.LOG_CHANNEL_JID) {
                    const { logToChannel } = await import('../../utils/channelLogger.js')
                    await logToChannel(sock, {
                        image: pngBuffer,
                        caption: `[LOG BONGKAR]\nDibongkar oleh: ${ctx.pushName} (@${ctx.sender.split('@')[0]})`
                    })
                }
            }

            await react('✅')

        } catch (err) {
            logger.error('❌ [Bongkar] Error:', err.message)
            await react('❌')
            await reply(`❌ Waduh, gagal membongkar stiker: ${err.message}`)
        }
    }
}

