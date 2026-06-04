import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { logger } from '../../utils/logger.js'
import sharp from 'sharp'
import { exec } from 'child_process'
import util from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const execPromise = util.promisify(exec)

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
        if (!quotedMsg) {
            return reply('⚠️ Balas stikernya dong pakai perintah !bongkar')
        }

        let finalQuotedMsg = quotedMsg
        if (quotedMsg) {
            const quotedType = Object.keys(quotedMsg)[0]
            const wrapperTypes = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            if (wrapperTypes.includes(quotedType)) {
                finalQuotedMsg = quotedMsg[quotedType].message
            }
        }

        const finalQuotedType = finalQuotedMsg ? Object.keys(finalQuotedMsg)[0] : null
        if (finalQuotedType !== 'stickerMessage') {
            return reply('⚠️ Yang dibalas harus berupa stiker, bukan teks atau gambar/video langsung.')
        }

        await react('⏳')
        const stickerMsg = finalQuotedMsg.stickerMessage

        try {
            // Download sticker
            const stream = await downloadContentFromMessage(stickerMsg, 'sticker')
            let buffer = Buffer.from([])
            for await(const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }

            let isAnimated = stickerMsg.isAnimated
            // Fallback check biner WebP
            if (!isAnimated && buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
                isAnimated = buffer.includes(Buffer.from('ANIM'))
            }

            if (isAnimated) {
                // Konversi WebP ke GIF pakai Sharp (bypass cacat FFmpeg)
                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer()

                // GIF -> MP4 menggunakan FFmpeg
                const tmpDir = path.resolve('./storage/media/tmp')
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

                const id = crypto.randomBytes(4).toString('hex')
                const inputPath = path.join(tmpDir, `${id}.gif`)
                const outputPath = path.join(tmpDir, `${id}.mp4`)

                fs.writeFileSync(inputPath, gifBuffer)

                // Convert gif to mp4
                try {
                    await execPromise(`ffmpeg -i ${inputPath} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -vcodec libx264 -pix_fmt yuv420p -preset fast ${outputPath}`)
                    const mp4Buffer = fs.readFileSync(outputPath)
                    await sock.sendMessage(from, { video: mp4Buffer, gifPlayback: true, caption: '✅ Stiker berhasil dibongkar menjadi video animasi!' }, { quoted: msg })
                    
                    if (process.env.LOG_CHANNEL_JID) {
                        const { logToChannel } = await import('../../utils/channelLogger.js')
                        await logToChannel(sock, { video: mp4Buffer, caption: `[LOG BONGKAR]\nDibongkar oleh: ${ctx.pushName} (@${ctx.sender.split('@')[0]})` })
                    }
                } catch (ffmpegErr) {
                    logger.error('❌ [Bongkar] FFmpeg error:', ffmpegErr)
                    await reply('❌ Gagal mengonversi stiker gerak ke video. Pastikan ffmpeg terinstall di server.')
                } finally {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
                }

            } else {
                // Sticker -> PNG menggunakan Sharp
                const pngBuffer = await sharp(buffer).png().toBuffer()
                await sock.sendMessage(from, { image: pngBuffer, caption: '✅ Stiker berhasil dibongkar menjadi gambar!' }, { quoted: msg })
                
                if (process.env.LOG_CHANNEL_JID) {
                    const { logToChannel } = await import('../../utils/channelLogger.js')
                    await logToChannel(sock, { image: pngBuffer, caption: `[LOG BONGKAR]\nDibongkar oleh: ${ctx.pushName} (@${ctx.sender.split('@')[0]})` })
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
