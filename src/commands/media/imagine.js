// src/commands/media/imagine.js
// .imagine [prompt] — Generate image via Midjourney clone (mukaist/Midjourney)
// Fallback to FLUX.1-dev jika Midjourney gagal

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { logger } from '../../utils/logger.js'

const STYLES = {
    'photo':    'Photo',
    'cinematic':'Cinematic',
    'anime':    'Anime',
    '3d':       '3D Model',
    'none':     '(No style)',
    '4k':       '2560 x 1440',
}
const DEFAULT_STYLE = '2560 x 1440'

const NEG_PROMPT = '(deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime:1.4), text, close up, cropped, out of frame, worst quality, low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated, extra fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, blurry, dehydrated, bad anatomy, bad proportions, extra limbs, cloned face, disfigured, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck'

export default {
    name: 'imagine',
    aliases: ['mj', 'midjourney', 'txt2img', 'gen'],
    category: 'media',
    description: 'Generate gambar dari teks — Midjourney style, FLUX fallback',
    usage: '.imagine [--style photo|cinematic|anime|3d|4k] [prompt]',
    example: '.imagine a beautiful sunset over Jakarta | .imagine --style anime a samurai',
    cooldown: 30,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, pushName } = ctx

        if (args.length === 0) {
            return reply(
                `🎨 *Image Generation (Midjourney + FLUX)*\n\n` +
                `*Cara pakai:*\n` +
                `- *.imagine [prompt]* — generate gambar\n` +
                `- *.imagine --style anime [prompt]* — pilih style\n\n` +
                `*Style tersedia:* photo, cinematic, anime, 3d, 4k, none\n\n` +
                `*Contoh:*\n` +
                `_.imagine a futuristic city in Indonesia_\n` +
                `_.imagine --style anime a warrior princess_`
            )
        }

        // Parse --style flag
        let styleKey = null
        let promptParts = [...args]
        const styleIdx = promptParts.indexOf('--style')
        if (styleIdx !== -1 && promptParts[styleIdx + 1]) {
            styleKey = promptParts[styleIdx + 1].toLowerCase()
            promptParts.splice(styleIdx, 2)
        }
        const style = STYLES[styleKey] ?? DEFAULT_STYLE
        const prompt = promptParts.join(' ').trim()

        if (!prompt) return reply('❌ Sebutkan promptnya!\n*Contoh:* _.imagine a beautiful mountain at sunset_')
        if (prompt.length > 500) return reply('❌ Prompt terlalu panjang! Maks 500 karakter.')

        await react('🎨')
        const startMsg = await reply(`🎨 *Generating image...*\n📝 Prompt: _${prompt.slice(0, 100)}_\n🎭 Style: ${style}\n\n_⏳ Sedang diproses (ZeroGPU), sabar ya..._`)

        try {
            logger.info(`[Imagine] Calling Midjourney: "${prompt.slice(0, 80)}"`)

            // Try Midjourney first
            let imgUrl = null
            try {
                const result = await hfPredict(
                    'mukaist/Midjourney',
                    '/run',
                    {
                        prompt,
                        negative_prompt: NEG_PROMPT,
                        use_negative_prompt: true,
                        style,
                        seed: 0,
                        width: 1024,
                        height: 1024,
                        guidance_scale: 6,
                        randomize_seed: true
                    },
                    { timeout: 180_000 }
                )

                // Result is list of {image, caption} dicts
                const data = result?.data
                const items = Array.isArray(data) ? data.flat() : [data]
                for (const item of items) {
                    const candidate = item?.image?.url ?? item?.url ?? item?.image
                    if (candidate && typeof candidate === 'string') {
                        imgUrl = candidate
                        break
                    }
                }
                logger.info(`[Imagine] Midjourney result: ${imgUrl?.slice(0, 80)}`)
            } catch (mjErr) {
                logger.warn(`[Imagine] Midjourney failed, falling back to FLUX: ${mjErr.message}`)
            }

            // Fallback: FLUX.1-dev
            if (!imgUrl) {
                logger.info('[Imagine] Using FLUX.1-dev fallback')
                const fluxResult = await hfPredict(
                    'black-forest-labs/FLUX.1-dev',
                    '/infer',
                    {
                        prompt,
                        seed: 0,
                        randomize_seed: true,
                        width: 1024,
                        height: 1024,
                        guidance_scale: 3.5,
                        num_inference_steps: 28
                    },
                    { timeout: 180_000 }
                )
                imgUrl = fluxResult?.data?.[0]?.url ?? fluxResult?.data?.[0]?.path
                logger.info(`[Imagine] FLUX result: ${imgUrl?.slice(0, 80)}`)
            }

            if (!imgUrl) throw new Error('Tidak ada URL gambar dari kedua model')

            const imgBuffer = await downloadHFResult(imgUrl)

            await sock.sendMessage(from, {
                image: imgBuffer,
                caption: `🎨 *Generated by AI*\n📝 _${prompt.slice(0, 200)}_\n🎭 Style: ${style}\n\n_oleh ${pushName}_`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[Imagine] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal generate gambar: ${err.message}\n\n_Coba lagi nanti atau sederhanakan promptnya._`)
        }
    }
}
