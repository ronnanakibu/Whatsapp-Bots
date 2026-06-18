// src/commands/media/cam3d.js
// .3d — Perspective 3D camera change using multimodalart/qwen-image-multiple-angles-3d-camera

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { logger } from '../../utils/logger.js'

export const cam3dCommand = {
    name: '3d',
    aliases: ['cam3d', 'perspective', 'sudutpandang'],
    category: 'media',
    description: 'Ubah sudut pandang/perspektif gambar secara 3D (Qwen 3D Camera)',
    usage: '.3d [--azimuth 30] [--elevation 10] [--distance 1.0] (reply gambar)',
    example: '.3d --azimuth 45 --elevation 15 --distance 1.2 (reply gambar)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke gambar yang ingin diubah perspektifnya dulu, lalu ketik *.3d*')
        }

        // Parse flags or default
        const argsStr = args.join(' ')
        let azimuth = 30
        let elevation = 10
        let distance = 1.0

        const azimuthMatch = argsStr.match(/--azimuth\s+(-?[\d.]+)/i)
        if (azimuthMatch) {
            const val = parseFloat(azimuthMatch[1])
            if (!isNaN(val)) azimuth = val
        }

        const elevationMatch = argsStr.match(/--elevation\s+(-?[\d.]+)/i)
        if (elevationMatch) {
            const val = parseFloat(elevationMatch[1])
            if (!isNaN(val)) elevation = val
        }

        const distanceMatch = argsStr.match(/--distance\s+([\d.]+)/i)
        if (distanceMatch) {
            const val = parseFloat(distanceMatch[1])
            if (!isNaN(val) && val > 0) distance = val
        }

        await react('⏳')
        await reply(`📹 *Rotating camera...* (Qwen 3D AI)\n🎥 Azimuth: ${azimuth}°, Elevation: ${elevation}°, Distance: ${distance}x\n_Proses memakan waktu 20-50 detik..._`)

        try {
            const blob = new Blob([buffer], { type: 'image/png' })

            const result = await hfPredict(
                'multimodalart/qwen-image-multiple-angles-3d-camera',
                '/infer_camera_edit',
                {
                    image: blob,
                    azimuth: azimuth,
                    elevation: elevation,
                    distance: distance,
                    seed: 0,
                    randomize_seed: true,
                    guidance_scale: 1,
                    num_inference_steps: 4,
                    height: 1024,
                    width: 1024
                },
                { timeout: 120_000 }
            )

            const outputUrl = extractResultUrl(result)
            if (!outputUrl) {
                logger.error('[3D] Result had no extractable URL:', JSON.stringify(result))
                throw new Error('Tidak ada output gambar 3D yang dihasilkan')
            }

            const outputBuffer = await downloadHFResult(outputUrl)

            await sock.sendMessage(from, {
                image: outputBuffer,
                caption: `📹 *3D Perspective Rendered!*\n🎥 *Azimuth:* ${azimuth}° | *Elevation:* ${elevation}° | *Distance:* ${distance}x`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[3D] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal merubah perspektif 3D: ${err.message}`)
        }
    }
}

export default cam3dCommand
