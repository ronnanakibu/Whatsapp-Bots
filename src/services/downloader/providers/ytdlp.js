// src/services/downloader/providers/ytdlp.js
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { getYtdlpPath } from '../../ytdlp.js'
import { logger } from '../../../utils/logger.js'

const TEMP_DIR = path.resolve('./storage/media/temp')

export async function downloadYtdlp(url, options = {}) {
    const format = options.format || 'video' // 'audio' | 'video'
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

    let args = [
        '--no-playlist',
        '--no-warnings',
        '--quiet',
        '--dump-json', // Supaya kita dapat JSON metadata di stdout
        '-o', outTemplate,
    ]

    // Membatasi ukuran file agar WhatsApp tidak menolak (max 50MB, kita set 100MB di yt-dlp sbg safety)
    args.push('--max-filesize', '100M')

    if (format === 'audio') {
        args.push(
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '128K'
        )
    } else {
        // Video MP4
        args.push(
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format', 'mp4'
        )
    }

    args.push(url)

    logger.info(`[yt-dlp] Downloading ${format} dari ${url.slice(0, 50)}...`)

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, args)
        
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', d => stdout += d.toString())
        proc.stderr.on('data', d => stderr += d.toString())

        proc.on('close', code => {
            if (code !== 0) {
                // Hapus sisa file jika ada error
                cleanupTempFiles(sessionId)
                return reject(new Error(`yt-dlp error (${code}): ${stderr.slice(0, 200)}`))
            }

            try {
                // Parse metadata dari output dump-json
                const jsonStrs = stdout.trim().split('\n')
                // Ambil baris terakhir yang berupa JSON
                const metadata = JSON.parse(jsonStrs[jsonStrs.length - 1])
                
                // Cari file yang berhasil di-download
                const downloadedFile = findDownloadedFile(sessionId)
                
                if (!downloadedFile) {
                    throw new Error('File tidak ditemukan di disk setelah download selesai.')
                }

                const buffer = fs.readFileSync(downloadedFile)
                cleanupTempFiles(sessionId)

                const title = metadata.title || 'Video'
                const ext = path.extname(downloadedFile).slice(1) || (format === 'audio' ? 'mp3' : 'mp4')
                const mimeType = format === 'audio' ? 'audio/mpeg' : 'video/mp4'
                
                let caption = format === 'video' ? `🎬 *${title}*` : `🎵 *${title}*`
                if (metadata.duration_string) caption += `\n⏱️ ${metadata.duration_string}`
                if (metadata.extractor) caption += `\n_via ${metadata.extractor}_`

                resolve({
                    buffer,
                    filename: `ytdlp_${sessionId}.${ext}`,
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
    const match = files.find(f => f.startsWith(sessionId))
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
