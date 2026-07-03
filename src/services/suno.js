// src/services/suno.js
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import crypto from 'crypto'
import { aiService } from './ai.js'
import { uploadVideo } from './youtube.js'
import { eventBus } from '../events/bus.js'
import { logger, getSocket } from '../utils/logger.js'
import 'dotenv/config'

// Active jobs database in-memory
const activeJobs = new Map()

/**
 * Returns all active or recently completed/failed jobs.
 */
export function getActiveJobs() {
    return Array.from(activeJobs.values())
}

/**
 * Helper to download a file from a URL.
 */
async function downloadFile(url, destPath) {
    const writer = fs.createWriteStream(destPath)
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    })
    response.data.pipe(writer)
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
}

/**
 * Starts the Suno Music Video generation pipeline in the background.
 */
export async function startSunoPipeline({ prompt, title, enhance = false, source = 'web', chatId = null }) {
    const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    
    const job = {
        id: jobId,
        prompt,
        title: title || 'Untitled Instrumental',
        status: 'running',
        stage: 'idle',
        progress: 0,
        logs: [],
        youtubeUrl: null,
        source,
        chatId,
        timestamp: Date.now()
    }

    activeJobs.set(jobId, job)

    function updateJob(stage, progress, logMsg) {
        job.stage = stage
        job.progress = progress
        if (logMsg) {
            const timestamp = new Date().toLocaleTimeString()
            const fullLog = `[${timestamp}] ${logMsg}`
            job.logs.push(fullLog)
            logger.info(`[Suno/Pipeline/${jobId}] ${logMsg}`)
        }
        eventBus.emitEvent('suno:status', job)
    }

    // Run pipeline asynchronously
    (async () => {
        const tempDir = path.resolve(`./storage/media/tmp/bikinlagu/${jobId}`)
        fs.mkdirSync(tempDir, { recursive: true })

        const audioPath = path.join(tempDir, 'lagu_suno.mp3')
        const thumbnailPath = path.join(tempDir, 'thumbnail_gemini.png')
        const outputPath = path.join(tempDir, 'output_youtube.mp4')

        let finalPrompt = prompt
        let videoTitle = job.title
        let youtubeDesc = 'Generated automatically via Suno & Gemini Automation'
        let youtubeTags = ['instrumental', 'music', 'ai-generated']
        let imgGenPrompt = prompt

        try {
            // 1. AI ENHANCE PROMPT
            if (enhance) {
                updateJob('ai_enhance', 10, 'Menyempurnakan prompt dengan AI (Gemini)...')
                finalPrompt = await aiService.enhancePrompt(prompt)
                updateJob('ai_enhance', 15, `Prompt berhasil disempurnakan: "${finalPrompt}"`)
            }

            // 2. PARALLEL PROCESSES (Suno Generation + Gemini Metadata)
            updateJob('suno_gen', 20, 'Memulai proses paralel: Generating Suno Audio & Gemini Metadata...')
            
            let audioUrl = null

            const sunoPromise = (async () => {
                const apiBaseUrl = process.env.SUNO_API_URL || 'http://localhost:3000'
                const generateUrl = `${apiBaseUrl}/api/generate`

                updateJob('suno_gen', 25, `Mengirim request ke Suno API wrapper (${generateUrl})...`)

                let genResponse
                try {
                    genResponse = await axios.post(generateUrl, {
                        prompt: finalPrompt,
                        make_instrumental: true,
                        wait_audio: false
                    }, { timeout: 10000 })
                } catch (err) {
                    throw new Error(`Suno API Connection Refused (${err.message}). Pastikan service Suno API wrapper aktif di ${apiBaseUrl}`)
                }

                const clips = genResponse.data
                if (!Array.isArray(clips) || clips.length === 0) {
                    throw new Error('Suno API tidak mengembalikan klip audio yang valid.')
                }

                const clipId = clips[0].id
                updateJob('suno_gen', 30, `Lagu berhasil masuk antrean Suno. Clip ID: ${clipId}. Polling status...`)

                // Poll status until complete
                let complete = false
                let pollAttempts = 0
                const maxAttempts = 60 // 5 minutes max

                while (!complete && pollAttempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 8000))
                    pollAttempts++

                    let pollResponse
                    try {
                        pollResponse = await axios.get(`${apiBaseUrl}/api/get?ids=${clipId}`, { timeout: 10000 })
                    } catch (err) {
                        throw new Error(`Gagal menghubungi Suno API saat polling (${err.message})`)
                    }
                    const pollClips = pollResponse.data
                    if (Array.isArray(pollClips) && pollClips.length > 0) {
                        const status = pollClips[0].status
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 20), `Polling status Suno (Percobaan ${pollAttempts}): ${status}`)

                        if (status === 'complete') {
                            audioUrl = pollClips[0].audio_url
                            complete = true
                        } else if (status === 'failed') {
                            throw new Error('Generasi lagu di Suno gagal.')
                        }
                    }
                }

                if (!audioUrl) {
                    throw new Error('Timeout menunggu generasi audio Suno selesai.')
                }

                updateJob('suno_gen', 50, `Audio Suno selesai dibuat! URL: ${audioUrl}`)
            })()

            const geminiPromise = (async () => {
                updateJob('gemini_meta', 22, 'Mengirim prompt ke Gemini untuk metadata YouTube...')
                try {
                    const metadata = await aiService.generateYoutubeMetadata(finalPrompt)
                    if (metadata && metadata.title) {
                        videoTitle = title || metadata.title
                        youtubeDesc = metadata.description || youtubeDesc
                        youtubeTags = metadata.tags || youtubeTags
                        imgGenPrompt = metadata.imagePrompt || finalPrompt
                        updateJob('gemini_meta', 35, `Metadata YouTube berhasil dibuat. Judul: "${videoTitle}"`)
                    } else {
                        updateJob('gemini_meta', 35, 'Gagal menguraikan metadata, menggunakan fallback.')
                    }
                } catch (err) {
                    updateJob('gemini_meta', 35, `Warning: Gagal membuat metadata YouTube (${err.message}). Menggunakan fallback.`)
                }
            })()

            // Wait for both Suno audio generation and Gemini metadata generation
            await Promise.all([sunoPromise, geminiPromise])

            // 3. GENERATE THUMBNAIL IMAGE
            updateJob('img_gen', 55, 'Membuat gambar thumbnail premium via FLUX/Pollinations...')
            const imgResult = await aiService.generateImage(imgGenPrompt)
            fs.writeFileSync(thumbnailPath, imgResult.buffer)
            updateJob('img_gen', 60, 'Thumbnail gambar berhasil disimpan.')

            // 4. DOWNLOAD AUDIO
            updateJob('downloading', 65, 'Mendownload file audio dari server Suno...')
            await downloadFile(audioUrl, audioPath)
            updateJob('downloading', 70, 'File audio berhasil didownload.')

            // 5. FFMEPG VIDEO RENDER
            updateJob('ffmpeg', 75, 'Memulai proses encoding video FFmpeg (Loop partikel + Thumbnail)...')
            
            const overlayPath = path.resolve('./storage/assets/partikel_api.mp4')
            let ffmpegCmd = ''

            if (fs.existsSync(overlayPath)) {
                updateJob('ffmpeg', 77, 'Menemukan partikel_api.mp4, menggunakan blend filter...')
                ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -stream_loop -1 -i "${overlayPath}" -i "${audioPath}" -filter_complex "[1:v]scale=1280:720,setsar=1[v1];[0:v]scale=1280:720,setsar=1[v0];[v1][v0]blend=all_mode=screen:all_opacity=0.7[outv]" -map "[outv]" -map 2:a -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
            } else {
                updateJob('ffmpeg', 77, 'partikel_api.mp4 tidak ditemukan. Rendering video statis...')
                ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -i "${audioPath}" -c:v libx264 -preset veryfast -tune stillimage -c:a aac -shortest "${outputPath}"`
            }

            await new Promise((resolve, reject) => {
                const child = exec(ffmpegCmd)
                
                child.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n')
                    for (const line of lines) {
                        if (line.includes('time=')) {
                            // Extract time to update rendering progress logs silently
                            const match = line.match(/time=(\d{2}:\d{2}:\d{2})/)
                            if (match) {
                                updateJob('ffmpeg', 80, `Rendering video FFmpeg... Progress waktu: ${match[1]}`)
                            }
                        }
                    }
                })

                child.on('close', (code) => {
                    if (code === 0) {
                        resolve()
                    } else {
                        reject(new Error(`FFmpeg exit dengan code ${code}`))
                    }
                })
            })

            updateJob('ffmpeg', 85, 'Rendering video FFmpeg selesai!')

            // 6. UPLOAD TO YOUTUBE
            updateJob('youtube_upload', 90, 'Mengunggah video yang dirender ke YouTube...')
            const youtubePrivacy = process.env.YOUTUBE_PRIVACY || 'private'
            
            const youtubeUrl = await uploadVideo({
                videoPath: outputPath,
                title: videoTitle,
                description: `${youtubeDesc}\n\n---\nVideo ini dibuat secara otomatis menggunakan Suno API & Gemini.`,
                tags: youtubeTags,
                privacyStatus: youtubePrivacy,
                onProgress: (p) => {
                    updateJob('youtube_upload', 90 + Math.floor(p * 0.09), `Mengunggah ke YouTube: ${p}%`)
                }
            })

            // 7. SUCCESS & FINAL NOTIFICATION
            job.status = 'completed'
            job.youtubeUrl = youtubeUrl
            updateJob('done', 100, `Sukses! Video berhasil dipublikasikan di YouTube: ${youtubeUrl}`)

            // Send WhatsApp confirmation back to client
            if (chatId) {
                const sock = getSocket()
                if (sock) {
                    await sock.sendMessage(chatId, {
                        text: `🎵 *Lagu AI Kamu Selesai Dibuat!* 🎵\n\n*Judul:* ${videoTitle}\n*Link YouTube:* ${youtubeUrl}\n\n_Video berhasil digenerate dan diupload otomatis!_`
                    })
                }
            }

        } catch (error) {
            job.status = 'failed'
            updateJob('failed', 100, `Kesalahan Pipeline: ${error.message}`)

            if (chatId) {
                const sock = getSocket()
                if (sock) {
                    await sock.sendMessage(chatId, {
                        text: `❌ *Gagal Membuat Lagu AI* ❌\n\n*Pesan Error:* ${error.message}\n\nSilakan coba lagi beberapa saat.`
                    })
                }
            }
        } finally {
            // Cleanup temp files after small timeout to let streams close
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true })
                        logger.info(`[Suno/Pipeline/${jobId}] Temporary files cleaned up.`)
                    }
                } catch (e) {
                    logger.warn(`[Suno/Pipeline/${jobId}] Failed to cleanup temp directory: ${e.message}`)
                }
            }, 5000)
        }
    })()

    return jobId
}
