// src/commands/media/upscale.js
// .upscale — Upscale image using selfit-camera/Omni-Image-Editor's High-Speed HD Mode

import { hfPredict, downloadHFResult } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { logger } from '../../utils/logger.js'

export function extractImageUrlFromHtml(html) {
    if (typeof html !== 'string') return null
    const srcMatch = html.match(/src=['"]([^'"]+)['"]/i)
    if (srcMatch) return srcMatch[1]
    const hrefMatch = html.match(/href=['"]([^'"]+)['"]/i)
    if (hrefMatch) return hrefMatch[1]
    return null
}

export const upscaleCommand = {
    name: 'upscale',
    aliases: ['hd2', 'superres', 'omniupscale'],
    category: 'media',
    description: 'Tingkatkan resolusi gambar ke HD dengan Omni Image Upscaler',
    usage: '.upscale (reply gambar)',
    example: '.upscale (reply gambar)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, react, sock, from, msg } = ctx

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke gambar dulu, lalu ketik *.upscale*')
        }

        await react('⏳')
        await reply('🔧 *Upscaling image...* (Omni HD Upscaler)\n_Proses membutuhkan 15-40 detik..._')

        try {
            const blob = new Blob([buffer], { type: 'image/png' })

            // Predict using selfit-camera/Omni-Image-Editor
            const result = await hfPredict(
                'selfit-camera/Omni-Image-Editor',
                '/image_upscale_interface',
                {
                    input_image: blob
                },
                { timeout: 120_000 }
            )

            const html = result?.data?.[0]
            const imgUrl = extractImageUrlFromHtml(html)

            if (!imgUrl) {
                logger.error('[Upscale] Invalid response structure:', JSON.stringify(result?.data))
                throw new Error('Gagal mengekstrak URL hasil upscale dari respon server.')
            }

            const upscaledBuffer = await downloadHFResult(imgUrl)

            await sock.sendMessage(from, {
                image: upscaledBuffer,
                caption: '✨ *Upscale Berhasil!* Gambar ditingkatkan ke resolusi ultra HD.',
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[Upscale] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal upscale: ${err.message}`)
        }
    }
}

export default upscaleCommand
