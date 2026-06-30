import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { exec } from 'child_process'
import util from 'util'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const execPromise = util.promisify(exec)

const FILTERS = {
    robot: '-af "apulsator=hz=60:amount=0.9"',
    chipmunk: '-af "asetrate=44100*1.5,aresample=44100"',
    deep: '-af "asetrate=44100*0.75,aresample=44100"',
    echo: '-af "aecho=0.8:0.88:60:0.4"',
    reverse: '-af "areverse"',
    nightcore: '-af "asetrate=44100*1.25,aresample=44100,atempo=1.25"',
    slow: '-af "atempo=0.75"',
    fast: '-af "atempo=1.5"',
}

export default {
    name: 'voicechanger',
    aliases: ['vc', 'voicefilter', 'efekvn'],
    category: 'media',
    description: 'Mengubah suara VN/audio/video dengan efek/filter unik (robot, chipmunk, deep, echo, dll)',
    usage: '.vc <filter_name> (reply ke VN/audio/video)',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, messageContent, type, from, sock } = ctx

        const filterName = args[0]?.toLowerCase().trim()
        if (!filterName || !FILTERS[filterName]) {
            return reply(
                `🎙️ *Voice Changer Bot* 🎙️\n\n` +
                `Pilihan filter yang tersedia:\n` +
                `• *robot* — Suara robot tersendat\n` +
                `• *chipmunk* — Suara tupai imut melengking\n` +
                `• *deep* — Suara berat & nge-bass\n` +
                `• *echo* — Efek gema ruangan\n` +
                `• *reverse* — Suara dibalik (mundur)\n` +
                `• *nightcore* — Musik cepat dan tinggi\n` +
                `• *slow* — Kecepatan lambat (slowmo)\n` +
                `• *fast* — Kecepatan tinggi (fastmo)\n\n` +
                `*Cara pakai:* Reply VN atau Video dengan perintah:\n` +
                `*.vc <filter_name>*\n` +
                `_Contoh: .vc robot_`
            )
        }

        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage ?? null
        const quotedStanzaId = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        let audioMsg = null
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

        if (directType === 'audioMessage') {
            audioMsg = directInner.audioMessage
            targetMsgForDownload = ctx.msg
        } else if (directType === 'videoMessage') {
            videoMsg = directInner.videoMessage
            targetMsgForDownload = ctx.msg
        }

        const quotedInner = getInnerMessage(quotedMsg)
        const quotedType = quotedInner ? Object.keys(quotedInner)[0] : ''

        if (quotedType === 'audioMessage') {
            audioMsg = quotedInner.audioMessage
            targetMsgForDownload = {
                key: {
                    remoteJid: from,
                    id: quotedStanzaId,
                    fromMe: quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid,
                    participant: quotedParticipant || undefined,
                },
                message: quotedMsg
            }
        } else if (quotedType === 'videoMessage') {
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

        if (!audioMsg && !videoMsg) {
            return reply('⚠️ Harap reply ke pesan suara/VN atau video yang ingin diberi efek!')
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

            if (!buffer || buffer.length === 0) throw new Error('Gagal mengunduh file media')

            const tmpDir = path.resolve('./storage/media/tmp')
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

            const id = crypto.randomBytes(4).toString('hex')
            const inExt = videoMsg ? 'mp4' : 'ogg'
            const tempInPath = path.join(tmpDir, `${id}_vc_in.${inExt}`)
            const tempOutPath = path.join(tmpDir, `${id}_vc_out.ogg`)

            fs.writeFileSync(tempInPath, buffer)

            const filterArg = FILTERS[filterName]

            // Transcode to WhatsApp native OGG/Opus voice note
            await execPromise(`ffmpeg -y -i "${tempInPath}" -vn ${filterArg} -c:a libopus -b:a 64k "${tempOutPath}"`)

            const outputBuffer = fs.readFileSync(tempOutPath)
            
            // Clean up
            if (fs.existsSync(tempInPath)) fs.unlinkSync(tempInPath)
            if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath)

            await sock.sendMessage(from, {
                audio: outputBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            }, { quoted: ctx.msg })

            await react('✅')
        } catch (err) {
            logger.error('[VoiceChanger Command Error]:', err.message)
            await react('❌')
            await reply(`❌ Gagal mengubah suara: ${err.message}`)
        }
    }
}
