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
    ;(async () => {
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
            updateJob('idle', 2, `━━━ [PIPELINE START] Job ID: ${jobId} ━━━`)
            updateJob('idle', 3, `📝 Prompt awal: "${prompt}"`)
            updateJob('idle', 4, `🔧 Enhance mode: ${enhance ? 'ON' : 'OFF'} | Source: ${source}`)

            // ─────────────────────────────────────────────
            // 1. AI ENHANCE PROMPT
            // ─────────────────────────────────────────────
            if (enhance) {
                updateJob('ai_enhance', 8, '🤖 [AI Enhance] Memulai penyempurnaan prompt dengan Gemini...')
                try {
                    finalPrompt = await aiService.enhancePrompt(prompt)
                    updateJob('ai_enhance', 15, `✅ [AI Enhance] Prompt berhasil disempurnakan (${finalPrompt.length} chars)`)
                    updateJob('ai_enhance', 16, `📄 Enhanced Prompt: "${finalPrompt.slice(0, 200)}${finalPrompt.length > 200 ? '...' : ''}"`)
                } catch (enhErr) {
                    updateJob('ai_enhance', 15, `⚠️ [AI Enhance] Gagal (${enhErr.message}), menggunakan prompt asli.`)
                    finalPrompt = prompt
                }
            }

            // ─────────────────────────────────────────────
            // 2. PARALLEL: SUNO GENERATION + GEMINI METADATA
            // ─────────────────────────────────────────────
            updateJob('suno_gen', 18, '━━━ [PARALLEL START] Meluncurkan Suno + Gemini secara bersamaan ━━━')

            let audioUrl = null

            const sunoPromise = (async () => {
                const apiBaseUrl = process.env.SUNO_API_URL || 'http://localhost:3000'
                const generateUrl = `${apiBaseUrl}/api/generate`
                const hasCookie = !!process.env.SUNO_COOKIE

                updateJob('suno_gen', 20, `🎵 [Suno] Target URL: ${generateUrl}`)
                updateJob('suno_gen', 21, `🔑 [Suno] Cookie tersedia: ${hasCookie ? `YA (${process.env.SUNO_COOKIE?.length} chars)` : 'TIDAK — akan gagal auth!'}`)
                updateJob('suno_gen', 22, `📤 [Suno] Mengirim request generate ke Vercel API...`)

                const sunoHeaders = hasCookie
                    ? { Cookie: process.env.SUNO_COOKIE }
                    : {}

                let genResponse
                try {
                    const requestPayload = { prompt: finalPrompt, make_instrumental: true, wait_audio: false }
                    updateJob('suno_gen', 23, `📦 [Suno] Payload: ${JSON.stringify(requestPayload).slice(0, 150)}`)
                    genResponse = await axios.post(generateUrl, requestPayload, {
                        timeout: 30000,
                        headers: { 'Content-Type': 'application/json', ...sunoHeaders }
                    })
                    updateJob('suno_gen', 26, `✅ [Suno] HTTP ${genResponse.status} — Request diterima!`)
                } catch (err) {
                    const httpStatus = err.response?.status || 'N/A'
                    const httpBody = JSON.stringify(err.response?.data || err.message)
                    updateJob('suno_gen', 25, `❌ [Suno] HTTP ${httpStatus} ERROR: ${httpBody}`)
                    throw new Error(`Suno API Error [HTTP ${httpStatus}]: ${httpBody}`)
                }

                const clips = genResponse.data
                if (!Array.isArray(clips) || clips.length === 0) {
                    updateJob('suno_gen', 26, `❌ [Suno] Response tidak valid: ${JSON.stringify(clips).slice(0, 200)}`)
                    throw new Error('Suno API tidak mengembalikan klip audio yang valid.')
                }

                const clipId = clips[0].id
                updateJob('suno_gen', 28, `🆔 [Suno] Clip ID diterima: ${clipId}`)
                updateJob('suno_gen', 30, `⏳ [Suno] Memulai polling status setiap 8 detik...`)

                let complete = false
                let pollAttempts = 0
                const maxAttempts = 60

                while (!complete && pollAttempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 8000))
                    pollAttempts++

                    let pollResponse
                    try {
                        const sunoHeadersPoll = process.env.SUNO_COOKIE
                            ? { Cookie: process.env.SUNO_COOKIE }
                            : {}
                        pollResponse = await axios.get(`${apiBaseUrl}/api/get?ids=${clipId}`, {
                            timeout: 15000,
                            headers: sunoHeadersPoll
                        })
                    } catch (err) {
                        const httpStatus = err.response?.status || 'N/A'
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `⚠️ [Suno Poll #${pollAttempts}] HTTP ${httpStatus}: ${err.message}`)
                        continue
                    }

                    const pollClips = pollResponse.data
                    if (Array.isArray(pollClips) && pollClips.length > 0) {
                        const status = pollClips[0].status
                        const pct = pollClips[0].metadata?.gpt_description_prompt ? 'prompt_ready' : ''
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `🔄 [Suno Poll #${pollAttempts}] Status: ${status} ${pct}`)

                        if (status === 'complete') {
                            audioUrl = pollClips[0].audio_url
                            updateJob('suno_gen', 50, `🎉 [Suno] Audio selesai! URL: ${audioUrl}`)
                            complete = true
                        } else if (status === 'failed') {
                            const errDetail = pollClips[0].metadata?.error_message || 'Unknown error'
                            updateJob('suno_gen', 30, `❌ [Suno] Generasi gagal di server Suno: ${errDetail}`)
                            throw new Error(`Generasi lagu di Suno gagal: ${errDetail}`)
                        }
                    } else {
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `⚠️ [Suno Poll #${pollAttempts}] Response kosong/invalid`)
                    }
                }

                if (!audioUrl) {
                    throw new Error(`Timeout setelah ${pollAttempts} percobaan polling (${maxAttempts * 8}s).`)
                }
            })()

            // ─────────────────────────────────────────────
            // GEMINI METADATA (parallel dengan Suno)
            // ─────────────────────────────────────────────
            const geminiPromise = (async () => {
                updateJob('gemini_meta', 20, '🧠 [Gemini] Memulai generasi metadata YouTube...')
                updateJob('gemini_meta', 21, `📝 [Gemini] Input prompt untuk metadata: "${finalPrompt.slice(0, 100)}..."`)
                try {
                    const metadata = await aiService.generateYoutubeMetadata(finalPrompt)
                    if (metadata && metadata.title) {
                        videoTitle = title || metadata.title
                        youtubeDesc = metadata.description || youtubeDesc
                        youtubeTags = metadata.tags || youtubeTags
                        imgGenPrompt = metadata.imagePrompt || finalPrompt
                        updateJob('gemini_meta', 35, `✅ [Gemini] Metadata selesai!`)
                        updateJob('gemini_meta', 36, `📌 Judul: "${videoTitle}"`)
                        updateJob('gemini_meta', 37, `🏷️ Tags: [${youtubeTags.slice(0, 5).join(', ')}...]`)
                        updateJob('gemini_meta', 38, `🖼️ Image Prompt: "${imgGenPrompt.slice(0, 100)}..."`)
                    } else {
                        updateJob('gemini_meta', 35, `⚠️ [Gemini] Response tidak valid, menggunakan fallback metadata.`)
                    }
                } catch (err) {
                    updateJob('gemini_meta', 35, `⚠️ [Gemini] Gagal (${err.message}). Menggunakan fallback metadata.`)
                }
            })()

            // Wait for both
            updateJob('suno_gen', 19, '⏳ Menunggu Suno + Gemini selesai (parallel)...')
            await Promise.all([sunoPromise, geminiPromise])
            updateJob('suno_gen', 52, '✅ [PARALLEL] Suno + Gemini keduanya selesai!')

            // ─────────────────────────────────────────────
            // 3. GENERATE THUMBNAIL IMAGE
            // ─────────────────────────────────────────────
            updateJob('img_gen', 54, '━━━ [STEP 3] Image Generation ━━━')
            updateJob('img_gen', 55, `🖼️ [ImgGen] Membuat thumbnail via FLUX/Pollinations...`)
            updateJob('img_gen', 56, `📄 [ImgGen] Prompt: "${imgGenPrompt.slice(0, 120)}..."`)
            try {
                const imgResult = await aiService.generateImage(imgGenPrompt)
                fs.writeFileSync(thumbnailPath, imgResult.buffer)
                const fileSizeKB = Math.round(fs.statSync(thumbnailPath).size / 1024)
                updateJob('img_gen', 62, `✅ [ImgGen] Thumbnail disimpan (${fileSizeKB} KB) → ${thumbnailPath}`)
            } catch (imgErr) {
                updateJob('img_gen', 60, `⚠️ [ImgGen] Gagal generate thumbnail: ${imgErr.message}`)
                throw imgErr
            }

            // ─────────────────────────────────────────────
            // 4. DOWNLOAD AUDIO
            // ─────────────────────────────────────────────
            updateJob('downloading', 63, '━━━ [STEP 4] Download Audio ━━━')
            updateJob('downloading', 65, `📥 [Download] Mengunduh audio dari: ${audioUrl}`)
            try {
                await downloadFile(audioUrl, audioPath)
                const audioSizeKB = Math.round(fs.statSync(audioPath).size / 1024)
                updateJob('downloading', 72, `✅ [Download] Audio berhasil (${audioSizeKB} KB) → ${audioPath}`)
            } catch (dlErr) {
                updateJob('downloading', 65, `❌ [Download] Gagal mengunduh audio: ${dlErr.message}`)
                throw dlErr
            }

            // ─────────────────────────────────────────────
            // 5. FFMPEG VIDEO RENDER
            // ─────────────────────────────────────────────
            updateJob('ffmpeg', 73, '━━━ [STEP 5] FFmpeg Video Render ━━━')
            const overlayPath = path.resolve('./storage/assets/partikel_api.mp4')
            const overlayExists = fs.existsSync(overlayPath)
            let ffmpegCmd = ''

            if (overlayExists) {
                updateJob('ffmpeg', 75, '✅ [FFmpeg] partikel_api.mp4 ditemukan → menggunakan blend filter')
                ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -stream_loop -1 -i "${overlayPath}" -i "${audioPath}" -filter_complex "[1:v]scale=1280:720,setsar=1[v1];[0:v]scale=1280:720,setsar=1[v0];[v1][v0]blend=all_mode=screen:all_opacity=0.7[outv]" -map "[outv]" -map 2:a -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
            } else {
                updateJob('ffmpeg', 75, '⚠️ [FFmpeg] partikel_api.mp4 tidak ada → rendering video statis')
                ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -i "${audioPath}" -c:v libx264 -preset veryfast -tune stillimage -c:a aac -shortest "${outputPath}"`
            }
            updateJob('ffmpeg', 76, `🔧 [FFmpeg] CMD: ${ffmpegCmd.slice(0, 200)}...`)

            await new Promise((resolve, reject) => {
                const child = exec(ffmpegCmd)
                let lastTime = ''

                child.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n')
                    for (const line of lines) {
                        if (line.includes('time=')) {
                            const match = line.match(/time=(\d{2}:\d{2}:\d{2})/)
                            if (match && match[1] !== lastTime) {
                                lastTime = match[1]
                                updateJob('ffmpeg', 80, `🎬 [FFmpeg] Encoding... Progress: ${match[1]}`)
                            }
                        } else if (line.includes('fps=') || line.includes('bitrate=')) {
                            // silent
                        } else if (line.includes('Error') || line.includes('Invalid')) {
                            updateJob('ffmpeg', 78, `⚠️ [FFmpeg stderr] ${line.trim()}`)
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

            const outSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)
            updateJob('ffmpeg', 88, `✅ [FFmpeg] Render selesai! Output: ${outSizeMB} MB → ${outputPath}`)

            // ─────────────────────────────────────────────
            // 6. UPLOAD TO YOUTUBE
            // ─────────────────────────────────────────────
            updateJob('youtube_upload', 89, '━━━ [STEP 6] Upload ke YouTube ━━━')
            const youtubePrivacy = process.env.YOUTUBE_PRIVACY || 'private'
            updateJob('youtube_upload', 90, `📤 [YouTube] Memulai upload dengan privasi: ${youtubePrivacy}`)
            updateJob('youtube_upload', 91, `📌 [YouTube] Judul: "${videoTitle}"`)
            updateJob('youtube_upload', 92, `🏷️ [YouTube] Tags: [${youtubeTags.slice(0, 5).join(', ')}]`)

            const youtubeUrl = await uploadVideo({
                videoPath: outputPath,
                title: videoTitle,
                description: `${youtubeDesc}\n\n---\nVideo ini dibuat secara otomatis menggunakan Suno API & Gemini.`,
                tags: youtubeTags,
                privacyStatus: youtubePrivacy,
                onProgress: (p) => {
                    updateJob('youtube_upload', 90 + Math.floor(p * 0.09), `📡 [YouTube] Upload progress: ${p}%`)
                }
            })

            // ─────────────────────────────────────────────
            // 7. SUCCESS & FINAL NOTIFICATION
            // ─────────────────────────────────────────────
            job.status = 'completed'
            job.youtubeUrl = youtubeUrl
            updateJob('done', 100, `━━━ [PIPELINE COMPLETE] ✅ ━━━`)
            updateJob('done', 100, `🎉 Video berhasil dipublikasikan ke YouTube!`)
            updateJob('done', 100, `🔗 URL: ${youtubeUrl}`)

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
            updateJob('failed', 100, `━━━ [PIPELINE FAILED] ❌ ━━━`)
            updateJob('failed', 100, `💥 Error: ${error.message}`)
            if (error.stack) {
                const stackLines = error.stack.split('\n').slice(0, 4).join(' | ')
                updateJob('failed', 100, `🔍 Stack: ${stackLines}`)
            }

            if (chatId) {
                const sock = getSocket()
                if (sock) {
                    await sock.sendMessage(chatId, {
                        text: `❌ *Gagal Membuat Lagu AI* ❌\n\n*Pesan Error:* ${error.message}\n\nSilakan coba lagi beberapa saat.`
                    })
                }
            }
        } finally {
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
