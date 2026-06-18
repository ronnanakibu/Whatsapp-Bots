import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'
import sharp from 'sharp'
import { exec } from 'child_process'
import util from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const execPromise = util.promisify(exec)

/**
 * Robust WebP animation detection — multi-layer check:
 * 1. isAnimated flag from WA metadata — trust false ABSOLUTELY (WA never lies about static)
 * 2. Binary ANIM+ANMF chunk markers (WebP animation format spec)
 * 3. sharp metadata pages count (ground truth from actual WebP decoder)
 *
 * Root cause of the bug: WA in-app stickers (static) sometimes have
 * extended WebP headers that trip the WEBP+ANIM heuristic. We now
 * require BOTH ANIM and ANMF chunks (not just ANIM) AND corroborate
 * with sharp metadata pages.
 *
 * Decision logic:
 *   - isAnimated=false (from WA)    → ALWAYS static, no further check
 *   - isAnimated=true (from WA)     → confirm with binary+sharp
 *   - isAnimated=undefined          → binary+sharp decide
 */
async function detectWebPAnimated(buffer, flagFromMetadata) {
    const metaIsAnimated = flagFromMetadata

    // If WA explicitly says static → trust it, skip expensive checks
    if (metaIsAnimated === false) {
        logger.info('[Bongkar] isAnimated=false from WA → static (trusted)')
        return false
    }

    // Binary chunk checks (WebP spec: animated WebP MUST have ANIM+ANMF)
    const hasANIM = buffer.includes(Buffer.from('ANIM'))
    const hasANMF = buffer.includes(Buffer.from('ANMF'))
    const binaryAnimated = hasANIM && hasANMF

    // Sharp metadata — most reliable ground truth
    let sharpPages = 1
    try {
        const meta = await sharp(buffer, { animated: true }).metadata()
        sharpPages = meta.pages ?? 1
    } catch (e) {
        logger.warn('[Bongkar] sharp metadata error:', e.message)
    }
    const sharpAnimated = sharpPages > 1

    // Require BOTH binary markers AND sharp to agree for animated
    // This prevents false positives from WA in-app static stickers
    const confirmed = binaryAnimated && sharpAnimated

    logger.info(`[Bongkar] isAnimated=${metaIsAnimated} | ANIM=${hasANIM} ANMF=${hasANMF} | pages=${sharpPages} | final=${confirmed}`)
    return confirmed
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
        const { msg, messageContent, type, reply, react, sock, from } = ctx

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
            // Download sticker
            const stream = await downloadContentFromMessage(stickerMsg, 'sticker')
            let buffer = Buffer.from([])
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }

            // ─── Robust animation detection (4-layer) ─────────────────────
            const isAnimated = await detectWebPAnimated(buffer, stickerMsg.isAnimated)

            if (isAnimated) {
                // Animated sticker → convert to MP4 via GIF bridge
                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer()

                const tmpDir = path.resolve('./storage/media/tmp')
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

                const id = crypto.randomBytes(4).toString('hex')
                const inputPath  = path.join(tmpDir, `${id}.gif`)
                const outputPath = path.join(tmpDir, `${id}.mp4`)

                fs.writeFileSync(inputPath, gifBuffer)

                try {
                    await execPromise(
                        `ffmpeg -i "${inputPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -vcodec libx264 -pix_fmt yuv420p -preset fast "${outputPath}"`
                    )
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
                } catch (ffmpegErr) {
                    logger.error('❌ [Bongkar] FFmpeg error:', ffmpegErr)
                    await reply('❌ Gagal mengonversi stiker animasi ke video. Pastikan ffmpeg terinstall.')
                } finally {
                    if (fs.existsSync(inputPath))  fs.unlinkSync(inputPath)
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
                }

            } else {
                // Static sticker → PNG (force single-frame to prevent animated bleed)
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
            await reply('❌ Waduh, gagal membongkar stiker.')
        }
    }
}
