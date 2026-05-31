// src/services/ytdlp.js
// Auto-download & manage yt-dlp binary
// Dipanggil sekali waktu bot start

import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { botLogger } from '../utils/logger.js'

const BIN_DIR = path.resolve('./storage/bin')
const BIN_PATH = path.resolve('./storage/bin/yt-dlp')  // tanpa _linux suffix
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'

// ─────────────────────────────────────────────
// CEK BINARY VALID
// ─────────────────────────────────────────────

export function getYtdlpPath() {
    // 1. Dari env
    if (process.env.YTDLP_PATH) {
        if (fs.existsSync(process.env.YTDLP_PATH)) return process.env.YTDLP_PATH
        botLogger.warn('ytdlp', `YTDLP_PATH set tapi tidak ditemukan: ${process.env.YTDLP_PATH}`)
    }

    // 2. Local binary (tanpa suffix)
    if (fs.existsSync(BIN_PATH) && isValidBinary(BIN_PATH)) return BIN_PATH

    // 3. Local binary dengan suffix lama
    const legacyPath = path.resolve('./storage/bin/yt-dlp_linux')
    if (fs.existsSync(legacyPath) && isValidBinary(legacyPath)) return legacyPath

    // 4. System PATH
    try {
        execSync('yt-dlp --version', { stdio: 'ignore', timeout: 3000 })
        return 'yt-dlp'
    } catch (_) { }

    return null  // tidak ada — perlu download
}

function isValidBinary(filePath) {
    try {
        const stat = fs.statSync(filePath)
        if (stat.size < 1_000_000) {  // min 1MB — python wrapper ga valid
            botLogger.warn('ytdlp', `Binary terlalu kecil (${(stat.size / 1024).toFixed(0)}KB): ${filePath}`)
            return false
        }
        return true
    } catch (_) {
        return false
    }
}

// ─────────────────────────────────────────────
// AUTO DOWNLOAD
// ─────────────────────────────────────────────

export async function ensureYtdlp() {
    const existing = getYtdlpPath()
    if (existing) {
        botLogger.info('ytdlp', `yt-dlp found: ${existing}`)
        return existing
    }

    botLogger.warn('ytdlp', 'yt-dlp tidak ditemukan, downloading...')

    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true })

    await downloadFile(YTDLP_URL, BIN_PATH)

    // Chmod +x
    fs.chmodSync(BIN_PATH, 0o755)

    // Verifikasi
    try {
        const version = execSync(`${BIN_PATH} --version`, { timeout: 10_000 }).toString().trim()
        botLogger.info('ytdlp', `yt-dlp downloaded & ready: v${version}`)
    } catch (e) {
        fs.unlinkSync(BIN_PATH)
        throw new Error(`yt-dlp download berhasil tapi gagal dijalankan: ${e.message}`)
    }

    return BIN_PATH
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest)
        let downloaded = 0

        function doRequest(reqUrl) {
            https.get(reqUrl, (res) => {
                // Handle redirect
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close()
                    return doRequest(res.headers.location)
                }

                if (res.statusCode !== 200) {
                    file.close()
                    fs.unlinkSync(dest)
                    return reject(new Error(`Download gagal: HTTP ${res.statusCode}`))
                }

                const total = parseInt(res.headers['content-length'] ?? '0')

                res.on('data', chunk => {
                    downloaded += chunk.length
                    if (total > 0) {
                        const pct = Math.round(downloaded / total * 100)
                        if (pct % 20 === 0) botLogger.info('ytdlp', `Downloading yt-dlp... ${pct}%`)
                    }
                })

                res.pipe(file)
                file.on('finish', () => { file.close(); resolve() })
                file.on('error', e => { fs.unlinkSync(dest); reject(e) })

            }).on('error', e => {
                fs.unlinkSync(dest)
                reject(e)
            })
        }

        doRequest(url)
    })
}

// ─────────────────────────────────────────────
// EXTRACT AUDIO URL
// ─────────────────────────────────────────────

export function ytdlpGetAudioUrl(youtubeUrl) {
    return new Promise((resolve, reject) => {
        const ytdlpPath = getYtdlpPath()

        if (!ytdlpPath) {
            return reject(new Error(
                'yt-dlp tidak ditemukan.\n' +
                'Jalankan bot sekali lagi — yt-dlp akan auto-download.\n' +
                'Atau download manual: https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux\n' +
                `Simpan ke: ${BIN_PATH}`
            ))
        }

        const args = [
            '--no-playlist',
            '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
            '--get-url',
            '--no-warnings',
            '--quiet',
            youtubeUrl
        ]

        botLogger.info('ytdlp', `Extracting URL: ${youtubeUrl}`)
        const proc = spawn(ytdlpPath, args)

        let output = ''
        let errOutput = ''

        proc.stdout.on('data', d => output += d.toString())
        proc.stderr.on('data', d => errOutput += d.toString())

        proc.on('close', code => {
            const url = output.trim().split('\n')[0].trim()
            if (code !== 0 || !url?.startsWith('http')) {
                return reject(new Error(`yt-dlp extract gagal: ${errOutput.slice(0, 200)}`))
            }
            botLogger.info('ytdlp', `CDN URL extracted (${url.slice(0, 50)}...)`)
            resolve(url)
        })

        proc.on('error', e => {
            if (e.code === 'ENOENT') {
                reject(new Error(`yt-dlp binary tidak bisa dijalankan: ${ytdlpPath}\nCoba chmod +x atau download ulang.`))
            } else {
                reject(new Error(`yt-dlp error: ${e.message}`))
            }
        })

        setTimeout(() => {
            proc.kill()
            reject(new Error('yt-dlp timeout (20s)'))
        }, 20_000)
    })
}