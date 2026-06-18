// src/commands/media/vidgen.js
// .vidgen — Video generation using zerogpu-aoti/wan2-2-fp8da-aoti-faster (WAN2.1 AI)

import { hfPredict, downloadHFResult, extractVideoUrl } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { logger } from '../../utils/logger.js'

export const vidgenCommand = {
    name: 'vidgen',
    aliases: ['video', 'wan2', 'generatevideo'],
    category: 'media',
    description: 'Hasilkan video pendek dari prompt teks atau gambar (WAN2 AI)',
    usage: '.vidgen [prompt] (reply gambar untuk image-to-video, atau tanpa reply untuk text-to-video)',
    example: '.vidgen a majestic dragon flying over mountains --duration 3.5',
    cooldown: 30,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        let promptText = args.join(' ').trim()
        if (promptText.length === 0) {
            promptText = 'cinematic camera motion, masterpiece, 8k quality, detailed'
        }

        // Parse optional flags
        let duration = 3.5
        const durationMatch = promptText.match(/--duration\s+([\d.]+)/i)
        if (durationMatch) {
            const d = parseFloat(durationMatch[1])
            if (!isNaN(d) && d >= 1 && d <= 5) duration = d
            promptText = promptText.replace(/--duration\s+[\d.]+/gi, '')
        }

        let steps = 6
        const stepsMatch = promptText.match(/--steps\s+(\d+)/i)
        if (stepsMatch) {
            const s = parseInt(stepsMatch[1])
            if (!isNaN(s) && s >= 1 && s <= 15) steps = s
            promptText = promptText.replace(/--steps\s+\d+/gi, '')
        }

        promptText = promptText.trim()

        await react('⏳')
        await reply('🎬 *Generating video...* Proses ini memakan waktu 1-3 menit (ZeroGPU Space Queue).\nHarap tunggu...')

        try {
            // Check if there is an image to reply to
            const imageBuffer = await getImageBuffer(ctx)
            const inputImage = imageBuffer ? new Blob([imageBuffer], { type: 'image/png' }) : null

            const result = await hfPredict(
                'zerogpu-aoti/wan2-2-fp8da-aoti-faster',
                '/generate_video',
                {
                    input_image: inputImage,
                    prompt: promptText,
                    steps: steps,
                    negative_prompt: '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱 of course',
                    duration_seconds: duration,
                    guidance_scale: 1,
                    guidance_scale_2: 1,
                    seed: 42,
                    randomize_seed: true
                },
                { timeout: 240_000 } // WAN2 can take a while on ZeroGPU
            )

            const videoUrl = extractVideoUrl(result)
            if (!videoUrl) throw new Error('Gagal mengekstrak output video')

            const videoBuffer = await downloadHFResult(videoUrl)

            await sock.sendMessage(from, {
                video: videoBuffer,
                caption: `🎬 *Video Generated!*\n📝 *Prompt:* ${promptText}\n⏱️ *Duration:* ${duration}s`,
                gifPlayback: false
            }, { quoted: msg })

            await react('✅')
        } catch (err) {
            logger.error('[Vidgen] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal generate video: ${err.message}`)
        }
    }
}

export default vidgenCommand
