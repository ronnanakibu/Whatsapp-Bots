// src/commands/media/enhance.js
// .enhance — Perbagus/upscale gambar (Finegrain Enhancer)
// .restore — Restore wajah rusak/blur (CodeFormer)
// .upscale — Upscale via Flux Controlnet Upscaler

import { hfPredict, downloadHFResult, extractResultUrl } from '../../services/hf.js'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

// ─── Helper: get image buffer from ctx ────────────────────────────────────────
export async function getImageBuffer(ctx) {
    const { msg, messageContent, type, from, sock } = ctx
    const contextInfo = messageContent?.extendedTextMessage?.contextInfo
    const quotedMsg = contextInfo?.quotedMessage
    const unwrappedQuoted = unwrapMessage(quotedMsg)
    const unwrappedDirect = unwrapMessage(messageContent)

    const isImg = (m) => {
        if (!m) return false
        const t = Object.keys(m)[0]
        return t === 'imageMessage' || (t === 'documentMessage' && m.documentMessage?.mimetype?.startsWith('image/'))
    }

    let targetMsg = null
    if (isImg(unwrappedDirect)) {
        targetMsg = { key: msg.key, message: unwrappedDirect }
    } else if (isImg(unwrappedQuoted)) {
        const stanzaId = contextInfo?.stanzaId
        const participant = contextInfo?.participant
        targetMsg = {
            key: {
                remoteJid: from,
                id: stanzaId ?? msg.key.id,
                fromMe: participant ? (participant === sock.user?.id || participant === sock.user?.lid) : false,
                participant: participant || undefined
            },
            message: unwrappedQuoted
        }
    }

    if (!targetMsg) return null

    const buffer = await downloadMediaMessage(
        targetMsg, 'buffer', {},
        { logger, reuploadRequest: sock.updateMediaMessage }
    )
    return buffer && buffer.length > 0 ? buffer : null
}

// ─── Commands ─────────────────────────────────────────────────────────────────
export const enhanceCommand = {
    name: 'enhance',
    aliases: ['hd', 'perbagus', 'tingkatkan'],
    category: 'media',
    description: 'Tingkatkan kualitas gambar (AI upscale + enhance) via Finegrain',
    usage: '.enhance [prompt deskripsi] (reply gambar)',
    example: '.enhance make it sharper (reply gambar)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke gambar dulu, lalu ketik *.enhance*\n_(Opsional: tambahkan prompt untuk guidance)_')
        }

        const prompt = args.join(' ').trim() || 'masterpiece, best quality, highres, ultra-detailed'
        const neg_prompt = 'blurry, low quality, noisy, grainy, pixelated'

        await react('⏳')
        await reply('🔧 *Enhancing image...* (AI upscale 2x)\n_Proses mungkin 30-60 detik..._')

        try {
            // Finegrain needs image as Gradio file dict
            // Upload via blob
            const blob = new Blob([buffer], { type: 'image/png' })

            const result = await hfPredict(
                'finegrain/finegrain-image-enhancer',
                '/process',
                {
                    input_image: blob,
                    prompt,
                    negative_prompt: neg_prompt,
                    seed: 42,
                    upscale_factor: 2
                },
                { timeout: 120_000 }
            )

            const imgUrl = result?.data?.[0]?.url ?? result?.data?.[0]?.path ?? extractResultUrl(result)
            if (!imgUrl) throw new Error('Tidak ada output dari enhancer')

            const enhanced = await downloadHFResult(imgUrl)
            await sock.sendMessage(from, {
                image: enhanced,
                caption: '✨ *Enhanced!* Gambar berhasil ditingkatkan kualitasnya (2x upscale)',
                mimetype: 'image/png'
            }, { quoted: msg })
            await react('✅')

        } catch (err) {
            logger.error('[Enhance] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal enhance: ${err.message}`)
        }
    }
}

export const restoreCommand = {
    name: 'restore',
    aliases: ['facefix', 'restorewajah', 'codeformer'],
    category: 'media',
    description: 'Restore wajah blur/rusak di foto menggunakan CodeFormer AI',
    usage: '.restore (reply foto)',
    example: '.restore (reply foto wajah blur)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke foto dulu, lalu ketik *.restore*\n_Cocok untuk foto wajah blur, kualitas rendah, atau foto lama_')
        }

        await react('⏳')
        await reply('🔧 *Restoring face...* (CodeFormer AI)\n_Proses mungkin 30-60 detik..._')

        try {
            const blob = new Blob([buffer], { type: 'image/png' })
            const result = await hfPredict(
                'sczhou/CodeFormer',
                '/inference',
                {
                    image: blob,
                    face_align: true,
                    background_enhance: true,
                    face_upsample: true,
                    upscale: 2
                },
                { timeout: 120_000 }
            )

            const imgUrl = result?.data?.[0]?.url ?? result?.data?.[0]?.path ?? extractResultUrl(result)
            if (!imgUrl) throw new Error('Tidak ada output dari CodeFormer')

            const restored = await downloadHFResult(imgUrl)
            await sock.sendMessage(from, {
                image: restored,
                caption: '✨ *Face Restored!* Wajah berhasil diperbaiki oleh CodeFormer AI',
                mimetype: 'image/png'
            }, { quoted: msg })
            await react('✅')

        } catch (err) {
            logger.error('[Restore] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal restore: ${err.message}`)
        }
    }
}

// Default export untuk command loader (ini yang di-load pertama)
export default {
    ...enhanceCommand,
    name: 'enhance',
}
