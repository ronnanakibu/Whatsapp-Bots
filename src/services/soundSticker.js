// src/services/soundSticker.js
import { createCipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import util from 'util'
import { exec } from 'child_process'
import {
    generateWAMessageFromContent,
    getMediaKeys,
    prepareWAMessageMedia,
    proto
} from '@whiskeysockets/baileys'
import mediaService, { getFfmpegPath } from './media.js'
import { logger } from '../utils/logger.js'

const execPromise = util.promisify(exec)

const FIELD_STICKER = 26          // Message.stickerMessage
const FIELD_STICKER_AUDIO = 26    // StickerMessage.<audio>, missing in standard Baileys proto
const FIELD_SOUND_WRAPPER = 134   // Message.<FutureProofMessage for sound sticker>
const FIELD_FUTURE_PROOF_MESSAGE = 1
const SIDECAR_CHUNK = 64 * 1024

export const SOUND_STICKER_BYTES = Symbol.for('bot-figurinha-som.wrapper')

function varint(value) {
    const bytes = []
    do {
        let byte = value % 128
        value = Math.floor(value / 128)
        if (value) byte |= 0x80
        bytes.push(byte)
    } while (value)
    return Buffer.from(bytes)
}

function lengthField(field, payload) {
    return Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload])
}

export function buildSoundStickerWrapper(sticker, audio) {
    const stickerBytes = Buffer.concat([
        proto.Message.StickerMessage.encode(sticker).finish(),
        lengthField(FIELD_STICKER_AUDIO, proto.Message.AudioMessage.encode(audio).finish()),
    ])
    const innerMessage = lengthField(FIELD_STICKER, stickerBytes)
    return lengthField(FIELD_FUTURE_PROOF_MESSAGE, innerMessage)
}

let encoderInstalled = false

export function installSoundStickerEncoder() {
    if (encoderInstalled) return
    const original = proto.Message.encode
    const patched = function encode(message, writer) {
        const wrapper = message?.[SOUND_STICKER_BYTES]
        if (!wrapper) return original.call(proto.Message, message, writer)
        const { stickerMessage: _visibleOnlyToBaileys, ...rest } = message
        const out = original.call(proto.Message, rest, writer)
        out.uint32(FIELD_SOUND_WRAPPER * 8 + 2).bytes(wrapper)
        return out
    }
    proto.Message.encode = patched
    encoderInstalled = true
}

export async function createStreamingSidecar(audio, mediaKey, fileEncSha256) {
    const { iv, cipherKey, macKey } = await getMediaKeys(Buffer.from(mediaKey), 'audio')
    if (!iv || !cipherKey || !macKey) throw new Error('Gagal menurunkan media key audio WhatsApp.')
    const cipher = createCipheriv('aes-256-cbc', cipherKey, iv)
    const encrypted = Buffer.concat([cipher.update(audio), cipher.final()])
    const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10)
    const hash = createHash('sha256').update(encrypted).update(mac).digest()
    if (hash.length !== fileEncSha256.length || !timingSafeEqual(hash, Buffer.from(fileEncSha256))) {
        throw new Error('Hash audio terenkripsi tidak cocok.')
    }
    const parts = []
    for (let start = 0; start < encrypted.length; start += SIDECAR_CHUNK) {
        const previous = start === 0 ? iv : encrypted.subarray(start - 16, start)
        const chunk = encrypted.subarray(start, start + SIDECAR_CHUNK)
        parts.push(createHmac('sha256', macKey).update(previous).update(chunk).digest().subarray(0, 10))
    }
    return Buffer.concat(parts)
}

class SoundStickerService {
    constructor() {
        installSoundStickerEncoder()
    }

    /**
     * Parse media duration from ffmpeg output
     */
    async getMediaDuration(filePath, ffmpegBin) {
        try {
            await execPromise(`${ffmpegBin} -i "${filePath}"`)
        } catch (err) {
            const stderr = err.stderr || ''
            const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
            if (match) {
                const hours = parseFloat(match[1])
                const minutes = parseFloat(match[2])
                const seconds = parseFloat(match[3])
                return hours * 3600 + minutes * 60 + seconds
            }
        }
        return 5
    }

    /**
     * Extract audio from video or audio buffer into compliant Ogg Opus mono 48kHz
     */
    async extractAudio(inputBuffer, maxSeconds = 10) {
        const tmpDir = path.resolve('./storage/media/tmp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

        const id = crypto.randomBytes(4).toString('hex')
        const inputPath = path.join(tmpDir, `${id}_snd_in`)
        const outputPath = path.join(tmpDir, `${id}_snd_out.ogg`)

        fs.writeFileSync(inputPath, inputBuffer)
        const ffmpegBin = getFfmpegPath()

        try {
            const totalSec = await this.getMediaDuration(inputPath, ffmpegBin)
            const duration = Math.max(0.5, Math.min(maxSeconds, totalSec))
            const fadeOutStart = Math.max(0, duration - 0.15).toFixed(2)

            // Encode to Ogg Opus mono 48kHz with smooth fade-in and fade-out to prevent clicks
            const cmd = `${ffmpegBin} -y -t ${duration.toFixed(2)} -i "${inputPath}" -vn -sn -dn -ac 1 -ar 48000 -af "afade=t=in:d=0.03,afade=t=out:st=${fadeOutStart}:d=0.15" -c:a libopus -b:a 64k -application audio -map_metadata -1 -f ogg "${outputPath}"`
            await execPromise(cmd)

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                const audioBuffer = fs.readFileSync(outputPath)
                return {
                    audio: audioBuffer,
                    durationMs: Math.round(duration * 1000)
                }
            }
            return null
        } catch (err) {
            logger.warn('SoundSticker: No audio stream extracted or conversion failed:', err.message)
            return null
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        }
    }

    /**
     * Process media into sound sticker components:
     * - Animated WebP sticker (512x512 with EXIF)
     * - Ogg Opus audio track
     */
    async createSoundStickerData(videoOrVisualBuffer, options = {}) {
        const {
            audioBuffer = null,
            topText = '',
            bottomText = '',
            noCrop = false,
            removeBg = false,
            lqPercent = 0,
            speedMultiplier = 1.0,
            maxDuration = 10,
            isStatic = false
        } = options

        const effectiveDuration = Math.min(10, Math.max(1, maxDuration))

        // 1. Generate visual sticker buffer
        let stickerBuffer
        if (isStatic) {
            stickerBuffer = await mediaService.toMemeSticker(videoOrVisualBuffer, topText, bottomText, noCrop, removeBg, lqPercent)
        } else {
            stickerBuffer = await mediaService.toAnimatedMemeSticker(
                videoOrVisualBuffer,
                topText,
                bottomText,
                noCrop,
                removeBg,
                lqPercent,
                speedMultiplier,
                effectiveDuration
            )
        }

        // 2. Extract or convert audio track
        const sourceForAudio = audioBuffer || videoOrVisualBuffer
        const audioResult = await this.extractAudio(sourceForAudio, effectiveDuration)

        return {
            sticker: stickerBuffer,
            audio: audioResult?.audio || null,
            durationMs: audioResult?.durationMs || (effectiveDuration * 1000),
            hasAudio: Boolean(audioResult?.audio && audioResult.audio.length > 0)
        }
    }

    /**
     * Upload and dispatch a Sound Sticker over Baileys WebSocket using WhatsApp's 134 FutureProof wrapper
     */
    async sendSoundSticker(socket, jid, { sticker, audio, durationMs = 3000, quoted = null }) {
        if (!socket.user?.id) throw new Error('WhatsApp socket belum terautentikasi.')
        if (!sticker) throw new Error('Sticker buffer tidak boleh kosong.')
        if (!audio) throw new Error('Audio buffer tidak boleh kosong untuk stiker bersuara.')

        const options = { upload: socket.waUploadToServer, mediaUploadTimeoutMs: 60_000 }

        // Upload visual sticker and audio stream in parallel
        const [visual, sound] = await Promise.all([
            prepareWAMessageMedia({
                sticker,
                isAnimated: true,
                width: 512,
                height: 512
            }, options),
            prepareWAMessageMedia({
                audio,
                mimetype: 'audio/ogg; codecs=opus',
                seconds: Math.max(1, Math.ceil(durationMs / 1000))
            }, options)
        ])

        const audioMessage = sound.audioMessage
        if (!visual.stickerMessage || !audioMessage?.mediaKey || !audioMessage.fileEncSha256) {
            throw new Error('Gagal menyiapkan media stiker atau audio untuk enkripsi WhatsApp.')
        }

        // Generate audio streaming sidecar (chunked HMAC verification)
        audioMessage.streamingSidecar = await createStreamingSidecar(audio, audioMessage.mediaKey, audioMessage.fileEncSha256)

        // Assemble outer message
        const message = generateWAMessageFromContent(jid, visual, {
            userJid: socket.user.id,
            quoted
        })

        const content = message.message
        if (!content?.stickerMessage || !message.key.id) {
            throw new Error('Gagal merakit envelope pesan WhatsApp.')
        }

        content.stickerMessage.isAnimated = true
        content[SOUND_STICKER_BYTES] = buildSoundStickerWrapper(content.stickerMessage, audioMessage)

        installSoundStickerEncoder()

        await socket.relayMessage(jid, content, { messageId: message.key.id })
        logger.info(`🔊 [SoundSticker] Sent sound sticker to ${jid} (msgId: ${message.key.id})`)
        return message.key.id
    }
}

export const soundStickerService = new SoundStickerService()
export default soundStickerService
