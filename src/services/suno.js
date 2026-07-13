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

// Pending thumbnail confirmation resolvers: jobId → { resolve, reject, timer }
const thumbnailConfirmResolvers = new Map()

/**
 * Helper to scan and find the first available subscribe button video path.
 */
function getSubsButtonPath() {
    const paths = [
        process.env.SUBS_BUTTON_PATH,
        'C:\\Users\\Ronn\\Downloads\\subsbutton.webm',
        'C:\\Users\\Ronn\\Downloads\\subsbutton.mp4',
        path.resolve('./storage/assets/subsbutton.webm'),
        path.resolve('./subsbutton.webm'),
        '/home/container/subsbutton.webm'
    ];
    for (const p of paths) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

/**
 * Helper to probe media file duration using ffprobe/ffmpeg.
 */
function getMediaDuration(filePath) {
    try {
        let output = '';
        try {
            output = execSync(`ffmpeg -i "${filePath}"`, { stdio: 'pipe' }).toString();
        } catch (err) {
            output = (err.stdout || '').toString() + (err.stderr || '').toString();
        }
        const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = parseFloat(match[3]);
            return hours * 3600 + minutes * 60 + seconds;
        }
    } catch (err) {
        // Fallback
    }
    return 5.0;
}

/**
 * Called by the socket handler when the dashboard user confirms/rejects a thumbnail.
 */
export function confirmThumbnail(jobId, { approved, newPrompt = null } = {}) {
    const pending = thumbnailConfirmResolvers.get(jobId)
    if (!pending) return false
    clearTimeout(pending.timer)
    thumbnailConfirmResolvers.delete(jobId)
    pending.resolve({ approved, newPrompt })
    return true
}

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
function getProgressBar(pct) {
    const width = 12
    const filledCount = Math.round((pct / 100) * width)
    const emptyCount = width - filledCount
    return `[${'■'.repeat(filledCount)}${'□'.repeat(emptyCount)}]`
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
                const isFfmpegProgress = logMsg.includes('[FFmpeg]') &&
                    (logMsg.includes('Rendering') || logMsg.includes('Encoding')) &&
                    lastLog.includes('[FFmpeg]') &&
                    (lastLog.includes('Rendering') || lastLog.includes('Encoding'))
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
    ; (async () => {
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
                        const app = await client('stabilityai/stable-audio-3', hfToken ? { token: hfToken } : {})
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
                        const hasUserProvidedTitle = title && title.trim() !== '' && title !== 'Untitled Music' && title !== 'Manual Track'
                        videoTitle = hasUserProvidedTitle ? title : metadata.title
                        job.title = videoTitle // Update dashboard active job title in real time
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
            // 3b. INTERACTIVE THUMBNAIL CONFIRMATION
            // ─────────────────────────────────────────────
            {
                const AUTO_APPROVE_MS = 10 * 60 * 1000 // 10 minutes
                let thumbnailApproved = false

                while (!thumbnailApproved) {
                    // Read current thumbnail as base64 for frontend preview
                    const thumbBase64 = fs.readFileSync(thumbnailPath).toString('base64')
                    updateJob('img_gen', 60, `⏳ [ImgGen] Menunggu konfirmasi thumbnail dari dashboard...`)

                    // Emit to dashboard: show thumbnail + confirmation buttons
                    eventBus.emitEvent('suno:thumbnail_ready', {
                        jobId,
                        imageBase64: thumbBase64,
                        title: videoTitle
                    })

                    // Wait for user decision (or auto-approve after timeout)
                    const decision = await new Promise((resolve) => {
                        const timer = setTimeout(() => {
                            thumbnailConfirmResolvers.delete(jobId)
                            logger.warn(`[ImgGen/Confirm] Timeout reached for job ${jobId}. Auto-approving thumbnail.`)
                            updateJob('img_gen', 61, `⏰ [ImgGen] Timeout 10 menit, thumbnail di-approve otomatis.`)
                            resolve({ approved: true, newPrompt: null })
                        }, AUTO_APPROVE_MS)

                        thumbnailConfirmResolvers.set(jobId, { resolve, timer })
                    })

                    if (decision.approved) {
                        thumbnailApproved = true
                        updateJob('img_gen', 61, `✅ [ImgGen] Thumbnail dikonfirmasi! Melanjutkan ke video generation...`)
                    } else {
                        // User rejected — regenerate with new prompt
                        const regenPrompt = (decision.newPrompt && decision.newPrompt.trim()) || imgGenPrompt
                        updateJob('img_gen', 55, `🔄 [ImgGen] Thumbnail ditolak. Regenerasi dengan prompt baru: "${regenPrompt.slice(0, 80)}..."`)
                        try {
                            const regenResult = await aiService.generateImage(regenPrompt, 1920, 1080)
                            let regenBuffer = regenResult.buffer
                            const plainThumbnailPath = path.join(tempDir, 'plain_thumbnail.png')
                            fs.writeFileSync(plainThumbnailPath, regenBuffer)
                            try {
                                regenBuffer = await addBannerToImage(regenBuffer, videoTitle)
                            } catch (_) { }
                            fs.writeFileSync(thumbnailPath, regenBuffer)
                            const regenSizeKB = Math.round(fs.statSync(thumbnailPath).size / 1024)
                            updateJob('img_gen', 60, `✅ [ImgGen] Thumbnail baru disimpan (${regenSizeKB} KB). Menampilkan untuk konfirmasi ulang...`)
                            // Update imgGenPrompt so next loop uses new prompt
                            imgGenPrompt = regenPrompt
                        } catch (regenErr) {
                            updateJob('img_gen', 60, `⚠️ [ImgGen] Gagal regenerasi (${regenErr.message}). Menggunakan thumbnail sebelumnya.`)
                            thumbnailApproved = true // fallback: accept existing
                        }
                    }
                }
            }

            // ─────────────────────────────────────────────
            // 3c. GENERATE VIDEO BACKGROUND
            // ─────────────────────────────────────────────
            updateJob('img_gen', 61, '🎥 [VideoGen] Memulai generasi motion background dari thumbnail...')
            const videoBackgroundPath = path.join(tempDir, 'motion_background.mp4')
            let videoBackgroundExists = false
            try {
                const videoBuffer = await aiService.generateVideoFromImage(path.join(tempDir, 'plain_thumbnail.png'), videoMotionPrompt)
                fs.writeFileSync(videoBackgroundPath, videoBuffer)

                // Membuat ping-pong loop agar transisi video seamless ketika di-loop
                try {
                    updateJob('img_gen', 62, `🔄 [VideoGen] Membuat ping-pong seamless loop background...`)
                    const pingpongPath = path.join(tempDir, 'pingpong_background.mp4')
                    execSync(`ffmpeg -y -i "${videoBackgroundPath}" -filter_complex "[0:v]reverse[r];[0:v][r]concat=n=2:v=1[outv]" -map "[outv]" -c:v libx264 -preset ultrafast "${pingpongPath}"`, { stdio: 'ignore' })
                    if (fs.existsSync(pingpongPath)) {
                        fs.copyFileSync(pingpongPath, videoBackgroundPath)
                        try { fs.unlinkSync(pingpongPath) } catch (_) { }
                    }
                } catch (loopErr) {
                    logger.warn(`[VideoGen] Gagal membuat ping-pong loop: ${loopErr.message}`)
                }

                videoBackgroundExists = true
                updateJob('img_gen', 62, `✅ [VideoGen] Video background (seamless ping-pong) berhasil dibuat!`)
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
            let totalDuration = null
            try {
                let output = ''
                try {
                    output = execSync(`ffmpeg -i "${audioPath}"`, { stdio: 'pipe' }).toString()
                } catch (err) {
                    output = (err.stdout || '').toString() + (err.stderr || '').toString()
                }
                const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
                if (match) {
                    const hours = parseInt(match[1], 10)
                    const minutes = parseInt(match[2], 10)
                    const seconds = parseFloat(match[3])
                    totalDuration = hours * 3600 + minutes * 60 + seconds
                    logger.info(`[FFmpeg/Probe] Durasi audio didapatkan via ffmpeg: ${totalDuration} detik`)
                }
            } catch (err) {
                logger.warn(`[FFmpeg/Probe] Gagal mendapatkan durasi audio via ffmpeg: ${err.message}`)
            }

            const videoFadeIn = 1.5
            const videoFadeOut = 2.5
            const audioFadeIn = 1.0
            const audioFadeOut = 3.5

            const vFadeOutStart = totalDuration && totalDuration > videoFadeOut ? totalDuration - videoFadeOut : 0
            const aFadeOutStart = totalDuration && totalDuration > audioFadeOut ? totalDuration - audioFadeOut : 0

            let videoFadeFilter = ''
            let audioFadeFilter = ''
            if (totalDuration && totalDuration > 0) {
                videoFadeFilter = `,fade=t=in:st=0:d=${videoFadeIn},fade=t=out:st=${vFadeOutStart.toFixed(2)}:d=${videoFadeOut}`
                audioFadeFilter = `-af "afade=t=in:st=0:d=${audioFadeIn},afade=t=out:st=${aFadeOutStart.toFixed(2)}:d=${audioFadeOut}"`
            }

            const subsButtonPath = getSubsButtonPath()
            let ffmpegInputs = []
            let filterComplex = ''
            let audioInputIdx = -1
            let finalVideoLabel = ''

            if (videoBackgroundExists) {
                const bannerOverlayPath = path.join(tempDir, 'banner_overlay.png')
                const bannerOverlayBuffer = await createBannerOverlay(1920, 1080, videoTitle)
                if (bannerOverlayBuffer) {
                    fs.writeFileSync(bannerOverlayPath, bannerOverlayBuffer)
                }
                const bannerExists = fs.existsSync(bannerOverlayPath)

                if (overlayExists && bannerExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background + partikel + banner overlay (1080p45)')
                    ffmpegInputs = [
                        `-stream_loop -1 -i "${videoBackgroundPath}"`,
                        `-stream_loop -1 -i "${overlayPath}"`,
                        `-loop 1 -i "${bannerOverlayPath}"`,
                        `-i "${audioPath}"`
                    ]
                    filterComplex = `[0:v]scale=1920:1080,setsar=1,format=gbrp[v0];[1:v]scale=1920:1080,setsar=1,format=gbrp[v1];[v0][v1]blend=all_mode=screen:all_opacity=0.4,format=yuv420p[v2];[v2][2:v]overlay=0:0:shortest=1${videoFadeFilter}[v_pre_subs]`
                    audioInputIdx = 3
                    finalVideoLabel = '[v_pre_subs]'
                } else if (bannerExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background + banner overlay (1080p45)')
                    ffmpegInputs = [
                        `-stream_loop -1 -i "${videoBackgroundPath}"`,
                        `-loop 1 -i "${bannerOverlayPath}"`,
                        `-i "${audioPath}"`
                    ]
                    filterComplex = `[0:v]scale=1920:1080,setsar=1[v0];[v0][1:v]overlay=0:0:shortest=1${videoFadeFilter}[v_pre_subs]`
                    audioInputIdx = 2
                    finalVideoLabel = '[v_pre_subs]'
                } else {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] Menggunakan motion background saja (1080p45)')
                    ffmpegInputs = [
                        `-stream_loop -1 -i "${videoBackgroundPath}"`,
                        `-i "${audioPath}"`
                    ]
                    filterComplex = `[0:v]scale=1920:1080,setsar=1${videoFadeFilter}[v_pre_subs]`
                    audioInputIdx = 1
                    finalVideoLabel = '[v_pre_subs]'
                }
            } else {
                if (overlayExists) {
                    updateJob('ffmpeg', 75, '✅ [FFmpeg] partikel_api.mp4 ditemukan → menggunakan blend filter (16:9) static (1080p45)')
                    ffmpegInputs = [
                        `-loop 1 -i "${thumbnailPath}"`,
                        `-stream_loop -1 -i "${overlayPath}"`,
                        `-i "${audioPath}"`
                    ]
                    filterComplex = `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=gbrp[v0];[1:v]scale=1920:1080,setsar=1,format=gbrp[v1];[v0][v1]blend=all_mode=screen:all_opacity=0.7,format=yuv420p${videoFadeFilter}[v_pre_subs]`
                    audioInputIdx = 2
                    finalVideoLabel = '[v_pre_subs]'
                } else {
                    updateJob('ffmpeg', 75, '⚠️ [FFmpeg] partikel_api.mp4 tidak ada → rendering video statis (16:9) static (1080p45)')
                    ffmpegInputs = [
                        `-loop 1 -i "${thumbnailPath}"`,
                        `-i "${audioPath}"`
                    ]
                    filterComplex = `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2${videoFadeFilter}[v_pre_subs]`
                    audioInputIdx = 1
                    finalVideoLabel = '[v_pre_subs]'
                }
            }

            if (subsButtonPath) {
                const D = getMediaDuration(subsButtonPath)
                const durationForOverlays = totalDuration || 120
                const times = []

                if (durationForOverlays > 20) {
                    const T_first = durationForOverlays * 0.35
                    const T_second = Math.max(durationForOverlays - D - 5, 0)
                    times.push(T_first, T_second)
                } else {
                    times.push(Math.max(durationForOverlays - D - 2, 0))
                }

                const subsButtonStartIdx = ffmpegInputs.length
                for (let k = 0; k < times.length; k++) {
                    ffmpegInputs.push(`-i "${subsButtonPath}"`)
                }

                let lastVideoOut = finalVideoLabel
                for (let idx = 0; idx < times.length; idx++) {
                    const t = times[idx]
                    const webmInputIdx = subsButtonStartIdx + idx
                    const outLabel = `[v_subs_chain_${idx}]`

                    filterComplex += `; [${webmInputIdx}:v]setpts=PTS-STARTPTS+${t.toFixed(2)}/TB[subs_delayed_${idx}]; ` +
                                     `${lastVideoOut}[subs_delayed_${idx}]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,${t.toFixed(2)},${(t + D).toFixed(2)})':eof_action=pass${outLabel}`
                    lastVideoOut = outLabel
                }
                finalVideoLabel = lastVideoOut
            }

            const inputsStr = ffmpegInputs.join(' ')
            const ffmpegCmd = `ffmpeg -y ${inputsStr} -filter_complex "${filterComplex}" -map "${finalVideoLabel}" -map ${audioInputIdx}:a ${audioFadeFilter} -c:v libx264 -r 45 -threads 2 -preset ultrafast -c:a aac -shortest "${outputPath}"`

            updateJob('ffmpeg', 76, `🔧 [FFmpeg] CMD: ${ffmpegCmd.slice(0, 200)}...`)

            await new Promise((resolve, reject) => {
                const child = exec(ffmpegCmd)
                let lastTime = ''
                const startTime = Date.now()
                let ffmpegSpinnerCount = 0
                const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

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
                                    const spinner = spinners[ffmpegSpinnerCount % spinners.length]
                                    ffmpegSpinnerCount++

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
                                        const bar = getProgressBar(roundedPct)

                                        updateJob('ffmpeg', currentProgress, `🎬 [FFmpeg] ${spinner} Rendering... ${bar} ${roundedPct}% | Durasi: ${timeStr} / ${Math.floor(totalDuration)}s | ETA: ${etaStr}`)
                                    } else {
                                        updateJob('ffmpeg', 80, `🎬 [FFmpeg] ${spinner} Encoding... Progress: ${timeStr}`)
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
                description: youtubeDesc,
                tags: youtubeTags,
                privacyStatus: youtubePrivacy,
                onProgress: (p) => {
                    const bar = getProgressBar(p)
                    updateJob('youtube_upload', 90 + Math.floor(p * 0.05), `📡 [YouTube] Upload progress: ${bar} ${p}%`)
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

/**
 * Starts the Playlist Batch Processing Video Generation pipeline.
 */
export async function startPlaylistPipeline({
    songs,
    outputTitle,
    transitionStyle = 'dissolve',
    source = 'web',
    chatId = null
}) {
    const jobId = `playlist-job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

    const job = {
        id: jobId,
        prompt: `Playlist: ${outputTitle}`,
        title: outputTitle || 'Untitled Playlist',
        status: 'running',
        stage: 'idle',
        progress: 0,
        logs: [],
        youtubeUrl: null,
        source,
        chatId,
        model: 'playlist',
        timestamp: Date.now()
    }

    activeJobs.set(jobId, job)

    function updateJob(stage, progress, logMsg) {
        job.stage = stage
        job.progress = progress
        if (logMsg) {
            const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const fullLog = `[${timestamp}] ${logMsg}`

            if (job.logs.length > 0) {
                const lastLog = job.logs[job.logs.length - 1]
                const isFfmpegProgress = logMsg.includes('[FFmpeg]') &&
                    (logMsg.includes('Rendering') || logMsg.includes('Encoding')) &&
                    lastLog.includes('[FFmpeg]') &&
                    (lastLog.includes('Rendering') || lastLog.includes('Encoding'))
                const isYoutubeProgress = logMsg.includes('[YouTube] Upload progress') && lastLog.includes('[YouTube] Upload progress')

                if (isFfmpegProgress || isYoutubeProgress) {
                    job.logs[job.logs.length - 1] = fullLog
                    eventBus.emitEvent('suno:status', job)
                    return
                }
            }

            job.logs.push(fullLog)
            logger.info(`[Playlist/Pipeline/${jobId}] ${logMsg}`)
        }
        eventBus.emitEvent('suno:status', job)
    }

    ; (async () => {
        const tempDir = path.resolve(`./storage/media/tmp/bikinlagu/${jobId}`)
        fs.mkdirSync(tempDir, { recursive: true })
        const clipPaths = []
        const clipDurations = []
        const songFinalTitles = []
        const driveUrls = []

        try {
            updateJob('playlist_init', 2, `━━━ [PLAYLIST PIPELINE START] Job ID: ${jobId} ━━━`)
            updateJob('playlist_init', 4, `📝 Playlist Title: "${outputTitle}"`)
            updateJob('playlist_init', 6, `🎵 Total Songs: ${songs.length}`)

            // Backend validation
            for (let idx = 0; idx < songs.length; idx++) {
                const song = songs[idx]
                if (!song.title?.trim() && !song.artworkPrompt?.trim()) {
                    throw new Error(`Validation Error: Lagu #${idx + 1} harus memiliki judul atau prompt gambar!`)
                }
            }

            for (let i = 0; i < songs.length; i++) {
                const song = songs[i]
                const songNum = i + 1
                updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `━━━━━━━━ Lagu ${songNum}/${songs.length}: "${song.title || 'Untitled'}" ━━━━━━━━`)

                let songTitle = song.title ? song.title.trim() : ''
                let songPrompt = song.artworkPrompt ? song.artworkPrompt.trim() : ''

                // 1. Generate title from prompt if blank
                if (!songTitle && songPrompt) {
                    updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `🤖 [Gemini] Judul lagu kosong, membuat judul berdasarkan prompt vibe...`)
                    try {
                        const aiRes = await aiService.chat(null, `You are creating the official title for a song.
                            Based on this artwork and song concept:
                            "${songPrompt}"
                            Generate a title that:
                            - is 2–4 words only
                            - is memorable, catchy, and emotionally resonant
                            - directly reflects the song's core theme, hook, or most relatable lyrical idea
                            - sounds natural as a real song title, not like a generic fantasy phrase
                            - avoids clichés unless they perfectly fit the concept
                            - matches the emotional tone and genre implied by the prompt

                            Return ONLY the title. No quotes, punctuation, numbering, or explanation.`)
                        songTitle = aiRes.text.trim().replace(/^["']|["']$/g, '')
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `✅ [Gemini] Judul digenerate: "${songTitle}"`)
                    } catch (err) {
                        songTitle = `Song #${songNum}`
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `⚠️ [Gemini] Gagal generate judul, fallback ke: "${songTitle}"`)
                    }
                }

                // 2. Generate prompt from title if blank
                if (!songPrompt && songTitle && (song.artworkMode === 'system' || song.artworkMode === 'generate')) {
                    updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `🤖 [Gemini] Prompt gambar kosong, membuat prompt visual dari judul "${songTitle}"...`)
                    try {
                        const aiRes = await aiService.chat(null, `You are creating artwork for a premium epic cinematic music channel.
                            Generate a concise image prompt for a YouTube thumbnail based on the song title:
                            "${songTitle}"
                            Translate the title into a powerful cinematic scene with one iconic subject, dramatic lighting, atmospheric depth, epic composition, realistic textures, volumetric fog, high contrast, and rich color grading. Make it emotionally memorable and instantly clickable. No text, logos, watermarks, UI, or borders.
                            Maximum 300 characters. Return ONLY the prompt.`)
                        songPrompt = aiRes.text.trim()
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `✅ [Gemini] Prompt digenerate: "${songPrompt}"`)
                    } catch (err) {
                        songPrompt = `a beautiful abstract visual representing the song ${songTitle}, 4k resolution, high quality`
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `⚠️ [Gemini] Gagal generate prompt, fallback ke default.`)
                    }
                }

                songFinalTitles.push(songTitle)

                // Get audio file and probe duration
                const srcAudioPath = song.audioPath
                if (!srcAudioPath || !fs.existsSync(srcAudioPath)) {
                    throw new Error(`Audio file not found for Song #${songNum}: ${srcAudioPath}`)
                }

                const destAudioPath = path.join(tempDir, `audio_${i}.mp3`)
                fs.copyFileSync(srcAudioPath, destAudioPath)

                let songDuration = 0
                try {
                    let output = ''
                    try {
                        output = execSync(`ffmpeg -i "${destAudioPath}"`, { stdio: 'pipe' }).toString()
                    } catch (err) {
                        output = (err.stdout || '').toString() + (err.stderr || '').toString()
                    }
                    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
                    if (match) {
                        const hours = parseInt(match[1], 10)
                        const minutes = parseInt(match[2], 10)
                        const seconds = parseFloat(match[3])
                        songDuration = hours * 3600 + minutes * 60 + seconds
                    }
                } catch (probeErr) {
                    logger.error(`[Playlist/Duration] Error: ${probeErr.message}`)
                }

                if (songDuration <= 0) {
                    throw new Error(`Invalid duration probed for Song #${songNum}`)
                }
                clipDurations.push(songDuration)
                updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `📊 Lagu #${songNum} - Durasi: ${Math.floor(songDuration)} detik`)

                // Generate/Process Artwork
                let artworkBuffer = null
                let isVideoArtwork = false
                let artworkLocalPath = ''

                if (song.artworkMode === 'upload') {
                    const srcArtworkPath = song.artworkPath
                    if (!srcArtworkPath || !fs.existsSync(srcArtworkPath)) {
                        throw new Error(`Uploaded artwork file not found for Song #${songNum}: ${srcArtworkPath}`)
                    }

                    const isVideo = srcArtworkPath.endsWith('.mp4') || srcArtworkPath.endsWith('.mkv') || srcArtworkPath.endsWith('.mov')
                    if (isVideo) {
                        isVideoArtwork = true
                        artworkLocalPath = path.join(tempDir, `artwork_${i}.mp4`)
                        fs.copyFileSync(srcArtworkPath, artworkLocalPath)
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `📁 Menggunakan video artwork hasil upload user`)
                    } else {
                        artworkBuffer = fs.readFileSync(srcArtworkPath)
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `📁 Menggunakan gambar artwork hasil upload user`)
                    }
                } else {
                    updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `🖼️ [ImgGen] Membuat gambar cover via FLUX/Pollinations...`)
                    try {
                        const imgResult = await aiService.generateImage(songPrompt, 1920, 1080)
                        artworkBuffer = imgResult.buffer
                        updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `✅ [ImgGen] Gambar berhasil digenerate.`)
                    } catch (imgErr) {
                        throw new Error(`Failed to generate artwork for Song #${songNum}: ${imgErr.message}`)
                    }

                    if (song.artworkMode === 'generate') {
                        let approved = false
                        const songThumbnailPath = path.join(tempDir, `plain_thumb_${i}.png`)
                        fs.writeFileSync(songThumbnailPath, artworkBuffer)

                        while (!approved) {
                            const thumbBase64 = fs.readFileSync(songThumbnailPath).toString('base64')
                            updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `⏳ [ImgGen] Menunggu konfirmasi thumbnail untuk Lagu #${songNum}...`)

                            eventBus.emitEvent('suno:thumbnail_ready', {
                                jobId,
                                imageBase64: thumbBase64,
                                title: `${songTitle} (Lagu ${songNum}/${songs.length})`,
                                songIndex: i
                            })

                            const decision = await new Promise((resolve) => {
                                const AUTO_APPROVE_MS = 10 * 60 * 1000
                                const timer = setTimeout(() => {
                                    thumbnailConfirmResolvers.delete(jobId)
                                    logger.warn(`[ImgGen/Confirm] Playlist timeout for song ${songNum}. Auto-approving thumbnail.`)
                                    resolve({ approved: true, newPrompt: null })
                                }, AUTO_APPROVE_MS)
                                thumbnailConfirmResolvers.set(jobId, { resolve, timer })
                            })

                            if (decision.approved) {
                                approved = true
                                artworkBuffer = fs.readFileSync(songThumbnailPath)
                                updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `✅ Thumbnail dikonfirmasi!`)
                            } else {
                                const regenPrompt = (decision.newPrompt && decision.newPrompt.trim()) || songPrompt
                                updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `🔄 Regenerasi thumbnail dengan prompt baru...`)
                                try {
                                    const regenResult = await aiService.generateImage(regenPrompt, 1920, 1080)
                                    artworkBuffer = regenResult.buffer
                                    fs.writeFileSync(songThumbnailPath, artworkBuffer)
                                    songPrompt = regenPrompt
                                } catch (regenErr) {
                                    updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `⚠️ Gagal regenerasi (${regenErr.message}), menggunakan thumbnail sebelumnya.`)
                                    approved = true
                                }
                            }
                        }
                    }
                }

                if (!isVideoArtwork && artworkBuffer) {
                    updateJob('playlist_art', Math.floor(6 + (i / songs.length) * 34), `🎨 Menambahkan banner overlay judul "${songTitle}"...`)
                    try {
                        artworkBuffer = await addBannerToImage(artworkBuffer, songTitle)
                    } catch (sharpErr) {
                        logger.warn(`[Sharp/Overlay] Gagal overlay: ${sharpErr.message}`)
                    }
                    artworkLocalPath = path.join(tempDir, `artwork_${i}.png`)
                    fs.writeFileSync(artworkLocalPath, artworkBuffer)
                }

                // Render clip
                updateJob('playlist_render', Math.floor(40 + (i / songs.length) * 20), `🎬 [FFmpeg] Mulai render Clip #${songNum}...`)
                const outputClipPath = path.join(tempDir, `clip_${i}.mp4`)
                clipPaths.push(outputClipPath)

                let ffmpegCmd = ''
                const overlayPath = path.resolve('./storage/assets/partikel_api.mp4')
                const overlayExists = fs.existsSync(overlayPath)

                if (isVideoArtwork) {
                    updateJob('playlist_render', Math.floor(40 + (i / songs.length) * 20), `🔄 [FFmpeg] Membuat seamless reverse loop dari video artwork...`)
                    const pingpongPath = path.join(tempDir, `pingpong_${i}.mp4`)
                    try {
                        execSync(`ffmpeg -y -i "${artworkLocalPath}" -filter_complex "[0:v]reverse[r];[0:v][r]concat=n=2:v=1[outv]" -map "[outv]" -c:v libx264 -preset ultrafast "${pingpongPath}"`, { stdio: 'ignore' })
                    } catch (err) {
                        logger.error(`[FFmpeg/ReverseLoop] Error: ${err.message}`)
                        fs.copyFileSync(artworkLocalPath, pingpongPath)
                    }

                    const currentVideoInput = fs.existsSync(pingpongPath) ? pingpongPath : artworkLocalPath
                    const bannerOverlayPath = path.join(tempDir, `banner_overlay_${i}.png`)
                    const bannerOverlayBuffer = await createBannerOverlay(1920, 1080, songTitle)
                    if (bannerOverlayBuffer) {
                        fs.writeFileSync(bannerOverlayPath, bannerOverlayBuffer)
                    }
                    const bannerExists = fs.existsSync(bannerOverlayPath)

                    if (overlayExists && bannerExists) {
                        ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${currentVideoInput}" -stream_loop -1 -i "${overlayPath}" -loop 1 -i "${bannerOverlayPath}" -i "${destAudioPath}" -filter_complex "[0:v]crop=w=iw*0.94:h=ih*0.94:x='(iw-out_w)/2+sin(t*0.45)*28':y='(ih-out_h)/2+cos(t*0.3)*18',scale=1920:1080,setsar=1,format=gbrp[v0];[1:v]scale=1920:1080,setsar=1,format=gbrp[v1];[v0][v1]blend=all_mode=screen:all_opacity=0.4,format=yuv420p[v2];[v2][2:v]overlay=0:0" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac -ar 44100 -ac 2 -t ${songDuration.toFixed(2)} "${outputClipPath}"`
                    } else if (bannerExists) {
                        ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${currentVideoInput}" -loop 1 -i "${bannerOverlayPath}" -i "${destAudioPath}" -filter_complex "[0:v]crop=w=iw*0.94:h=ih*0.94:x='(iw-out_w)/2+sin(t*0.45)*28':y='(ih-out_h)/2+cos(t*0.3)*18',scale=1920:1080,setsar=1[v0];[v0][1:v]overlay=0:0" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac -ar 44100 -ac 2 -t ${songDuration.toFixed(2)} "${outputClipPath}"`
                    } else {
                        ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${currentVideoInput}" -i "${destAudioPath}" -filter_complex "[0:v]crop=w=iw*0.94:h=ih*0.94:x='(iw-out_w)/2+sin(t*0.45)*28':y='(ih-out_h)/2+cos(t*0.3)*18',scale=1920:1080,setsar=1" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac -ar 44100 -ac 2 -t ${songDuration.toFixed(2)} "${outputClipPath}"`
                    }
                } else {
                    if (overlayExists) {
                        ffmpegCmd = `ffmpeg -y -loop 1 -i "${artworkLocalPath}" -stream_loop -1 -i "${overlayPath}" -i "${destAudioPath}" -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,crop=w=iw*0.94:h=ih*0.94:x='(iw-out_w)/2+sin(t*0.45)*28':y='(ih-out_h)/2+cos(t*0.3)*18',scale=1920:1080,format=gbrp[v0];[1:v]scale=1920:1080,setsar=1,format=gbrp[v1];[v0][v1]blend=all_mode=screen:all_opacity=0.4,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac -ar 44100 -ac 2 -t ${songDuration.toFixed(2)} "${outputClipPath}"`
                    } else {
                        ffmpegCmd = `ffmpeg -y -loop 1 -i "${artworkLocalPath}" -i "${destAudioPath}" -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,crop=w=iw*0.94:h=ih*0.94:x='(iw-out_w)/2+sin(t*0.45)*28':y='(ih-out_h)/2+cos(t*0.3)*18',scale=1920:1080" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac -ar 44100 -ac 2 -t ${songDuration.toFixed(2)} "${outputClipPath}"`
                    }
                }

                await new Promise((resolve, reject) => {
                    const child = exec(ffmpegCmd)
                    child.on('close', (code) => {
                        if (code === 0) resolve()
                        else reject(new Error(`Clip #${songNum} render failed with exit code ${code}`))
                    })
                })

                const clipSizeMB = (fs.statSync(outputClipPath).size / (1024 * 1024)).toFixed(2)
                updateJob('playlist_render', Math.floor(40 + (songNum / songs.length) * 20), `✅ Clip #${songNum} dirender! (${clipSizeMB} MB)`)

                // Google Drive Upload
                // Naming convention: [JobId] #Job[N] - [SongTitle].mp3
                updateJob('playlist_render', Math.floor(40 + (songNum / songs.length) * 20), `📤 [Google Drive] Mengupload MP3 ke Drive...`)
                const cleanDriveTitle = songTitle.replace(/[\\/:*?"<>|]/g, '_').trim() || `song_${i}`
                const driveFileName = `${jobId} #Job${songNum} - ${cleanDriveTitle}.mp3`
                try {
                    const driveUrl = await uploadToDrive(destAudioPath, driveFileName, 'audio/mpeg')
                    driveUrls.push(driveUrl)
                    updateJob('playlist_render', Math.floor(40 + (songNum / songs.length) * 20), `✅ [Google Drive] Sukses! Link: ${driveUrl}`)
                } catch (driveErr) {
                    logger.error(`[Playlist/DriveUpload] Gagal: ${driveErr.message}`)
                    updateJob('playlist_render', Math.floor(40 + (songNum / songs.length) * 20), `⚠️ [Google Drive] Gagal upload: ${driveErr.message}`)
                }
            }

            // Merge clips
            updateJob('playlist_merge', 70, `━━━ [PLAYLIST MERGE] Menggabungkan ${clipPaths.length} klip video ━━━`)
            const finalVideoPath = path.join(tempDir, 'final_playlist.mp4')

            const subsButtonPath = getSubsButtonPath()
            const transitionDuration = 1.5

            if (clipPaths.length === 1) {
                if (subsButtonPath) {
                    // Apply overlay directly to the single clip
                    const D = getMediaDuration(subsButtonPath)
                    const totalDuration = clipDurations[0]
                    const times = []

                    if (totalDuration > 20) {
                        const T_first = totalDuration * 0.35
                        const T_second = Math.max(totalDuration - D - 5, 0)
                        times.push(T_first, T_second)
                    } else {
                        times.push(Math.max(totalDuration - D - 2, 0))
                    }

                    let inputsCmd = `-i "${clipPaths[0]}" `
                    for (let k = 0; k < times.length; k++) {
                        inputsCmd += `-i "${subsButtonPath}" `
                    }

                    let filterComplex = ''
                    let lastVideoOut = '[0:v]'
                    for (let idx = 0; idx < times.length; idx++) {
                        const t = times[idx]
                        const webmInputIdx = 1 + idx
                        const outLabel = `[v_playlist_subs_${idx}]`

                        filterComplex += (filterComplex ? '; ' : '') +
                                         `[${webmInputIdx}:v]setpts=PTS-STARTPTS+${t.toFixed(2)}/TB[subs_delayed_${idx}]; ` +
                                         `${lastVideoOut}[subs_delayed_${idx}]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,${t.toFixed(2)},${(t + D).toFixed(2)})':eof_action=pass${outLabel}`
                        lastVideoOut = outLabel
                    }

                    const singleOverlayCmd = `ffmpeg -y ${inputsCmd} -filter_complex "${filterComplex}" -map "${lastVideoOut}" -map 0:a -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a copy "${finalVideoPath}"`
                    logger.info(`[Playlist/SingleOverlay] CMD: ${singleOverlayCmd}`)

                    await new Promise((resolve, reject) => {
                        const child = exec(singleOverlayCmd)
                        child.on('close', (code) => {
                            if (code === 0) resolve()
                            else reject(new Error(`Overlay failed with exit code ${code}`))
                        })
                    })
                    updateJob('playlist_merge', 88, `✅ Klip playlist berhasil dirender dengan overlay!`)
                } else {
                    fs.copyFileSync(clipPaths[0], finalVideoPath)
                    updateJob('playlist_merge', 80, `✅ Hanya 1 klip, disalin ke output.`)
                }
            } else {
                let filterComplex = ''
                let lastVideoLabel = '[0:v]'
                let lastAudioLabel = '[0:a]'
                let cumulativeTime = clipDurations[0]

                let inputsCmd = ''
                for (let idx = 0; idx < clipPaths.length; idx++) {
                    inputsCmd += `-i "${clipPaths[idx]}" `
                }

                for (let idx = 1; idx < clipPaths.length; idx++) {
                    const offset = cumulativeTime - transitionDuration
                    const nextVideoLabel = `[v_transition_${idx}]`
                    const nextAudioLabel = `[a_transition_${idx}]`

                    filterComplex += `${lastVideoLabel}[${idx}:v]xfade=transition=dissolve:duration=${transitionDuration}:offset=${offset.toFixed(2)}${nextVideoLabel}; `
                    filterComplex += `${lastAudioLabel}[${idx}:a]acrossfade=d=${transitionDuration}:c1=tri:c2=tri${nextAudioLabel}; `

                    lastVideoLabel = nextVideoLabel
                    lastAudioLabel = nextAudioLabel
                    cumulativeTime += clipDurations[idx] - transitionDuration
                }

                // If subsButtonPath exists, overlay it in the same pass!
                if (subsButtonPath) {
                    const D = getMediaDuration(subsButtonPath)
                    const times = []
                    const subsButtonStartIdx = clipPaths.length

                    const count = Math.max(3, Math.floor(cumulativeTime / 180))
                    const interval = cumulativeTime / (count + 1)

                    for (let idx = 1; idx <= count; idx++) {
                        const baseTime = interval * idx
                        const jitter = (Math.random() - 0.5) * 30
                        let t = baseTime + jitter
                        t = Math.max(15, Math.min(t, cumulativeTime - D - 10))
                        times.push(t)
                    }

                    times.sort((a, b) => a - b)

                    for (let k = 0; k < times.length; k++) {
                        inputsCmd += `-i "${subsButtonPath}" `
                    }

                    filterComplex = filterComplex.trim()
                    if (filterComplex && !filterComplex.endsWith(';')) {
                        filterComplex += ';'
                    }

                    let lastVideoOut = lastVideoLabel
                    for (let idx = 0; idx < times.length; idx++) {
                        const t = times[idx]
                        const webmInputIdx = subsButtonStartIdx + idx
                        const outLabel = `[v_playlist_subs_${idx}]`

                        filterComplex += ` [${webmInputIdx}:v]setpts=PTS-STARTPTS+${t.toFixed(2)}/TB[subs_delayed_${idx}]; ` +
                                         `${lastVideoOut}[subs_delayed_${idx}]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,${t.toFixed(2)},${(t + D).toFixed(2)})':eof_action=pass${outLabel};`
                        lastVideoOut = outLabel
                    }
                    filterComplex = filterComplex.trim().replace(/;$/, '')
                    lastVideoLabel = lastVideoOut
                }

                const mergeCmd = `ffmpeg -y ${inputsCmd} -filter_complex "${filterComplex.trim()}" -map "${lastVideoLabel}" -map "${lastAudioLabel}" -c:v libx264 -pix_fmt yuv420p -r 30 -preset ultrafast -c:a aac "${finalVideoPath}"`
                logger.info(`[Playlist/Merge] CMD: ${mergeCmd}`)

                await new Promise((resolve, reject) => {
                    const child = exec(mergeCmd)
                    child.on('close', (code) => {
                        if (code === 0) resolve()
                        else reject(new Error(`Merging failed with exit code ${code}`))
                    })
                })
                updateJob('playlist_merge', 88, `✅ Penggabungan video playlist berhasil!`)
            }

            // Write description with timestamps
            updateJob('playlist_upload', 90, `🧠 Menyusun metadata YouTube dan timestamps...`)

            let descriptionTimestamps = ''
            let currentPlaylistTime = 0

            function formatTimestamp(secs) {
                const h = Math.floor(secs / 3600)
                const m = Math.floor((secs % 3600) / 60)
                const s = Math.floor(secs % 60)
                if (h > 0) {
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                } else {
                    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                }
            }

            for (let idx = 0; idx < songs.length; idx++) {
                const songTimeStr = formatTimestamp(currentPlaylistTime)
                descriptionTimestamps += `${songTimeStr} - ${songFinalTitles[idx]}\n`

                if (idx < songs.length - 1) {
                    currentPlaylistTime += clipDurations[idx] - transitionDuration
                }
            }

            const aestheticTags = [
                'lofichill', 'lofihiphop', 'chillbeats', 'studybeats', 'instrumentalmusic',
                'relaxingbeats', 'lofipiano', 'studyplaylist', 'ambientlofi', 'chilllofi',
                'focusbeats', 'bgm', 'gaminglofi', 'backgroundmusic', 'relaxingmix',
                'instrumental', 'chillmix', 'ambient', 'lofiaudio'
            ]

            let youtubeDesc = `Official Playlist: "${outputTitle}"\n\n` +
                `Tracklist Timestamps:\n` +
                `${descriptionTimestamps}` +
                `\n#lofi #chill #instrumental #playlist #lofiproducer #relaxingmusic\n`

            const youtubeTags = [...new Set([
                'lofi', 'chill', 'music', 'playlist', 'instrumental',
                ...aestheticTags
            ])]

            updateJob('playlist_upload', 92, `📤 [YouTube] Mengupload video playlist ke YouTube...`)
            const youtubePrivacy = process.env.YOUTUBE_PRIVACY || 'private'

            const youtubeUrl = await uploadVideo({
                videoPath: finalVideoPath,
                title: outputTitle,
                description: youtubeDesc,
                tags: youtubeTags,
                privacyStatus: youtubePrivacy,
                onProgress: (p) => {
                    const bar = getProgressBar(p)
                    updateJob('playlist_upload', 90 + Math.floor(p * 0.09), `📡 [YouTube] Upload progress: ${bar} ${p}%`)
                }
            })

            job.status = 'completed'
            job.youtubeUrl = youtubeUrl
            job.driveUrl = driveUrls.length > 0 ? driveUrls[0] : null
            updateJob('done', 100, `━━━ [PLAYLIST PIPELINE COMPLETE] ✅ ━━━`)
            updateJob('done', 100, `🎉 Playlist berhasil dipublikasikan ke YouTube!`)
            updateJob('done', 100, `🔗 YouTube: ${youtubeUrl}`)

            if (chatId) {
                const sock = getSocket()
                if (sock) {
                    let textMsg = `🎵 *Playlist Video Kamu Selesai Dibuat!* 🎵\n\n*Judul:* ${outputTitle}\n*Link YouTube:* ${youtubeUrl}\n\n*Tracklist:*\n${descriptionTimestamps}`
                    await sock.sendMessage(chatId, { text: textMsg })
                }
            }

        } catch (error) {
            job.status = 'failed'
            updateJob('failed', 100, `━━━ [PLAYLIST PIPELINE FAILED] ❌ ━━━`)
            updateJob('failed', 100, `💥 Error: ${error.message}`)
            if (error.stack) {
                const stackLines = error.stack.split('\n').slice(0, 4).join(' | ')
                updateJob('failed', 100, `🔍 Stack: ${stackLines}`)
            }
        } finally {
            setTimeout(() => {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true })
                        logger.info(`[Playlist/Pipeline/${jobId}] Temporary files cleaned up.`)
                    }
                } catch (e) {
                    logger.warn(`[Playlist/Pipeline/${jobId}] Failed to cleanup temp directory: ${e.message}`)
                }
            }, 8000)
        }
    })()

    return jobId
}

