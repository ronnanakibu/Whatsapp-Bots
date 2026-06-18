import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { logger } from '../../utils/logger.js'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'
import { Client } from "@gradio/client"
import { aiService } from '../../services/ai.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export default {
    name: 'cosmos',
    aliases: ['cosmos3'],
    category: 'media',
    description: 'Bikin Physical AI Video dari prompt text atau gambar pakai NVIDIA Cosmos3-Nano',
    usage: '.cosmos <prompt> | atau reply gambar dengan .cosmos <prompt>',
    cooldown: 60, // 60s cooldown karena ini berat di server
    permissions: ['user'], // bisa dipakai siapa saja
    
    async execute(ctx) {
        const { msg, messageContent, args, reply, react, sock, from } = ctx

        if (args.length === 0) {
            return reply('⚠️ Tulis prompt videonya cuy!\nContoh: `.cosmos a dog playing in the park`\nAtau reply sebuah gambar dengan `.cosmos <prompt>` buat bikin gambarnya bergerak.')
        }

        const rawPrompt = args.join(' ')
        await react('⏳')
        await reply('⏳ Memulai koneksi ke model Cosmos3-Nano... (Ini mungkin memakan waktu 1-3 menit antrian).')

        try {
            // Enhance prompt via Gemini biar hasilnya lebih keren
            const prompt = await aiService.enhancePrompt(rawPrompt)
            // Check if user replied to an image
            let imagePath = null
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const unwrappedQuoted = unwrapMessage(quotedMsg)
            
            if (unwrappedQuoted) {
                const mType = Object.keys(unwrappedQuoted)[0]
                if (mType === 'imageMessage' || (mType === 'documentMessage' && unwrappedQuoted.documentMessage?.mimetype?.startsWith('image/'))) {
                    const imageMsg = unwrappedQuoted[mType]
                    // Download image
                    const stream = await downloadContentFromMessage(imageMsg, mType === 'imageMessage' ? 'image' : 'document')
                    let buffer = Buffer.from([])
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk])
                    }
                    
                    const tmpDir = path.resolve('./storage/media/tmp')
                    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
                    
                    imagePath = path.join(tmpDir, `cosmos_${crypto.randomBytes(4).toString('hex')}.jpg`)
                    fs.writeFileSync(imagePath, buffer)
                } else {
                    return reply('⚠️ Yang kamu reply bukan gambar cuy. Reply gambar buat mode Image-to-Video, atau jangan reply apa-apa buat Text-to-Video.')
                }
            }

            // Connect to Gradio Space
            const app = await Client.connect("multimodalart/Cosmos3-Nano")
            
            // Prepare inputs based on api_info
            // /generate expects:
            // 0: mode (Literal['Image', 'Video']) -> We use "Video" always for generating video? Wait, the modes are "Video" (text-to-video) and "Image" (image-to-video)
            const mode = imagePath ? "Image" : "Video"
            
            // To be safe with local files in Gradio client, we use handle_file or read file as blob.
            // If @gradio/client version supports it, we can just use the path or we read as Blob.
            // Let's pass the buffer as a Blob
            let imageInput = null
            if (imagePath) {
                const buffer = fs.readFileSync(imagePath)
                imageInput = new Blob([buffer], { type: 'image/jpeg' })
            }

            const result = await app.predict("/generate", [
                mode, // mode
                prompt, // prompt
                imageInput, // image
                "480p (832x480, fast)", // resolution
                33, // num_frames (dikurangi dari 65 biar gak kena limit GPU HF)
                20, // steps (dikurangi dari 25)
                6, // guidance
                false, // enable_sound
                "", // negative_prompt
                0, // seed
                true, // randomize_seed
            ])

            // Clean up the temp image
            if (imagePath && fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath)
            }

            // result.data should be an array [imageUrl, videoInfo, seed]
            // videoInfo is an object { path: '...', url: '...' }
            const videoData = result.data[1]
            
            if (!videoData || (!videoData.url && !videoData.path)) {
                throw new Error("Gagal mendapatkan URL video dari model.")
            }

            const videoUrl = videoData.url || videoData.path

            await react('✅')
            await sock.sendMessage(from, { 
                video: { url: videoUrl }, 
                caption: `✅ **Cosmos3-Nano**\n\nPrompt: _${prompt}_\nSeed: ${result.data[2]}`
            }, { quoted: getCleanQuoted(msg) })

        } catch (err) {
            logger.error('❌ [Cosmos] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal render video:\n${err.message}`)
        }
    }
}
