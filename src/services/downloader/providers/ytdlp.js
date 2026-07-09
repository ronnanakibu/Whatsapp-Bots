// src/services/downloader/providers/ytdlp.js
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { getYtdlpPath } from '../../ytdlp.js'
import { logger } from '../../../utils/logger.js'

import { fetchBuffer, fetchJson, sanitizeFilename } from '../utils.js'

const TEMP_DIR = path.resolve('./storage/media/temp')

export async function downloadYtdlp(url, options = {}) {
    const format = options.format || 'video' // 'audio' | 'video'
    
    // --- LOKAL YT-DLP ---
    const ytdlpPath = getYtdlpPath()

    if (!ytdlpPath) {
        throw new Error('yt-dlp binary tidak ditemukan. Harap tunggu proses download yt-dlp selesai di background.')
    }

    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true })
    }

    const sessionId = randomBytes(8).toString('hex')
    // Kita biarkan yt-dlp yang menentukan ekstensi aslinya, lalu kita cari filenya
    const outTemplate = path.join(TEMP_DIR, `${sessionId}.%(ext)s`)

    const args = [
        '--no-playlist',
        '--no-warnings',
        '--write-info-json', // Tulis metadata ke file .info.json, JANGAN pakai --dump-json karena itu mencegah download!
        '-o', outTemplate,
    ]

    // Membatasi ukuran file agar WhatsApp tidak menolak (max 50MB, kita set 100MB di yt-dlp sbg safety)
    args.push('--max-filesize', '100M')

    if (format === 'audio') {
        const quality = options.audioQuality === 'normal' ? '128K' : '320K'
        args.push(
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', quality
        )
    } else {
        // Video MP4 with target resolution limit
        const res = options.resolution || '1080'
        args.push(
            '-f', `bestvideo[height<=${res}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${res}]+bestaudio/best[height<=${res}]/best`,
            '--merge-output-format', 'mp4'
        )
    }

    args.push(url)

    logger.info(`[yt-dlp] Downloading ${format} dari ${url.slice(0, 50)}...`)

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, args)
        
        let stderr = ''

        proc.stderr.on('data', d => stderr += d.toString())

        proc.on('close', code => {
            if (code !== 0) {
                // Hapus sisa file jika ada error
                cleanupTempFiles(sessionId)
                return reject(new Error(`yt-dlp error (${code}): ${stderr.slice(0, 200)}`))
            }

            try {
                // Baca metadata dari file .info.json
                const infoJsonPath = path.join(TEMP_DIR, `${sessionId}.info.json`)
                let metadata = {}
                if (fs.existsSync(infoJsonPath)) {
                    metadata = JSON.parse(fs.readFileSync(infoJsonPath, 'utf-8'))
                }
                
                // Cari file yang berhasil di-download (jangan ambil .info.json)
                const downloadedFile = findDownloadedFile(sessionId)
                
                if (!downloadedFile) {
                    throw new Error('File tidak ditemukan di disk setelah download selesai.')
                }

                const buffer = fs.readFileSync(downloadedFile)
                cleanupTempFiles(sessionId)

                const title = metadata.title || 'Video'
                const rawExt = path.extname(downloadedFile).slice(1)
                const tempExts = ['ffmpeg', 'ytdl', 'part', 'temp', 'tmp']
                const ext = (rawExt && !tempExts.includes(rawExt))
                    ? rawExt
                    : (format === 'audio' ? 'mp3' : 'mp4')
                const mimeType = format === 'audio' ? 'audio/mp3' : 'video/mp4'
                
                let caption = format === 'video' ? `🎬 *${title}*` : `🎵 *${title}*`
                if (metadata.duration_string) caption += `\n⏱️ ${metadata.duration_string}`
                if (metadata.extractor) caption += `\n_via ${metadata.extractor}_`

                resolve({
                    buffer,
                    filename: sanitizeFilename(`${metadata.title || `ytdlp_${sessionId}`}.${ext}`),
                    caption,
                    mimeType,
                    ext,
                    platform: metadata.extractor || 'unknown',
                    type: format,
                    thumbnail: metadata.thumbnail || null
                })

            } catch (err) {
                cleanupTempFiles(sessionId)
                reject(new Error(`Gagal memproses hasil yt-dlp: ${err.message}`))
            }
        })

        proc.on('error', err => {
            cleanupTempFiles(sessionId)
            reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`))
        })

        // Safety timeout 2 menit
        setTimeout(() => {
            proc.kill()
            cleanupTempFiles(sessionId)
            reject(new Error('Download timeout (120 detik)'))
        }, 120_000)
    })
}

function findDownloadedFile(sessionId) {
    if (!fs.existsSync(TEMP_DIR)) return null
    const files = fs.readdirSync(TEMP_DIR)
    const match = files.find(f => 
        f.startsWith(sessionId) && 
        !f.endsWith('.info.json') && 
        !f.endsWith('.ytdl') && 
        !f.endsWith('.part') && 
        !f.endsWith('.ffmpeg') && 
        !f.endsWith('.temp') && 
        !f.endsWith('.tmp')
    )
    if (match) return path.join(TEMP_DIR, match)
    return null
}

function cleanupTempFiles(sessionId) {
    if (!fs.existsSync(TEMP_DIR)) return
    const files = fs.readdirSync(TEMP_DIR)
    for (const f of files) {
        if (f.startsWith(sessionId)) {
            try {
                fs.unlinkSync(path.join(TEMP_DIR, f))
            } catch (_) {}
        }
    }
}

// ─────────────────────────────────────────────
// HUGGING FACE BACKEND HANDLER
// ─────────────────────────────────────────────

async function downloadViaHF(url, format) {
    const apiUrl = process.env.HF_API_URL.replace(/\/$/, '') // hapus slash di akhir
    logger.info(`[yt-dlp HF] Requesting ${format} dari ${apiUrl}...`)
    
    try {
        // Kita nge-POST ke HF API yang mereturn FileResponse
        const res = await fetchBuffer(`${apiUrl}/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, format }),
            timeout: 120_000,
            maxSizeMB: 80
        })

        const ext = format === 'audio' ? 'mp3' : 'mp4'
        const mimeType = format === 'audio' ? 'audio/mp3' : 'video/mp4'
        
        // Coba ambil judul dari custom header
        const rawTitle = res.headers?.['x-title'] || 'Media'
        const title = decodeURIComponent(escape(rawTitle)) // fix latin-1 ke utf8 jika perlu
        
        let caption = format === 'video' ? `🎬 *${title}*` : `🎵 *${title}*`
        caption += `\n_via HF Space_`

        return {
            buffer: res.buffer,
            filename: sanitizeFilename(`${title || `hf_${Date.now()}`}.${ext}`),
            caption,
            mimeType,
            ext,
            platform: 'ytdlp-hf',
            type: format,
            thumbnail: null
        }
    } catch (err) {
        logger.warn(`[yt-dlp HF] Gagal: ${err.message}`)
        throw new Error(`Gagal download dari server HF: ${err.message}`)
    }
}
