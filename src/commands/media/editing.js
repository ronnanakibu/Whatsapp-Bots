import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { exec } from 'child_process'
import util from 'util'
import axios from 'axios'
import Database from 'better-sqlite3'
import { store } from '../../services/store.js'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const execPromise = util.promisify(exec)

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const MEME_SOUNDS = {
    'vineboom':   'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh':       'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'crickets':   'https://www.myinstants.com/media/sounds/crickets.mp3',
    'fart':       'https://www.myinstants.com/media/sounds/fart-with-reverb.mp3',
    'sadviolin':  'https://www.myinstants.com/media/sounds/sad-violin.mp3',
    'laugh':      'https://www.myinstants.com/media/sounds/laugh-track.mp3',
    'wow':        'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'spongebob':  'https://www.myinstants.com/media/sounds/spongebob-fail.mp3',
    'nani':       'https://www.myinstants.com/media/sounds/nani_1.mp3',
    'run':        'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
    'bonk':       'https://www.myinstants.com/media/sounds/bonk_XjB1kwG.mp3',
    'emotional':  'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
    'illuminati': 'https://www.myinstants.com/media/sounds/illuminati-confirmed.mp3',
    'windows':    'https://www.myinstants.com/media/sounds/windows-xp-startup.mp3',
    'boom':       'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3',
}

export default {
    name: 'editing',
    aliases: ['edit', 'combine', 'mix'],
    category: 'media',
    description: 'Menyatukan video atau foto dengan audio menjadi 1 video lengkap HD',
    usage: '.editing <keyword sound atau reply VN>',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, messageContent, type, from, sock } = ctx

        // Parse target visual (image/video) and audio inputs
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage ?? null
        const quotedStanzaId = contextInfo?.stanzaId
        const quotedParticipant = contextInfo?.participant

        let visualMsg = null
        let isVideo = false
        let isImage = false
        let visualKey = null

        let audioMsg = null
        let audioKey = null

        // Helper to check wrappers (viewOnce, ephemeral)
        const getInnerMessage = (m) => {
            if (!m) return null
            const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            const qType = Object.keys(m)[0]
            return WRAPPERS.includes(qType) ? (m[qType]?.message ?? m) : m
        }

        // Direct inputs
        const directInner = getInnerMessage(messageContent)
        const directType = directInner ? Object.keys(directInner)[0] : ''

        if (directType === 'videoMessage') {
            visualMsg = directInner.videoMessage
            isVideo = true
            visualKey = ctx.msg
        } else if (directType === 'imageMessage') {
            visualMsg = directInner.imageMessage
            isImage = true
            visualKey = ctx.msg
        } else if (directType === 'audioMessage') {
            audioMsg = directInner.audioMessage
            audioKey = ctx.msg
        }

        // Quoted inputs
        const quotedInner = getInnerMessage(quotedMsg)
        const quotedType = quotedInner ? Object.keys(quotedInner)[0] : ''

        if (quotedType === 'videoMessage') {
            visualMsg = quotedInner.videoMessage
            isVideo = true
            visualKey = {
                key: {
                    remoteJid: from,
                    id: quotedStanzaId,
                    fromMe: quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid,
                    participant: quotedParticipant || undefined,
                },
                message: quotedMsg
            }
        } else if (quotedType === 'imageMessage') {
            visualMsg = quotedInner.imageMessage
            isImage = true
            visualKey = {
                key: {
                    remoteJid: from,
                    id: quotedStanzaId,
                    fromMe: quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid,
                    participant: quotedParticipant || undefined,
                },
                message: quotedMsg
            }
        } else if (quotedType === 'audioMessage') {
            audioMsg = quotedInner.audioMessage
            audioKey = {
                key: {
                    remoteJid: from,
                    id: quotedStanzaId,
                    fromMe: quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid,
                    participant: quotedParticipant || undefined,
                },
                message: quotedMsg
            }
        }

        // Determine if we need to search history
        let audioBuffer = null
        const soundKeyword = args.join(' ').trim().toLowerCase()

        // 1. Resolve Audio
        if (soundKeyword) {
            // Find in MEME_SOUNDS
            if (MEME_SOUNDS[soundKeyword]) {
                const res = await axios.get(MEME_SOUNDS[soundKeyword], { responseType: 'arraybuffer' })
                audioBuffer = Buffer.from(res.data)
            } else {
                // Find in SQLite Database
                try {
                    const db = new Database(DB_PATH)
                    const vnRow = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(soundKeyword)
                    if (vnRow && fs.existsSync(vnRow.file_path)) {
                        audioBuffer = fs.readFileSync(vnRow.file_path)
                    } else {
                        const cached = db.prepare('SELECT sound_url FROM sound_cache WHERE keyword = ?').get(soundKeyword)
                        if (cached) {
                            const res = await axios.get(cached.sound_url, { responseType: 'arraybuffer' })
                            audioBuffer = Buffer.from(res.data)
                        }
                    }
                } catch (e) {
                    logger.warn('[Editing] Database sound search failed:', e.message)
                }
            }

            if (!audioBuffer) {
                return reply(`❌ Sound dengan kata kunci *"${soundKeyword}"* tidak ditemukan di database atau server.`)
            }
        } else if (audioKey) {
            // Download audio from target directly
            audioBuffer = await ctx.downloadMedia(audioKey)
        } else {
            // Scan history for audio
            const chatMessages = store.messages[from] || []
            for (let i = chatMessages.length - 1; i >= 0; i--) {
                const m = chatMessages[i]
                const unwrapped = unwrapMessage(m.message)
                if (!unwrapped) continue
                const mType = Object.keys(unwrapped)[0]
                if (mType === 'audioMessage') {
                    audioKey = m
                    break
                }
            }
            if (audioKey) {
                audioBuffer = await ctx.downloadMedia(audioKey)
            }
        }

        // 2. Resolve Visual (Image / Video)
        let visualBuffer = null
        if (!visualKey) {
            // Scan history for visual
            const chatMessages = store.messages[from] || []
            for (let i = chatMessages.length - 1; i >= 0; i--) {
                const m = chatMessages[i]
                const unwrapped = unwrapMessage(m.message)
                if (!unwrapped) continue
                const mType = Object.keys(unwrapped)[0]
                if (mType === 'videoMessage') {
                    visualKey = m
                    isVideo = true
                    break
                } else if (mType === 'imageMessage') {
                    visualKey = m
                    isImage = true
                    break
                }
            }
        }

        if (visualKey) {
            visualBuffer = await ctx.downloadMedia(visualKey)
        }

        // Validations
        if (!visualBuffer) {
            return reply('⚠️ Media tidak ditemukan!\n\nKirim video/foto dengan caption *.editing <keyword>* atau reply media tersebut.\nAtau reply ke audio/VN dan kirim video/foto terlebih dahulu di chat ini.')
        }

        if (!audioBuffer) {
            return reply('⚠️ Audio tidak ditemukan!\n\nTentukan keyword sound (contoh: *.editing vineboom*) atau reply ke VN/audio yang ingin digabungkan.')
        }

        await react('⏳')
        logger.info(`⏳ Menyatukan media (Type: ${isVideo ? 'Video' : 'Image'}) dengan audio...`)

        const id = crypto.randomBytes(4).toString('hex')
        const tmpDir = path.resolve('./storage/media/tmp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

        const visualExt = isVideo ? 'mp4' : 'png'
        const visualPath = path.join(tmpDir, `${id}_vis.${visualExt}`)
        const audioPath = path.join(tmpDir, `${id}_aud.mp3`)
        const outputPath = path.join(tmpDir, `${id}_out.mp4`)

        fs.writeFileSync(visualPath, visualBuffer)
        fs.writeFileSync(audioPath, audioBuffer)

        try {
            if (isVideo) {
                // Video + Audio: Replace audio stream
                await execPromise(`ffmpeg -y -i "${visualPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -shortest "${outputPath}"`)
            } else {
                // Image + Audio: Loop image over audio (HD output)
                // -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 ensures resolution matches image and is divisible by 2
                await execPromise(`ffmpeg -y -loop 1 -framerate 1 -i "${visualPath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -shortest "${outputPath}"`)
            }

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('FFmpeg failed to create output file')
            }

            const videoBuffer = fs.readFileSync(outputPath)
            await ctx.replyMedia(videoBuffer, 'video', { caption: '🎥 *HD Editing Selesai!*' })
            await react('✅')
        } catch (err) {
            logger.error('[Editing Command Error]:', err.message)
            await react('❌')
            await reply(`❌ Gagal mengedit video: ${err.message}`)
        } finally {
            if (fs.existsSync(visualPath)) fs.unlinkSync(visualPath)
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        }
    }
}
