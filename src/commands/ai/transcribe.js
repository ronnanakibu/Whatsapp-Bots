// src/commands/ai/transcribe.js
// Voice Note & Audio AI Transcriber (Speech-to-Text & Smart Summarizer)

import fs from 'fs'
import path from 'path'
import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

/**
 * Extract audio buffer from context
 */
async function getAudioBuffer(ctx) {
    const { msg, messageContent, from, sock } = ctx
    const contextInfo = messageContent?.extendedTextMessage?.contextInfo
    const quotedMsg = contextInfo?.quotedMessage
    const unwrappedQuoted = unwrapMessage(quotedMsg)
    const unwrappedDirect = unwrapMessage(messageContent)

    const isAudio = (m) => {
        if (!m) return false
        const t = Object.keys(m)[0]
        return (
            t === 'audioMessage' ||
            t === 'ptvMessage' ||
            t === 'videoMessage' ||
            (t === 'documentMessage' && (m.documentMessage?.mimetype?.startsWith('audio/') || m.documentMessage?.mimetype?.includes('ogg') || m.documentMessage?.mimetype?.includes('mp4')))
        )
    }

    let targetMsg = null
    let mediaType = 'audio'
    let mime = 'audio/ogg; codecs=opus'

    if (isAudio(unwrappedQuoted)) {
        const stanzaId = contextInfo?.stanzaId
        const participant = contextInfo?.participant
        const t = Object.keys(unwrappedQuoted)[0]
        mime = unwrappedQuoted[t]?.mimetype || mime
        mediaType = t

        targetMsg = {
            key: {
                remoteJid: from,
                id: stanzaId ?? msg.key.id,
                fromMe: participant ? (participant === sock.user?.id || participant === sock.user?.lid) : false,
                participant: participant || undefined
            },
            message: unwrappedQuoted
        }
    } else if (isAudio(unwrappedDirect)) {
        const t = Object.keys(unwrappedDirect)[0]
        mime = unwrappedDirect[t]?.mimetype || mime
        mediaType = t
        targetMsg = { key: msg.key, message: unwrappedDirect }
    }

    if (!targetMsg) return null

    const buffer = await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        { logger, reuploadRequest: sock.updateMediaMessage }
    )

    return buffer && buffer.length > 0 ? { buffer, mime, mediaType } : null
}

export default {
    name: 'transcribe',
    aliases: ['vntotext', 'vn', 'stt', 'transkrip', 'suara'],
    category: 'ai',
    description: 'Transkripsikan Voice Note atau Audio menjadi teks & ringkasan AI',
    usage: '.transcribe (balas voice note / audio)',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, react } = ctx

        const audioData = await getAudioBuffer(ctx)
        if (!audioData) {
            return reply(
                '🎙️ *PANDUAN TRANSCRIBE*\n' +
                'Balas *(quote)* pesan suara (Voice Note), file audio, atau video note dengan command *.transcribe* untuk mengubah suara menjadi teks!'
            )
        }

        await react('⏳')
        const startTime = Date.now()

        // Ensure temp directory
        const tempDir = path.resolve('./storage/media/cache')
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

        const tempExt = audioData.mime.includes('mp4') ? 'mp4' : (audioData.mime.includes('mp3') ? 'mp3' : 'ogg')
        const tempFile = path.join(tempDir, `stt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${tempExt}`)

        try {
            fs.writeFileSync(tempFile, audioData.buffer)

            let transcribedText = ''
            let providerName = 'Groq Whisper'

            // 1. Try Groq Whisper (Super Fast & Accurate)
            if (groq) {
                try {
                    const transcription = await groq.audio.transcriptions.create({
                        file: fs.createReadStream(tempFile),
                        model: 'whisper-large-v3',
                        response_format: 'verbose_json',
                        temperature: 0.0
                    })
                    transcribedText = transcription.text?.trim() || ''
                } catch (groqErr) {
                    logger.warn('[Transcribe] Groq Whisper failed, trying Gemini fallback:', groqErr.message)
                }
            }

            // 2. Fallback to Gemini Multimodal Audio
            if (!transcribedText && genAI) {
                try {
                    providerName = 'Gemini Audio'
                    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
                    const base64Audio = audioData.buffer.toString('base64')
                    const result = await model.generateContent([
                        {
                            inlineData: {
                                mimeType: audioData.mime || 'audio/ogg',
                                data: base64Audio
                            }
                        },
                        {
                            text: 'Transkripsikan seluruh isi suara/audio ini secara lengkap dan akurat dalam bahasa yang diucapkan. Tuliskan teks transkripnya secara jelas.'
                        }
                    ])
                    transcribedText = result.response?.text()?.trim() || ''
                } catch (geminiErr) {
                    logger.error('[Transcribe] Gemini fallback error:', geminiErr.message)
                }
            }

            if (!transcribedText) {
                await react('❌')
                return reply('❌ Maaf, audio tidak dapat dikenali atau transkrip kosong. Pastikan suara di dalam rekaman terdengar jelas.')
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)

            // 3. Generate AI Summary if transcribed text is relatively long (> 40 words)
            let summaryText = ''
            const wordCount = transcribedText.split(/\s+/).length

            if (wordCount >= 35 && (groq || genAI)) {
                try {
                    if (groq) {
                        const chatRes = await groq.chat.completions.create({
                            model: 'llama-3.3-70b-versatile',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'Kamu adalah asisten perangkum. Buatlah ringkasan inti pesan suara dalam 2-3 poin penting yang padat dan jelas.'
                                },
                                {
                                    role: 'user',
                                    content: `Rangkum transkrip audio ini:\n"${transcribedText}"`
                                }
                            ],
                            max_tokens: 250
                        })
                        summaryText = chatRes.choices[0]?.message?.content?.trim() || ''
                    } else if (genAI) {
                        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
                        const sumRes = await model.generateContent(
                            `Rangkum transkrip suara berikut menjadi 2-3 poin penting yang singkat dan jelas:\n"${transcribedText}"`
                        )
                        summaryText = sumRes.response?.text()?.trim() || ''
                    }
                } catch (_) {}
            }

            let resultMessage = `🎙️ *[AUDIO AI TRANSCRIPTION]*\n`
            resultMessage += `⚡ *Diproses dalam:* ${elapsedSec}s (${providerName})\n`
            resultMessage += `━━━━━━━━━━━━━━━━━━━━\n\n`
            resultMessage += `📜 *Isi Suara:*\n`
            resultMessage += `"${transcribedText}"\n\n`

            if (summaryText) {
                resultMessage += `💡 *Poin Inti Ringkasan:*\n`
                resultMessage += `${summaryText}\n\n`
            }

            resultMessage += `━━━━━━━━━━━━━━━━━━━━\n`
            resultMessage += `_Powered by Ronn Bot Audio Intelligence_`

            await react('✅')
            return reply(resultMessage.trim())
        } catch (err) {
            logger.error('[Transcribe] Error executing transcribe command:', err.message)
            await react('❌')
            return reply(`❌ Terjadi kendala saat memproses audio: ${err.message}`)
        } finally {
            if (fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile) } catch (_) {}
            }
        }
    }
}
