// src/services/suno.js
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec, execSync } from 'child_process'
import crypto from 'crypto'
import { aiService } from './ai.js'
import { uploadVideo } from './youtube.js'
import { uploadToDrive } from './gdrive.js'
import { eventBus } from '../events/bus.js'
import { logger, getSocket } from '../utils/logger.js'
import dotenv from 'dotenv'
import sharp from 'sharp'
dotenv.config({ override: true })

// Active jobs database in-memory
const activeJobs = new Map()

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

async function addBannerToImage(imageBuffer, title) {
    try {
        const escapedTitle = escapeXml(title.toUpperCase())
        const svg = `
        <svg width="1920" height="1080">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
                    <stop offset="100%" style="stop-color:rgba(0,0,0,0.85);stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect x="0" y="750" width="1920" height="330" fill="url(#grad)" />
            <text x="960" y="920" font-family="sans-serif" font-size="64" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1">
                ${escapedTitle}
            </text>
            <text x="960" y="980" font-family="sans-serif" font-size="24" font-weight="bold" fill="#3B82F6" text-anchor="middle" letter-spacing="4">
                OFFICIAL INSTRUMENTAL AUDIO
            </text>
        </svg>
        `
        const svgBuffer = Buffer.from(svg)
        return await sharp(imageBuffer)
            .composite([{ input: svgBuffer, top: 0, left: 0 }])
            .toBuffer()
    } catch (err) {
        logger.error(`[Sharp/Overlay] Gagal menambahkan banner ke gambar: ${err.message}`)
        return imageBuffer
    }
}

async function createBannerOverlay(width, height, title) {
    try {
        const escapedTitle = escapeXml(title.toUpperCase())
        const svg = `
        <svg width="${width}" height="${height}">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
                    <stop offset="100%" style="stop-color:rgba(0,0,0,0.85);stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect x="0" y="${height - 220}" width="${width}" height="220" fill="url(#grad)" />
            <text x="${width / 2}" y="${height - 110}" font-family="sans-serif" font-size="42" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1">
                ${escapedTitle}
            </text>
            <text x="${width / 2}" y="${height - 70}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#3B82F6" text-anchor="middle" letter-spacing="4">
                OFFICIAL INSTRUMENTAL AUDIO
            </text>
        </svg>
        `
        return await sharp({
            create: {
                width,
                height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()
    } catch (err) {
        logger.error(`[Sharp/Overlay] Gagal membuat banner overlay: ${err.message}`)
        return null
    }
}

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
export async function startSunoPipeline({ 
    prompt, 
    title, 
    enhance = false, 
    source = 'web', 
    chatId = null, 
    model = 'suno', 
    manualAudioPath = null,
    isCustom = false,
    lyrics = null,
    tags = null,
    make_instrumental = false,
    enhanceLyrics = false
}) {
    const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    
    const job = {
        id: jobId,
        prompt,
        title: title || 'Untitled Music',
        status: 'running',
        stage: 'idle',
        progress: 0,
        logs: [],
        youtubeUrl: null,
        source,
        chatId,
        model,
        manualAudioPath,
        timestamp: Date.now()
    }

    activeJobs.set(jobId, job)

    function updateJob(stage, progress, logMsg) {
        job.stage = stage
        job.progress = progress
        if (logMsg) {
            const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const fullLog = `[${timestamp}] ${logMsg}`
            
            // Avoid flooding the terminal logs: check if the new log and the last log are transient progress updates
            if (job.logs.length > 0) {
                const lastLog = job.logs[job.logs.length - 1]
                const isFfmpegProgress = (logMsg.includes('[FFmpeg] Rendering') || logMsg.includes('[FFmpeg] Encoding')) && 
                                         (lastLog.includes('[FFmpeg] Rendering') || lastLog.includes('[FFmpeg] Encoding'))
                const isYoutubeProgress = logMsg.includes('[YouTube] Upload progress') && lastLog.includes('[YouTube] Upload progress')
                
                if (isFfmpegProgress || isYoutubeProgress) {
                    job.logs[job.logs.length - 1] = fullLog
                    eventBus.emitEvent('suno:status', job)
                    return
                }
            }
            
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
        let videoMotionPrompt = 'make this image come alive with slow cinematic motion, 4k'
        let finalLyrics = lyrics

        try {
            updateJob('idle', 2, `━━━ [PIPELINE START] Job ID: ${jobId} ━━━`)
            updateJob('idle', 3, `📝 Mode: ${isCustom ? 'Custom Vocal/Lyrics' : 'Description Mode'}`)
            if (isCustom) {
                updateJob('idle', 3, `📝 Lyrics: "${finalLyrics ? finalLyrics.slice(0, 80) + '...' : '(No Lyrics/Instrumental)'}"`)
                updateJob('idle', 4, `🏷️ Style/Tags: "${tags || prompt}"`)
            } else {
                updateJob('idle', 3, `📝 Prompt awal: "${prompt}"`)
            }
            updateJob('idle', 4, `🔧 Enhance mode: ${enhance ? 'ON' : 'OFF'} | Source: ${source}`)

            // ─────────────────────────────────────────────
            // 1. AI ENHANCE PROMPT / LYRICS
            // ─────────────────────────────────────────────
            if (isCustom && enhanceLyrics && finalLyrics) {
                updateJob('ai_enhance', 8, '🤖 [AI Lyrics Enhance] Menyempurnakan lirik menggunakan Gemini...')
                try {
                    const lyricInstructions = `You are a professional songwriter. Enhance, refine and format these lyrics for a song. 
Improve the rhythm, flow, rhymes, and structure (add [Verse], [Chorus] headings where appropriate). 
IMPORTANT: Return ONLY the song lyrics. Do not include any explanations, introduction or notes.
Original lyrics:
${finalLyrics}`
                    
                    const ai = await import('./ai.js')
                    const { GoogleGenerativeAI } = await import('@google/generative-ai')
                    const genAI = ai.genAI || new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
                    const lyricEnhancerModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
                    const enhanceRes = await lyricEnhancerModel.generateContent(lyricInstructions)
                    const enhancedLyrics = enhanceRes.response.text()?.trim()
                    if (enhancedLyrics) {
                        finalLyrics = enhancedLyrics
                        updateJob('ai_enhance', 12, '✅ [AI Lyrics Enhance] Lirik berhasil disempurnakan!')
                    }
                } catch (lyricErr) {
                    updateJob('ai_enhance', 12, `⚠️ [AI Lyrics Enhance] Gagal (${lyricErr.message}). Menggunakan lirik asli.`)
                }
            }

            if (!isCustom && enhance && model !== 'manual') {
                updateJob('ai_enhance', 14, '🤖 [AI Enhance] Memulai penyempurnaan prompt dengan Groq...')
                try {
                    const aiInstructions = `You are an expert music producer and Suno AI prompt engineer.
Enhance this song idea into a highly descriptive music prompt: "${prompt}"
Describe the genre, tempo, instruments, mood, and vocal style (if any).
IMPORTANT: Return ONLY the prompt text. No explanations. MAXIMUM 400 CHARACTERS.`
                    
                    let enhanced = ""
                    
                    try {
                        const { groq, GROQ_MODELS, getAvailableModel } = await import('./ai.js')
                        const groqModel = getAvailableModel(GROQ_MODELS)
                        const res = await groq.chat.completions.create({
                            model: groqModel,
                            messages: [{ role: 'user', content: aiInstructions }],
                            temperature: 0.7,
                        })
                        enhanced = res.choices[0]?.message?.content?.trim()
                    } catch (groqErr) {
                        updateJob('ai_enhance', 12, `⚠️ [AI Enhance] Groq sibuk, fallback ke Gemini...`)
                        const ai = await import('./ai.js')
                        const { GoogleGenerativeAI } = await import('@google/generative-ai')
                        const genAI = ai.genAI || new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
                        const enhancerModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
                        const enhanceRes = await enhancerModel.generateContent(aiInstructions)
                        enhanced = enhanceRes.response.text()?.trim()
                    }
                    
                    if (enhanced.length > 490) enhanced = enhanced.slice(0, 490) // safety cutoff
                    finalPrompt = enhanced || prompt

                    updateJob('ai_enhance', 15, `✅ [AI Enhance] Prompt berhasil disempurnakan (${finalPrompt.length} chars)`)
                    updateJob('ai_enhance', 16, `📄 Enhanced Prompt: "${finalPrompt.slice(0, 200)}${finalPrompt.length > 200 ? '...' : ''}"`)
                } catch (enhErr) {
                    updateJob('ai_enhance', 15, `⚠️ [AI Enhance] Gagal (${enhErr.message}), menggunakan prompt asli.`)
                    finalPrompt = prompt
                }
            }

            // ─────────────────────────────────────────────
            // 2. AUDIO GENERATION
            // ─────────────────────────────────────────────
            updateJob('suno_gen', 18, '━━━ [STEP 2] Audio Generation ━━━')

            let audioUrl = null

            await (async () => {
                if (model === 'manual') {
                    updateJob('suno_gen', 50, '🎵 [Manual] Menggunakan MP3 hasil upload user...')
                    if (!manualAudioPath) throw new Error('Audio file not provided for manual mode.')
                    return 'MANUAL_MODE'
                }
                
                if (model === 'stable') {
                    updateJob('suno_gen', 20, '🎵 [StableAudio] Menyambung ke HuggingFace Space: stabilityai/stable-audio-3...')
                    const { client } = await import('@gradio/client')
                    try {
                        const hfToken = (process.env.HF_TOKEN || '').replace(/^["']|["']$/g, '')
                        updateJob('suno_gen', 21, `🔑 [StableAudio] HF_TOKEN loaded: ${hfToken ? 'YES (len: ' + hfToken.length + ')' : 'NO'}`)
                        const app = await client('stabilityai/stable-audio-3', hfToken ? { hf_token: hfToken } : {})
                        updateJob('suno_gen', 25, '📤 [StableAudio] Space terhubung. Mengirim parameter inferensi...')
                        
                        const result = await app.predict('/infer', [
                            "medium", finalPrompt, 380, 20, 3, "pingpong", 0
                        ])
                        updateJob('suno_gen', 45, '✅ [StableAudio] Berhasil melakukan generasi audio!')
                        const audioFileObj = result.data[0]
                        if (audioFileObj && audioFileObj.url) {
                            audioUrl = audioFileObj.url
                            return audioUrl
                        }
                        throw new Error('No audio URL found in Gradio response')
                    } catch (err) {
                        updateJob('suno_gen', 25, `❌ [StableAudio] ERROR: ${err.message}`)
                        throw new Error(`Stable Audio API Error: ${err.message}`)
                    }
                }
                
                if (model === 'suno_com') {
                    const apiBaseUrl = process.env.SUNO_API_URL || 'https://sunoapi-bice.vercel.app'
                    const generateUrl = `${apiBaseUrl}/api/generate`
                    updateJob('suno_gen', 20, `🎵 [Suno.com] Target URL: ${generateUrl}`)
                    updateJob('suno_gen', 22, `📤 [Suno.com] Mengirim request generate ke Vercel/Suno API bypass...`)
                    
                    const requestPayload = {
                        prompt: isCustom ? (finalLyrics || '') : finalPrompt,
                        make_instrumental: isCustom ? make_instrumental : false,
                        wait_audio: true,
                        isCustom,
                        tags: isCustom ? (tags || '') : undefined,
                        title: title || undefined
                    }
                    
                    const headers = {
                        'Content-Type': 'application/json',
                        'bypass-tunnel-reminder': 'true'
                    }
                    if (process.env.SUNO_COOKIE) {
                        headers['Cookie'] = process.env.SUNO_COOKIE
                    }
                    
                    let genResponse
                    try {
                        genResponse = await axios.post(generateUrl, requestPayload, {
                            headers,
                            timeout: 180000 // 3 minutes
                        })
                    } catch (err) {
                        const httpStatus = err.response?.status || 'N/A'
                        const httpBody = JSON.stringify(err.response?.data || err.message)
                        updateJob('suno_gen', 25, `❌ [Suno.com] HTTP ${httpStatus} ERROR: ${httpBody}`)
                        throw new Error(`Suno.com API Error [HTTP ${httpStatus}]: ${httpBody}`)
                    }
                    
                    const resultData = genResponse.data
                    let firstClip = null
                    if (Array.isArray(resultData) && resultData.length > 0) {
                        firstClip = resultData[0]
                    } else if (resultData && Array.isArray(resultData.clips)) {
                        firstClip = resultData.clips[0]
                    }

                    if (firstClip) {
                        const status = String(firstClip.status || '').toLowerCase()
                        if (status === 'error' || status === 'failed') {
                            throw new Error(`Suno.com API Audio Generation Gagal: ${firstClip.error_message || 'Suno server error'}`)
                        }
                        audioUrl = firstClip.audio_url || firstClip.audioUrl || firstClip.url
                    }
                    
                    if (!audioUrl) {
                        throw new Error(`Suno.com API tidak mengembalikan URL audio yang valid: ${JSON.stringify(resultData)}`)
                    }
                    
                    updateJob('suno_gen', 50, `🎉 [Suno.com] Audio selesai! URL: ${audioUrl}`)
                    return
                }

                // Default Suno API Logic
                const apiBaseUrl = 'https://api.sunoapi.org/api/v1'
                const apiKey = process.env.SUNOAPI_KEY || '449d422f1583ad8b941e4ea63cffbc4b'
                const generateUrl = `${apiBaseUrl}/generate`

                updateJob('suno_gen', 20, `🎵 [Suno] Target URL: ${generateUrl}`)
                updateJob('suno_gen', 22, `📤 [Suno] Mengirim request generate ke SunoAPI.org...`)

                let genResponse
                try {
                    const requestPayload = {
                        prompt: isCustom ? (finalLyrics || '') : finalPrompt,
                        customMode: isCustom,
                        instrumental: isCustom ? make_instrumental : false,
                        tags: isCustom ? (tags || '') : undefined,
                        title: title || undefined,
                        model: 'V5_5',
                        callBackUrl: 'https://google.com'
                    }
                    updateJob('suno_gen', 23, `📦 [Suno] Payload: ${JSON.stringify(requestPayload).slice(0, 150)}`)
                    genResponse = await axios.post(generateUrl, requestPayload, {
                        timeout: 30000,
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        }
                    })
                    updateJob('suno_gen', 26, `✅ [Suno] HTTP ${genResponse.status} — Request diterima!`)
                } catch (err) {
                    const httpStatus = err.response?.status || 'N/A'
                    const httpBody = JSON.stringify(err.response?.data || err.message)
                    updateJob('suno_gen', 25, `❌ [Suno] HTTP ${httpStatus} ERROR: ${httpBody}`)
                    throw new Error(`Suno API Error [HTTP ${httpStatus}]: ${httpBody}`)
                }

                const resultData = genResponse.data
                if (resultData.code !== 200 || !resultData.data) {
                    updateJob('suno_gen', 26, `❌ [Suno] Response tidak valid: ${JSON.stringify(resultData).slice(0, 200)}`)
                    throw new Error(`Suno API tidak mengembalikan data yang valid: ${resultData.msg || 'Unknown'}`)
                }

                let clipIds = ''
                let pollQuery = ''
                if (Array.isArray(resultData.data)) {
                    if (resultData.data.length === 0) throw new Error('Data array kosong dari Suno API')
                    clipIds = resultData.data.map(c => c.id).join(',')
                    pollQuery = `ids=${clipIds}`
                } else if (resultData.data.taskId) {
                    clipIds = resultData.data.taskId
                    pollQuery = `taskId=${clipIds}`
                } else {
                    throw new Error(`Format data tidak dikenali dari Suno API: ${JSON.stringify(resultData.data)}`)
                }

                updateJob('suno_gen', 28, `🆔 [Suno] ID diterima: ${clipIds}`)
                updateJob('suno_gen', 30, `⏳ [Suno] Memulai polling status setiap 8 detik...`)

                let complete = false
                let pollAttempts = 0
                const maxAttempts = 60

                while (!complete && pollAttempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 8000))
                    pollAttempts++

                    let pollResponse
                    try {
                        pollResponse = await axios.get(`${apiBaseUrl}/generate/record-info?${pollQuery}`, {
                            timeout: 15000,
                            headers: { 'Authorization': `Bearer ${apiKey}` }
                        })
                    } catch (err) {
                        const httpStatus = err.response?.status || 'N/A'
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `⚠️ [Suno Poll #${pollAttempts}] HTTP ${httpStatus}: ${err.message}`)
                        continue
                    }

                    const pollResult = pollResponse.data
                    let firstClip = null
                    
                    if (pollResult.code === 200 && pollResult.data) {
                        if (Array.isArray(pollResult.data) && pollResult.data.length > 0) {
                            firstClip = pollResult.data[0]
                        } else if (!Array.isArray(pollResult.data) && (pollResult.data.status || pollResult.data.id)) {
                            firstClip = pollResult.data
                        }
                    }

                    if (firstClip) {
                        const status = String(firstClip.status || '').toLowerCase()
                        const pct = firstClip.metadata?.gpt_description_prompt ? 'prompt_ready' : ''
                        updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `🔄 [Suno Poll #${pollAttempts}] Status: ${firstClip.status} ${pct}`)

                        // Cek URL dari format response lama (array) atau format baru sunoapi.org (sunoData)
                        const sunoDataClip = firstClip.response?.sunoData?.[0] || {}
                        const potentialAudioUrl = firstClip.audio_url || firstClip.audioUrl || firstClip.url || firstClip.video_url || firstClip.videoUrl || sunoDataClip.audioUrl || sunoDataClip.audio_url || ''

                        if (status === 'complete' || status === 'success' || (potentialAudioUrl && status !== 'generating')) {
                            audioUrl = potentialAudioUrl
                            
                            // Jika status SUCCESS tapi belum ada URL, jangan langsung diselesaikan
                            if (!audioUrl && (status === 'complete' || status === 'success')) {
                                updateJob('suno_gen', 30 + Math.min(pollAttempts, 18), `⚠️ [Suno Poll #${pollAttempts}] Status SUCCESS tapi URL audio belum tersedia...`)
                            } else {
                                updateJob('suno_gen', 50, `🎉 [Suno] Audio selesai! URL: ${audioUrl}`)
                                complete = true
                            }
                        } else if (status === 'failed') {
                            const errDetail = firstClip.metadata?.error_message || 'Unknown error'
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
            // 2b. GEMINI METADATA GENERATION
            // ─────────────────────────────────────────────
            updateJob('gemini_meta', 51, '━━━ [STEP 2b] Gemini Metadata Generation ━━━')
            await (async () => {
                updateJob('gemini_meta', 52, '🧠 [Gemini] Memulai generasi metadata YouTube...')
                updateJob('gemini_meta', 53, `📝 [Gemini] Input prompt untuk metadata: "${finalPrompt.slice(0, 100)}..."`)
                try {
                    const metadata = await aiService.generateYoutubeMetadata(finalPrompt)
                    if (metadata && metadata.title) {
                        videoTitle = title || metadata.title
                        youtubeDesc = metadata.description || youtubeDesc
                        youtubeTags = metadata.tags || youtubeTags
                        imgGenPrompt = metadata.imagePrompt || finalPrompt
                        videoMotionPrompt = metadata.videoMotionPrompt || videoMotionPrompt
                        updateJob('gemini_meta', 53, `✅ [Gemini] Metadata selesai!`)
                        updateJob('gemini_meta', 53, `📌 Judul: "${videoTitle}"`)
                        updateJob('gemini_meta', 53, `🏷️ Tags: [${youtubeTags.slice(0, 5).join(', ')}...]`)
                        updateJob('gemini_meta', 53, `🖼️ Image Prompt: "${imgGenPrompt.slice(0, 100)}..."`)
                        updateJob('gemini_meta', 53, `🎥 Motion Prompt: "${videoMotionPrompt.slice(0, 100)}..."`)
                    } else {
                        updateJob('gemini_meta', 53, `⚠️ [Gemini] Response tidak valid, menggunakan fallback metadata.`)
                    }
                } catch (err) {
                    updateJob('gemini_meta', 53, `⚠️ [Gemini] Gagal (${err.message}). Menggunakan fallback metadata.`)
                }
            })()

            // ─────────────────────────────────────────────
            // 3. GENERATE THUMBNAIL IMAGE
            // ─────────────────────────────────────────────
            // ─────────────────────────────────────────────
            // 3. GENERATE THUMBNAIL IMAGE
            // ─────────────────────────────────────────────
            updateJob('img_gen', 54, '━━━ [STEP 3] Image Generation ━━━')
            updateJob('img_gen', 55, `🖼️ [ImgGen] Membuat thumbnail via FLUX/Pollinations...`)
            updateJob('img_gen', 56, `📄 [ImgGen] Prompt: "${imgGenPrompt.slice(0, 120)}..."`)
            try {
                const imgResult = await aiService.generateImage(imgGenPrompt, 1920, 1080)
                let finalBuffer = imgResult.buffer
                
                // Simpan plain thumbnail tanpa teks banner untuk input video gen
                const plainThumbnailPath = path.join(tempDir, 'plain_thumbnail.png')
                fs.writeFileSync(plainThumbnailPath, finalBuffer)

                // Simpan thumbnail dengan teks banner untuk fallback static
                try {
                    updateJob('img_gen', 58, `🎨 [ImgGen] Menambahkan banner teks judul ke thumbnail...`)
                    finalBuffer = await addBannerToImage(finalBuffer, videoTitle)
                } catch (sharpErr) {
                    logger.warn(`[ImgGen] Gagal menambahkan banner ke gambar: ${sharpErr.message}`)
                }
                fs.writeFileSync(thumbnailPath, finalBuffer)
                const fileSizeKB = Math.round(fs.statSync(thumbnailPath).size / 1024)
                updateJob('img_gen', 60, `✅ [ImgGen] Thumbnail disimpan (${fileSizeKB} KB) → ${thumbnailPath}`)
            } catch (imgErr) {
                updateJob('img_gen', 60, `⚠️ [ImgGen] Gagal generate thumbnail: ${imgErr.message}`)
                throw imgErr
            }

            // ─────────────────────────────────────────────
            // 3b. GENERATE VIDEO BACKGROUND (NEW)
            // ─────────────────────────────────────────────
            updateJob('img_gen', 61, '🎥 [VideoGen] Memulai generasi motion background dari thumbnail...')
            const videoBackgroundPath = path.join(tempDir, 'motion_background.mp4')
            let videoBackgroundExists = false
            try {
                const videoBuffer = await aiService.generateVideoFromImage(path.join(tempDir, 'plain_thumbnail.png'), videoMotionPrompt)
                fs.writeFileSync(videoBackgroundPath, videoBuffer)
                videoBackgroundExists = true
                updateJob('img_gen', 62, `✅ [VideoGen] Video background berhasil dibuat!`)
            } catch (videoErr) {
                updateJob('img_gen', 62, `⚠️ [VideoGen] Gagal generate video: ${videoErr.message}. Fallback ke static image.`)
            }

            // ─────────────────────────────────────────────
            // 4. DOWNLOAD AUDIO
            // ─────────────────────────────────────────────
            updateJob('downloading', 63, '━━━ [STEP 4] Download Audio ━━━')
            try {
                if (model === 'manual') {
                    updateJob('downloading', 65, `📥 [Download] Menggunakan file manual: ${manualAudioPath}`)
                    fs.copyFileSync(manualAudioPath, audioPath)
                    updateJob('downloading', 72, `✅ [Download] Audio disalin ke direktori job → ${audioPath}`)
                } else {
                    updateJob('downloading', 65, `📥 [Download] Mengunduh audio dari: ${audioUrl}`)
                    await downloadFile(audioUrl, audioPath)
                    const audioSizeKB = Math.round(fs.statSync(audioPath).size / 1024)
                    updateJob('downloading', 72, `✅ [Download] Audio berhasil (${audioSizeKB} KB) → ${audioPath}`)
                }
            } catch (dlErr) {
                updateJob('downloading', 65, `❌ [Download] Gagal mengunduh audio: ${dlErr.message}`)
                throw dlErr
            }

            // ─────────────────────────────────────────────
            // 4b. PARALLEL BACKGROUND UPLOAD TO GOOGLE DRIVE
            // ─────────────────────────────────────────────
            let drivePromise = null
            let driveUrl = null
            try {
                updateJob('downloading', 72, '📤 [Google Drive] Menginisiasi upload audio mentah ke Google Drive di background...')
                const cleanTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '_').trim() || `song_${jobId}`
                const driveFileName = `${cleanTitle}.mp3`
                
                drivePromise = uploadToDrive(audioPath, driveFileName, 'audio/mpeg')
                    .then(url => {
                        updateJob('downloading', 72, `✅ [Google Drive] Background upload sukses! Link: ${url}`)
                        driveUrl = url
                        return url
                    })
                    .catch(err => {
                        logger.error(`[Google Drive Background Upload] Gagal: ${err.message}`)
                        updateJob('downloading', 72, `⚠️ [Google Drive] Background upload gagal: ${err.message}`)
                        return null
                    })
            } catch (driveErr) {
                logger.error(`[Google Drive Background Setup] Gagal: ${driveErr.message}`)
            }

            // ─────────────────────────────────────────────
            // 5. FFMPEG VIDEO RENDER
            // ─────────────────────────────────────────────
            updateJob('ffmpeg', 73, '━━━ [STEP 5] FFmpeg Video Render ━━━')
            const overlayPath = path.resolve('./storage/assets/partikel_api.mp4')
            const overlayExists = fs.existsSync(overlayPath)
            let ffmpegCmd = ''

            if (videoBackgroundExists) {
                const bannerOverlayPath = path.join(tempDir, 'banner_overlay.png')
                const bannerOverlayBuffer = await createBannerOverlay(1280, 720, videoTitle)
                if (bannerOverlayBuffer) {
                    fs.writeFileSync(bannerOverlayPath, bannerOverlayBuffer)
                }
                const bannerExists = fs.existsSync(bannerOverlayPath)

                if (overlayExists && bannerExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background + partikel + banner overlay')
                    ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBackgroundPath}" -stream_loop -1 -i "${overlayPath}" -i "${bannerOverlayPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1280:720,setsar=1[v0];[1:v]scale=1280:720,setsar=1[v1];[v1][v0]blend=all_mode=screen:all_opacity=0.4[v2];[v2][2:v]overlay=0:0[outv]" -map "[outv]" -map 3:a -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
                } else if (bannerExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background + banner overlay')
                    ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBackgroundPath}" -i "${bannerOverlayPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1280:720,setsar=1[v0];[v0][1:v]overlay=0:0[outv]" -map "[outv]" -map 2:a -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
                } else {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background saja')
                    ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBackgroundPath}" -i "${audioPath}" -vf "scale=1280:720,setsar=1" -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
                }
            } else {
                if (overlayExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] partikel_api.mp4 ditemukan → menggunakan blend filter (16:9) static')
                    ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -stream_loop -1 -i "${overlayPath}" -i "${audioPath}" -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];[1:v]scale=1280:720,setsar=1[v1];[v1][v0]blend=all_mode=screen:all_opacity=0.7[outv]" -map "[outv]" -map 2:a -c:v libx264 -preset veryfast -c:a aac -shortest "${outputPath}"`
                } else {
                    updateJob('ffmpeg', 75, '⚠️ [FFmpeg] partikel_api.mp4 tidak ada → rendering video statis (16:9) static')
                    ffmpegCmd = `ffmpeg -y -loop 1 -i "${thumbnailPath}" -i "${audioPath}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset veryfast -tune stillimage -c:a aac -shortest "${outputPath}"`
                }
            }
            updateJob('ffmpeg', 76, `🔧 [FFmpeg] CMD: ${ffmpegCmd.slice(0, 200)}...`)

            let totalDuration = null
            try {
                const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
                const durationStr = execSync(probeCmd).toString().trim()
                const secs = parseFloat(durationStr)
                if (!isNaN(secs)) {
                    totalDuration = secs
                }
            } catch (err) {
                logger.warn(`[FFmpeg/Probe] Gagal mendapatkan durasi audio: ${err.message}`)
            }

            await new Promise((resolve, reject) => {
                const child = exec(ffmpegCmd)
                let lastTime = ''
                const startTime = Date.now()

                child.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n')
                    for (const line of lines) {
                        if (line.includes('time=')) {
                            const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})/)
                            if (match) {
                                const timeStr = `${match[1]}:${match[2]}:${match[3]}`
                                if (timeStr !== lastTime) {
                                    lastTime = timeStr
                                    
                                    const currentSecs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])
                                    
                                    if (totalDuration && totalDuration > 0) {
                                        const progressPct = Math.min((currentSecs / totalDuration) * 100, 99)
                                        const elapsedSecs = (Date.now() - startTime) / 1000
                                        const speed = currentSecs / elapsedSecs
                                        
                                        let etaStr = '--:--'
                                        if (speed > 0) {
                                            const remainingSecs = Math.max((totalDuration - currentSecs) / speed, 0)
                                            const etaM = Math.floor(remainingSecs / 60)
                                            const etaS = Math.floor(remainingSecs % 60)
                                            etaStr = `${String(etaM).padStart(2, '0')}:${String(etaS).padStart(2, '0')}`
                                        }
                                        
                                        const roundedPct = Math.round(progressPct)
                                        const currentProgress = 73 + Math.floor(progressPct * 0.15) // FFmpeg step range: 73 to 88
                                        
                                        updateJob('ffmpeg', currentProgress, `🎬 [FFmpeg] Rendering... ${roundedPct}% | Durasi: ${timeStr} / ${Math.floor(totalDuration)}s | ETA: ${etaStr}`)
                                    } else {
                                        updateJob('ffmpeg', 80, `🎬 [FFmpeg] Encoding... Progress: ${timeStr}`)
                                    }
                                }
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
                    updateJob('youtube_upload', 90 + Math.floor(p * 0.05), `📡 [YouTube] Upload progress: ${p}%`)
                }
            })

            // ─────────────────────────────────────────────
            // 6b. RESOLVE GOOGLE DRIVE UPLOAD
            // ─────────────────────────────────────────────
            if (drivePromise) {
                updateJob('youtube_upload', 96, '⏳ [Google Drive] Menunggu upload Google Drive selesai...')
                try {
                    driveUrl = await drivePromise
                    if (driveUrl) {
                        updateJob('youtube_upload', 99, `✅ [Google Drive] Sukses! Link: ${driveUrl}`)
                    } else {
                        updateJob('youtube_upload', 98, `⚠️ [Google Drive] Gagal upload`)
                    }
                } catch (driveErr) {
                    logger.error(`[Google Drive Finalize] Gagal: ${driveErr.message}`)
                    updateJob('youtube_upload', 98, `⚠️ [Google Drive] Gagal upload: ${driveErr.message}`)
                }
            }

            // ─────────────────────────────────────────────
            // 7. SUCCESS & FINAL NOTIFICATION
            // ─────────────────────────────────────────────
            job.status = 'completed'
            job.youtubeUrl = youtubeUrl
            job.driveUrl = driveUrl
            updateJob('done', 100, `━━━ [PIPELINE COMPLETE] ✅ ━━━`)
            updateJob('done', 100, `🎉 Video berhasil dipublikasikan ke YouTube!`)
            updateJob('done', 100, `🔗 YouTube: ${youtubeUrl}`)
            if (driveUrl) {
                updateJob('done', 100, `🔗 Google Drive: ${driveUrl}`)
            }

            if (chatId) {
                const sock = getSocket()
                if (sock) {
                    let textMsg = `🎵 *Lagu AI Kamu Selesai Dibuat!* 🎵\n\n*Judul:* ${videoTitle}\n*Link YouTube:* ${youtubeUrl}`
                    if (driveUrl) {
                        textMsg += `\n*Link Google Drive:* ${driveUrl}`
                    }
                    textMsg += `\n\n_Video berhasil digenerate, diupload ke YouTube, dan disimpan ke Google Drive otomatis!_`
                    await sock.sendMessage(chatId, { text: textMsg })
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
