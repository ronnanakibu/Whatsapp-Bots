// src/commands/media/ilusi.js
// .ilusi — Illusion Diffusion image generation using AP123/IllusionDiffusion

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import axios from 'axios'

const PATTERNS = {
    spiral: 'https://huggingface.co/spaces/AP123/IllusionDiffusion/resolve/main/spiral.jpeg',
    checkers: 'https://huggingface.co/spaces/AP123/IllusionDiffusion/resolve/main/checkers.png',
    pattern: 'https://huggingface.co/spaces/AP123/IllusionDiffusion/resolve/main/pattern.png',
}

// Simple in-memory cache for default pattern buffers
const patternCache = new Map()

async function getPatternBuffer(patternName) {
    const url = PATTERNS[patternName] || PATTERNS.spiral
    if (patternCache.has(url)) return patternCache.get(url)

    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    const buffer = Buffer.from(res.data)
    patternCache.set(url, buffer)
    return buffer
}

export const ilusiCommand = {
    name: 'ilusi',
    aliases: ['illusion', 'diffuse'],
    category: 'media',
    description: 'Buat gambar ilusi optik keren dari pola tertentu',
    usage: '.ilusi [prompt] (reply gambar pola) ATAU .ilusi [prompt] [--pattern spiral/checkers/pattern] [--strength 0.8]',
    example: '.ilusi a medieval village in winter --pattern spiral --strength 0.95',
    cooldown: 30,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        if (args.length === 0) {
            return reply('⚠️ Masukkan prompt deskripsi gambar.\nContoh: *.ilusi medieval village --pattern spiral*')
        }

        // Parse arguments & flags
        let promptText = args.join(' ')
        let patternName = 'spiral'
        let strength = 0.8 // controlnet_conditioning_scale

        // Extract --pattern flag
        const patternMatch = promptText.match(/--pattern\s+(\w+)/i)
        if (patternMatch) {
            const p = patternMatch[1].toLowerCase()
            if (PATTERNS[p]) patternName = p
            promptText = promptText.replace(/--pattern\s+\w+/gi, '')
        }

        // Extract --strength flag
        const strengthMatch = promptText.match(/--strength\s+([\d.]+)/i)
        if (strengthMatch) {
            const val = parseFloat(strengthMatch[1])
            if (!isNaN(val) && val >= 0 && val <= 2) strength = val
            promptText = promptText.replace(/--strength\s+[\d.]+/gi, '')
        }

        promptText = promptText.trim()

        await react('⏳')
        await reply('🎨 *Diffusing illusion...* Proses membutuhkan waktu 30-90 detik di queue HF.')

        try {
            // Get control image buffer (either replied image or default pattern)
            let controlBuffer = await getImageBuffer(ctx)
            let isCustomPattern = true

            if (!controlBuffer) {
                isCustomPattern = false
                controlBuffer = await getPatternBuffer(patternName)
            }

            const controlBlob = new Blob([controlBuffer], { type: 'image/png' })
            const negPrompt = 'low quality, blurry, deformed, bad anatomy, worst quality'

            const result = await hfPredict(
                'AP123/IllusionDiffusion',
                '/inference',
                {
                    control_image: controlBlob,
                    prompt: promptText,
                    negative_prompt: negPrompt,
                    guidance_scale: 7.5,
                    controlnet_conditioning_scale: strength
                },
                { timeout: 150_000 }
            )

            const outputUrl = extractResultUrl(result)
            if (!outputUrl) throw new Error('Tidak ada output gambar ilusi yang dihasilkan')

            const buffer = await downloadHFResult(outputUrl)

            const caption = `🎨 *Illusion Generated!*\n` +
                `📝 *Prompt:* ${promptText}\n` +
                `🌀 *Pola:* ${isCustomPattern ? 'Custom (Replied Image)' : patternName}\n` +
                `💪 *Strength:* ${strength}`

            await sock.sendMessage(from, {
                image: buffer,
                caption,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')
        } catch (err) {
            logger.error('[Ilusi] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal generate ilusi: ${err.message}`)
        }
    }
}

export default ilusiCommand
