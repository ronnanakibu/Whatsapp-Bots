// src/commands/media/removebg.js
// AI Background Remover & Transparent Sticker Generator

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { writeExifImg } from '../../services/exif.js'
import sharp from 'sharp'
import { logger } from '../../utils/logger.js'

export default {
    name: 'removebg',
    aliases: ['nobg', 'hapusbg', 'transparent', 'transparan', 'nobgsticker'],
    category: 'media',
    description: 'Hapus latar belakang foto secara otomatis dengan AI (jadi PNG transparan / stiker)',
    usage: '.removebg [opsi: --sticker] (balas gambar)',
    cooldown: 10,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, from, sock, commandName } = ctx

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply(
                '🪄 *PANDUAN AI BACKGROUND REMOVER*\n\n' +
                'Balas *(quote)* sebuah foto dengan perintah:\n' +
                '• *.removebg* (untuk hasil gambar PNG transparan)\n' +
                '• *.removebg --sticker* atau *.nobgsticker* (untuk langsung jadi stiker transparan)'
            )
        }

        await react('⏳')
        const startTime = Date.now()

        const isStickerMode =
            args.includes('--s') ||
            args.includes('--sticker') ||
            args.includes('sticker') ||
            commandName.includes('sticker')

        try {
            // 1. Call RMBG AI on HuggingFace
            let outputBuffer = null

            try {
                const result = await hfPredict(
                    'briaai/RMBG-1.4',
                    '/process',
                    { image: buffer },
                    { timeout: 60000, retries: 1 }
                )

                const url = extractResultUrl(result)
                if (url) {
                    outputBuffer = await downloadHFResult(url)
                }
            } catch (hfErr) {
                logger.warn('[RemoveBG] RMBG-1.4 primary failed, trying fallback space:', hfErr.message)
            }

            // Fallback to finegrain cutter if primary space had queue
            if (!outputBuffer) {
                try {
                    const result2 = await hfPredict(
                        'finegrain/finegrain-object-cutter',
                        '/process',
                        {
                            image: buffer,
                            prompt: 'main subject'
                        },
                        { timeout: 60000, retries: 1 }
                    )
                    const url2 = extractResultUrl(result2)
                    if (url2) outputBuffer = await downloadHFResult(url2)
                } catch (err2) {
                    logger.warn('[RemoveBG] Fallback space error:', err2.message)
                }
            }

            if (!outputBuffer) {
                await react('❌')
                return reply('❌ Maaf, AI Background Remover sedang sibuk. Silakan coba lagi beberapa saat.')
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)

            if (isStickerMode) {
                // Convert transparent PNG to animated/static WebP sticker
                const webpBuffer = await sharp(outputBuffer)
                    .resize(512, 512, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp({ quality: 85 })
                    .toBuffer()

                const stickerWithExif = await writeExifImg(webpBuffer, {
                    packname: 'RonnBot Transparent',
                    author: 'AI Background Remover'
                })

                await react('✅')
                await sock.sendMessage(from, { sticker: stickerWithExif })
            } else {
                // Send clean PNG image
                await react('✅')
                await sock.sendMessage(from, {
                    image: outputBuffer,
                    caption: `🪄 *[BACKGROUND REMOVED]*\n⚡ *Diproses dalam:* ${elapsedSec}s\n_Ketik .nobgsticker jika ingin langsung jadi stiker transparan!_`
                })
            }
        } catch (err) {
            logger.error('[RemoveBG] Execution error:', err.message)
            await react('❌')
            return reply(`❌ Gagal menghapus background: ${err.message}`)
        }
    }
}
