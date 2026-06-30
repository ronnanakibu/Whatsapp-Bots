import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { exec } from 'child_process'
import util from 'util'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const execPromise = util.promisify(exec)

export default {
    name: 'toaudio',
    aliases: ['tomp3', 'extractaudio'],
    category: 'media',
    description: 'Mengekstrak suara/audio dari sebuah video langsung menjadi file MP3',
    usage: '.toaudio (reply ke video)',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, react, messageContent, type, from, sock } = ctx

        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage ?? null
        const quotedStanzaId = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        let videoMsg = null
        let targetMsgForDownload = null

        const getInnerMessage = (m) => {
            if (!m) return null
            const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            const qType = Object.keys(m)[0]
            return WRAPPERS.includes(qType) ? (m[qType]?.message ?? m) : m
        }

        const directInner = getInnerMessage(messageContent)
        const directType = directInner ? Object.keys(directInner)[0] : ''

        if (directType === 'videoMessage') {
            videoMsg = directInner.videoMessage
            targetMsgForDownload = ctx.msg
        }

        const quotedInner = getInnerMessage(quotedMsg)
        const quotedType = quotedInner ? Object.keys(quotedInner)[0] : ''

        if (quotedType === 'videoMessage') {
            videoMsg = quotedInner.videoMessage
            targetMsgForDownload = {
                key: {
                    remoteJid: from,
                    id: quotedStanzaId,
                    fromMe: quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid,
                    participant: quotedParticipant || undefined,
                },
                message: quotedMsg
            }
        }

        if (!videoMsg) {
            return reply('⚠️ Harap reply ke video yang ingin Anda ekstrak audionya!')
        }

        await react('⏳')
        try {
            const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
            const buffer = await downloadMediaMessage(
                targetMsgForDownload,
                'buffer',
                {},
                { logger: logger, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage }
            )

            if (!buffer || buffer.length === 0) throw new Error('Gagal mengunduh file video')

            const tmpDir = path.resolve('./storage/media/tmp')
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

            const id = crypto.randomBytes(4).toString('hex')
            const tempVideoPath = path.join(tmpDir, `${id}_ext_in.mp4`)
            const tempAudioPath = path.join(tmpDir, `${id}_ext_out.mp3`)

            fs.writeFileSync(tempVideoPath, buffer)

            // Extract high-quality MP3 (320kbps vs 128kbps, using standard libmp3lame q:a 2)
            await execPromise(`ffmpeg -y -i "${tempVideoPath}" -vn -acodec libmp3lame -q:a 2 "${tempAudioPath}"`)

            const audioBuffer = fs.readFileSync(tempAudioPath)

            // Clean up
            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath)
            if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath)

            const cleanFileName = `audio_${id}.mp3`

            await sock.sendMessage(from, {
                document: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: cleanFileName,
                caption: '🎵 *Ekstraksi Audio MP3 Selesai!*'
            }, { quoted: ctx.msg })

            await react('✅')
        } catch (err) {
            logger.error('[ToAudio Command Error]:', err.message)
            await react('❌')
            await reply(`❌ Gagal mengekstrak audio: ${err.message}`)
        }
    }
}
