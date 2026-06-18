// src/commands/media/edit.js
// .edit — Edit image using selfit-camera/Omni-Image-Editor's text-guided editing

import { hfPredict, downloadHFResult } from '../../services/hf.js'
import { getImageBuffer } from './enhance.js'
import { extractImageUrlFromHtml } from './upscale.js'
import { logger } from '../../utils/logger.js'

export const editCommand = {
    name: 'edit',
    aliases: ['editimage', 'manipulate', 'ubahgambar'],
    category: 'media',
    description: 'Edit bagian gambar menggunakan instruksi teks (Omni AI Editor)',
    usage: '.edit [instruksi edit] (reply gambar)',
    example: '.edit ganti latar belakang menjadi pantai sunset (reply gambar)',
    cooldown: 20,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        const promptText = args.join(' ').trim()
        if (!promptText) {
            return reply('⚠️ Masukkan instruksi edit gambarnya.\nContoh: *.edit ganti baju jadi jas hitam* (reply gambar)')
        }

        const buffer = await getImageBuffer(ctx)
        if (!buffer) {
            return reply('⚠️ Reply ke gambar yang ingin diedit dulu, lalu ketik *.edit [instruksi]*')
        }

        await react('⏳')
        await reply(`🔧 *Editing image...*\nPrompt: "${promptText}"\n_Proses memakan waktu 20-45 detik..._`)

        try {
            const blob = new Blob([buffer], { type: 'image/png' })

            // Predict using selfit-camera/Omni-Image-Editor
            const result = await hfPredict(
                'selfit-camera/Omni-Image-Editor',
                '/edit_image_interface',
                {
                    input_image: blob,
                    prompt: promptText
                },
                { timeout: 120_000 }
            )

            const html = result?.data?.[0]
            const imgUrl = extractImageUrlFromHtml(html)

            if (!imgUrl) {
                logger.error('[Edit] Invalid response structure:', JSON.stringify(result?.data))
                throw new Error('Gagal mengekstrak URL hasil edit dari respon server.')
            }

            const editedBuffer = await downloadHFResult(imgUrl)

            await sock.sendMessage(from, {
                image: editedBuffer,
                caption: `✨ *Edit Berhasil!*\n📝 *Instruksi:* ${promptText}`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('[Edit] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal edit gambar: ${err.message}`)
        }
    }
}

export default editCommand
