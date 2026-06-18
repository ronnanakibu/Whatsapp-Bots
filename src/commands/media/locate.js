// src/commands/media/locate.js
// .locate — Locate/detect objects in an image using nvidia/LocateAnything

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { logger } from '../../utils/logger.js'

export const locateCommand = {
    name: 'locate',
    aliases: ['detect', 'cariobjek', 'temukan'],
    category: 'media',
    description: 'Temukan dan tandai lokasi objek tertentu di dalam gambar (LocateAnything AI)',
    usage: '.locate [nama objek] (reply gambar)',
    example: '.locate cat (reply gambar kucing)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        let category = args.join(' ').trim()
        if (!category) {
            category = 'objects' // locate all objects
        }

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke gambar dulu, lalu ketik *.locate [nama objek]*\nContoh: *.locate cup*')
        }

        await react('⏳')
        await reply(`🔍 *Locating "${category}"...* (LocateAnything AI)\n_Harap tunggu 15-40 detik..._`)

        try {
            const blob = new Blob([buffer], { type: 'image/png' })

            // Predict using nvidia/LocateAnything
            const result = await hfPredict(
                'nvidia/LocateAnything',
                '/run_inference',
                {
                    input_type: 'image',
                    image_file: blob,
                    video_file: null,
                    task_type: 'Detection',
                    category: category,
                    model_mode: 'hybrid',
                    temp: 0.7,
                    top_p: 0.9,
                    top_k: 20,
                    short_size: null,
                    question_override: null,
                    max_video_frames: 4
                },
                { timeout: 120_000 }
            )

            const outputUrl = extractResultUrl(result)
            if (!outputUrl) {
                logger.error('[Locate] Predict result:', JSON.stringify(result))
                throw new Error('Tidak ada output visual dari LocateAnything')
            }

            const highlightedBuffer = await downloadHFResult(outputUrl)

            await sock.sendMessage(from, {
                image: highlightedBuffer,
                caption: `🔍 *Locate Anything!*\n🎯 *Objek dicari:* ${category}\n✨ AI berhasil menandai lokasi objek di atas.`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[Locate] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal melacak objek: ${err.message}`)
        }
    }
}

export default locateCommand
