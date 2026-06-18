// src/commands/media/flux.js
// .flux [prompt] — Generate image directly using black-forest-labs/FLUX.1-dev

import { hfPredict, downloadHFResult } from '../../services/hf.js'
import { logger } from '../../utils/logger.js'

export const fluxCommand = {
    name: 'flux',
    aliases: ['fluxdev', 'flux1'],
    category: 'media',
    description: 'Hasilkan gambar detail tinggi menggunakan model FLUX.1-dev AI',
    usage: '.flux [prompt]',
    example: '.flux a cozy cabin in the woods at sunset',
    cooldown: 30,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, pushName } = ctx

        let promptText = args.join(' ').trim()
        if (!promptText) {
            return reply('⚠️ Masukkan prompt untuk generate gambar dengan FLUX.\nContoh: *.flux a majestic white wolf*')
        }

        if (promptText.length > 500) {
            return reply('❌ Prompt terlalu panjang! Maks 500 karakter.')
        }

        // Parse optional parameter flags if present
        let steps = 28
        const stepsMatch = promptText.match(/--steps\s+(\d+)/i)
        if (stepsMatch) {
            const s = parseInt(stepsMatch[1])
            if (!isNaN(s) && s >= 10 && s <= 40) steps = s
            promptText = promptText.replace(/--steps\s+\d+/gi, '')
        }

        let guidance = 3.5
        const guidanceMatch = promptText.match(/--guidance\s+([\d.]+)/i)
        if (guidanceMatch) {
            const g = parseFloat(guidanceMatch[1])
            if (!isNaN(g) && g >= 1 && g <= 10) guidance = g
            promptText = promptText.replace(/--guidance\s+[\d.]+/gi, '')
        }

        promptText = promptText.trim()

        await react('🎨')
        await reply(`🎨 *Generating image with FLUX.1-dev...*\n📝 Prompt: _${promptText.slice(0, 100)}_\n\n_⏳ Sedang diproses di queue HF (mungkin 20-50 detik)..._`)

        try {
            logger.info(`[Flux] Generating image for: "${promptText.slice(0, 80)}"`)

            const result = await hfPredict(
                'black-forest-labs/FLUX.1-dev',
                '/infer',
                {
                    prompt: promptText,
                    seed: 0,
                    randomize_seed: true,
                    width: 1024,
                    height: 1024,
                    guidance_scale: guidance,
                    num_inference_steps: steps
                },
                { timeout: 180_000 }
            )

            const imgUrl = result?.data?.[0]?.url ?? result?.data?.[0]?.path
            if (!imgUrl) {
                logger.error('[Flux] Response format mismatch:', JSON.stringify(result))
                throw new Error('Gagal mendapatkan URL gambar hasil generate FLUX.')
            }

            const imgBuffer = await downloadHFResult(imgUrl)

            await sock.sendMessage(from, {
                image: imgBuffer,
                caption: `🎨 *FLUX.1-dev Generation*\n📝 _${promptText}_\n\n_oleh ${pushName}_`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[Flux] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal generate dengan FLUX: ${err.message}`)
        }
    }
}

export default fluxCommand
