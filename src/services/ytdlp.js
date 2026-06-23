// src/services/ytdlp.js
// Auto-download & manage yt-dlp binary
// Dipanggil sekali waktu bot start

import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { botLogger } from '../utils/logger.js'

const isWindows = process.platform === 'win32'
const BIN_DIR = path.resolve('./storage/bin')
const BIN_PATH = path.resolve(`./storage/bin/yt-dlp${isWindows ? '.exe' : ''}`)
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${isWindows ? '.exe' : ''}`

// ─────────────────────────────────────────────
// CEK BINARY VALID
// ─────────────────────────────────────────────

export function getYtdlpPath(preferLocal = false) {
    // 1. Dari env
    if (process.env.YTDLP_PATH) {
        if (fs.existsSync(process.env.YTDLP_PATH)) {
            ensureExecutable(process.env.YTDLP_PATH)
            return process.env.YTDLP_PATH
        }
        botLogger.warn('ytdlp', `YTDLP_PATH set tapi tidak ditemukan: ${process.env.YTDLP_PATH}`)
    }

    // 2. Local binary
    if (fs.existsSync(BIN_PATH) && isValidBinary(BIN_PATH)) {
        ensureExecutable(BIN_PATH)
        return BIN_PATH
    }

    // 3. Local binary dengan suffix lama (_linux)
    const legacyPath = path.resolve('./storage/bin/yt-dlp_linux')
    if (fs.existsSync(legacyPath) && isValidBinary(legacyPath)) {
        ensureExecutable(legacyPath)
        return legacyPath
    }

    // 4. System PATH (hanya jika tidak preferLocal)
    if (!preferLocal) {
        try {
            execSync('yt-dlp --version', { stdio: 'ignore', timeout: 3000 })
            return 'yt-dlp'
        } catch (_) { }
    }

    return null  // tidak ada
}

function isValidBinary(filePath) {
    try {
        const stat = fs.statSync(filePath)
        if (stat.size < 1_000_000) {
            botLogger.warn('ytdlp', `Binary terlalu kecil (${(stat.size / 1024).toFixed(0)}KB): ${filePath}`)
            return false
        }
        return true
    } catch (_) {
        return false
    }
}

// Auto chmod +x — silent kalau gagal (misal volume read-only)
function ensureExecutable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK)
        // Sudah executable, skip
    } catch (_) {
        try {
            fs.chmodSync(filePath, 0o755)
            botLogger.info('ytdlp', `chmod +x applied: ${filePath}`)
        } catch (e) {
            botLogger.warn('ytdlp', `Gagal chmod +x ${filePath}: ${e.message}`)
        }
    }
}

// ─────────────────────────────────────────────
// AUTO DOWNLOAD
// ─────────────────────────────────────────────

export async function ensureYtdlp() {
    // Coba dapatkan local binary terlebih dahulu
    let existing = getYtdlpPath(true)
    if (existing) {
        botLogger.info('ytdlp', `yt-dlp local found: ${existing}`)
        return existing
    }

    botLogger.warn('ytdlp', 'yt-dlp local tidak ditemukan, mencoba mengunduh versi terbaru dari GitHub...')

    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true })

    try {
        await downloadFile(YTDLP_URL, BIN_PATH)

        // Chmod +x
        fs.chmodSync(BIN_PATH, 0o755)

        // Verifikasi
        const version = execSync(`"${BIN_PATH}" --version`, { timeout: 10_000 }).toString().trim()
        botLogger.info('ytdlp', `yt-dlp downloaded & ready: v${version}`)
        return BIN_PATH
    } catch (e) {
        botLogger.warn('ytdlp', `Gagal mengunduh yt-dlp dari GitHub: ${e.message}`)

        // Fallback ke system PATH
        existing = getYtdlpPath(false)
        if (existing) {
            botLogger.info('ytdlp', `Menggunakan fallback system yt-dlp: ${existing}`)
            return existing
        }

        throw new Error(`yt-dlp tidak dapat disediakan (download gagal dan tidak ada di system PATH): ${e.message}`)
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        let file = null
        let downloaded = 0

        function doRequest(reqUrl) {
            https.get(reqUrl, (res) => {
                // Handle redirect
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return doRequest(res.headers.location)
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`Download gagal: HTTP ${res.statusCode}`))
                }

                file = fs.createWriteStream(dest)
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
                file.on('error', e => { 
                    try { fs.unlinkSync(dest) } catch(_) {}
                    reject(e) 
                })

            }).on('error', e => {
                try { fs.unlinkSync(dest) } catch(_) {}
                reject(e)
            })
        }

        doRequest(url)
    })
}

// ─────────────────────────────────────────────
// COOKIES HELPER
// ─────────────────────────────────────────────

export function getCookieArgs() {
    // 1. Check YOUTUBE_COOKIE env var (header string)
    const envCookie = process.env.YOUTUBE_COOKIE
    if (envCookie && envCookie.length > 20 && !envCookie.startsWith('[')) {
        return ['--add-header', `Cookie: ${envCookie.trim()}`]
    }

    // 2. Check cookie file (JSON or Netscape format)
    const cookieFile = process.env.YOUTUBE_COOKIE_FILE || path.resolve('./storage/youtube-cookies.json')
    if (fs.existsSync(cookieFile)) {
        try {
            const raw = fs.readFileSync(cookieFile, 'utf-8').trim()
            if (raw.startsWith('[')) {
                // It is JSON. Convert to Netscape format dynamically
                const txtFile = path.resolve('./storage/youtube-cookies.txt')
                let needConvert = true
                if (fs.existsSync(txtFile)) {
                    const jsonStat = fs.statSync(cookieFile)
                    const txtStat = fs.statSync(txtFile)
                    if (txtStat.mtimeMs > jsonStat.mtimeMs) {
                        needConvert = false
                    }
                }

                if (needConvert) {
                    const arr = JSON.parse(raw)
                    const lines = [
                        '# Netscape HTTP Cookie File',
                        '# This file is generated automatically from youtube-cookies.json. Do not edit directly.',
                        ''
                    ]
                    for (const c of arr) {
                        if (!c.name || !c.value) continue
                        const domain = c.domain || '.youtube.com'
                        const sub = domain.startsWith('.') ? 'TRUE' : 'FALSE'
                        const path = c.path || '/'
                        const secure = c.secure === false ? 'FALSE' : 'TRUE'
                        const expiry = c.expirationDate ? Math.round(c.expirationDate) : (c.expiry ? Math.round(c.expiry) : 2147483647)
                        lines.push([domain, sub, path, secure, expiry, c.name, c.value].join('\t'))
                    }
                    fs.writeFileSync(txtFile, lines.join('\n') + '\n', 'utf-8')
                    botLogger.info('ytdlp', `Converted youtube-cookies.json to Netscape format at youtube-cookies.txt`)
                }
                return ['--cookies', txtFile]
            }
        } catch (e) {
            botLogger.warn('ytdlp', `Gagal memproses cookie file: ${e.message}`)
        }
        return ['--cookies', cookieFile]
    }
    return []
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
            '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best[height<=480]/best',
            '--get-url',
            '--extractor-args', 'youtube:player_client=ios,android,web',  // ios dulu, lebih reliable
            '--buffer-size', '256k',
            ...getCookieArgs(),
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

// ─────────────────────────────────────────────
// STREAM AUDIO LANGSUNG (PIPE) WITH DETAIL LOGS
// ─────────────────────────────────────────────

export function ytdlpStream(youtubeUrl) {
    const ytdlpPath = getYtdlpPath()
    if (!ytdlpPath) throw new Error('yt-dlp tidak ditemukan.')

    const args = [
        '--no-playlist',
        '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        '--output', '-', // stream ke stdout
        '--extractor-args', 'youtube:player_client=android,web',
        '--buffer-size', '256k',
        ...getCookieArgs(),
        '--no-warnings', // Menghilangkan warning bawaan yang tidak perlu
        youtubeUrl
    ]

    botLogger.info('ytdlp', `Membuka stream yt-dlp: ${youtubeUrl}`)
    const proc = spawn(ytdlpPath, args)

    // Sediakan properti array internal baru untuk menampung log error
    proc.ytdlpLogs = []

    proc.stderr.on('data', d => {
        const msg = d.toString().trim()
        if (msg) {
            // Naikkan level ke warn agar langsung tercetak di konsol panel kamu
            botLogger.warn('ytdlp-stderr', msg)
            proc.ytdlpLogs.push(msg)
        }
    })

    return proc
}