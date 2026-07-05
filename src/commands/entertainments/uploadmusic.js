import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { startSunoPipeline } from '../../services/suno.js'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
    name: 'uploadmusic',
    aliases: ['musicupload', 'manualmusic'],
    category: 'entertainments',
    description: 'Upload lagu manual & generate thumbnail otomatis, lalu upload ke YouTube.',
    usage: '!uploadmusic [prompt] (sambil mereply audio/MP3)',
    permissions: ['owner'], // Hanya owner
    
    async execute(ctx) {
        const { msg, args, reply, react, chatId, sock } = ctx
        const prompt = args.join(' ')

        if (!prompt) {
            return reply('⚠️ Sertakan prompt/vibe untuk metadata/thumbnail!\nContoh: `!uploadmusic epic battle song with heavy bass` (sambil reply lagu)')
        }

        // Cari quoted message
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
        if (!quoted) {
            return reply('⚠️ Silakan reply pesan audio/document MP3 sambil mengirimkan command ini.')
        }

        const isAudio = Boolean(quoted.audioMessage)
        const isDocument = Boolean(quoted.documentMessage)

        if (!isAudio && !isDocument) {
            return reply('⚠️ Pesan yang direply bukan audio atau dokumen musik.')
        }

        // Kalau dokumen, pastikan itu MP3/WAV
        if (isDocument) {
            const mime = quoted.documentMessage.mimetype || ''
            if (!mime.includes('audio/')) {
                return reply('⚠️ File yang direply bukan file audio.')
            }
        }

        const targetMessage = {
            key: msg.message.extendedTextMessage.contextInfo.stanzaId,
            message: quoted
        }

        try {
            await react('⏳')
            await reply('📥 *Mengunduh audio...*')
            
            const buffer = await downloadMediaMessage(targetMessage, 'buffer', {}, { 
                logger: null,
                reuploadRequest: sock.updateMediaMessage
            })

            if (!buffer) {
                await react('❌')
                return reply('❌ Gagal mendownload audio.')
            }

            // Simpan ke tmp
            const tmpDir = path.join(__dirname, '../../../storage/media/tmp')
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true })
            }
            
            const ext = isAudio ? '.mp3' : (quoted.documentMessage.mimetype?.includes('wav') ? '.wav' : '.mp3')
            const fileName = `manual_upload_${Date.now()}_${crypto.randomBytes(2).toString('hex')}${ext}`
            const filePath = path.join(tmpDir, fileName)
            
            fs.writeFileSync(filePath, buffer)
            
            await react('✅')
            await reply(`✅ *Audio berhasil disimpan!* (${Math.round(buffer.length/1024)} KB)\n⏳ Memulai pipeline pembuatan video & upload ke YouTube... (Cek progress di Dashboard!)`)

            // Jalankan pipeline
            startSunoPipeline({
                prompt: prompt.trim(),
                title: 'Manual Track',
                enhance: false, // Skip AI Enhance karena sudah ada file
                source: 'wa',
                chatId: chatId || msg.key.remoteJid,
                model: 'manual',
                manualAudioPath: filePath
            }).catch(err => {
                console.error('[UploadMusic Pipeline]', err)
                sock.sendMessage(chatId || msg.key.remoteJid, { text: `❌ Pipeline gagal: ${err.message}` })
            })

        } catch (error) {
            console.error('[UploadMusic] Error:', error)
            await react('❌')
            await reply(`❌ Terjadi kesalahan: ${error.message}`)
        }
    }
}
