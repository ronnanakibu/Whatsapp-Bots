/**
 * start.js — Bootstrap script untuk Pterodactyl
 * Urutan eksekusi:
 * 1. Buat folder struktur
 * 2. Download font
 * 3. Cek FFmpeg
 * 4. Download yt-dlp binary (untuk radio)
 * 5. Validasi .env
 * 6. Print summary
 * 7. Launch bot
 */

import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import dns from 'dns'

dns.setDefaultResultOrder('ipv4first')

// Prepend local bin folder to PATH so all spawned commands (ffmpeg, yt-dlp, openssl) are found
const localBinPath = path.resolve('./storage/bin')
if (!process.env.PATH.split(path.delimiter).includes(localBinPath)) {
    process.env.PATH = localBinPath + path.delimiter + process.env.PATH
}

const log = (emoji, msg) => console.log(`${emoji} [Bootstrap] ${msg}`)
const ok = (msg) => log('✅', msg)
const inf = (msg) => log('⚙️ ', msg)
const wrn = (msg) => log('⚠️ ', msg)
const err = (msg) => log('❌', msg)

function commandExists(cmd) {
    try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true }
    catch { return false }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath)
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close()
                    return request(res.headers.location)
                }
                if (res.statusCode !== 200) {
                    file.close()
                    fs.unlink(destPath, () => { })
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }
                res.pipe(file)
                file.on('finish', () => { file.close(); resolve() })
            }).on('error', (e) => { fs.unlink(destPath, () => { }); reject(e) })
        }
        request(url)
    })
}

// ─────────────────────────────────────────────
// STEP 1: FOLDER STRUCTURE
// ─────────────────────────────────────────────

function setupDirectories() {
    inf('Setting up folder structure...')
    const dirs = [
        './storage/sessions',
        './storage/database',
        './storage/database/fontcache',
        './storage/logs',
        './storage/media',
        './storage/media/emoji-cache',
        './storage/bin',            // ← yt-dlp binary
        './src/assets/fonts',
    ]
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
            inf(`Created: ${dir}`)
        }
    })
    ok('Folder structure ready.')
}

// ─────────────────────────────────────────────
// STEP 2: FONTS
// ─────────────────────────────────────────────

const FONT_DIR = path.resolve('./src/assets/fonts')

const REQUIRED_FONTS = [
    {
        name: 'NotoColorEmoji.ttf',
        url: 'https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf',
        description: 'Noto Color Emoji (Google)'
    },
    {
        name: 'Impact.ttf',
        url: 'https://github.com/matomo-org/travis-scripts/raw/master/fonts/Impact.ttf',
        description: 'Impact (meme font)'
    },
    {
        name: 'arialn.ttf',
        url: 'https://raw.githubusercontent.com/uclalibrary/clis-images-docker/master/fonts/arialn.ttf',
        description: 'Arial Narrow (brat font)'
    }
]

async function setupFonts() {
    inf('Checking fonts...')
    for (const font of REQUIRED_FONTS) {
        const destPath = path.join(FONT_DIR, font.name)
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 10_000) {
            ok(`Font exists: ${font.name}`)
            continue
        }
        inf(`Downloading ${font.description}...`)
        try {
            await downloadFile(font.url, destPath)
            ok(`Downloaded: ${font.name} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(2)} MB)`)
        } catch (e) {
            wrn(`Gagal download ${font.name}: ${e.message}`)
        }
    }
    ok('Font setup complete.')
}

// ─────────────────────────────────────────────
// STEP 3: FFMPEG — auto-download static binary
// Pakai ffmpeg-static build untuk Linux Debian x86_64
// Tidak butuh apt, tidak butuh root
// ─────────────────────────────────────────────

const FFMPEG_PATH = path.resolve('./storage/bin/ffmpeg')
// John Van Sickle ffmpeg static builds — paling reliable untuk Debian/Ubuntu
const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
const FFMPEG_TAR = path.resolve('./storage/bin/ffmpeg.tar.xz')

async function setupFfmpeg() {
    // Cek apakah sudah ada di PATH sistem dulu
    if (commandExists('ffmpeg')) {
        const version = execSync('ffmpeg -version', { stdio: 'pipe' }).toString().split('\n')[0]
        ok(`FFmpeg (system): ${version}`)
        return
    }

    // Cek apakah binary lokal sudah ada
    if (fs.existsSync(FFMPEG_PATH)) {
        const size = fs.statSync(FFMPEG_PATH).size
        if (size > 10_000_000) { // > 10MB = valid
            ok(`FFmpeg (local): ${(size / 1024 / 1024).toFixed(1)} MB`)
            try { fs.chmodSync(FFMPEG_PATH, '755') } catch (_) { }
            // Tambah ke PATH supaya spawn('ffmpeg') bisa ketemu
            process.env.PATH = path.resolve('./storage/bin') + ':' + process.env.PATH
            return
        }
        wrn('FFmpeg binary corrupt, re-downloading...')
        fs.unlinkSync(FFMPEG_PATH)
    }

    inf('Downloading FFmpeg static binary untuk Debian (~80MB, hanya sekali)...')
    inf('Ini mungkin butuh 1-2 menit tergantung koneksi server...')

    try {
        // Download tar.xz
        await downloadFile(FFMPEG_URL, FFMPEG_TAR)
        inf(`Downloaded tar: ${(fs.statSync(FFMPEG_TAR).size / 1024 / 1024).toFixed(1)} MB`)

        // Extract binary ffmpeg dari tar.xz
        // tar -xJ (xz) → extract file ffmpeg saja ke storage/bin/
        inf('Extracting ffmpeg binary...')
        execSync(
            `tar -xJf "${FFMPEG_TAR}" --wildcards "*/ffmpeg" --strip-components=1 -C "${path.resolve('./storage/bin/')}"`,
            { stdio: 'pipe' }
        )

        // Cleanup tar
        try { fs.unlinkSync(FFMPEG_TAR) } catch (_) { }

        if (!fs.existsSync(FFMPEG_PATH)) {
            throw new Error('ffmpeg binary tidak ditemukan setelah extract')
        }

        fs.chmodSync(FFMPEG_PATH, '755')
        const size = fs.statSync(FFMPEG_PATH).size
        ok(`FFmpeg downloaded & extracted: ${(size / 1024 / 1024).toFixed(1)} MB`)

        // Tambah ke PATH
        process.env.PATH = path.resolve('./storage/bin') + ':' + process.env.PATH

    } catch (e) {
        wrn(`Gagal setup FFmpeg: ${e.message}`)
        wrn('Fitur radio tidak akan berfungsi. Coba restart bot untuk download ulang.')
        // Cleanup kalau gagal
        try { fs.unlinkSync(FFMPEG_TAR) } catch (_) { }
        try { fs.unlinkSync(FFMPEG_PATH) } catch (_) { }
    }
}

// ─────────────────────────────────────────────
// STEP 4: YT-DLP & PYTHON STANDALONE
// Alpine/musl Linux tidak bisa jalankan yt-dlp_linux (glibc ELF).
// Solusi: Gunakan yt-dlp versi python script + install Python standalone jika perlu.
// ─────────────────────────────────────────────

const YTDLP_SCRIPT_PATH = path.resolve('./storage/bin/yt-dlp')
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
const PYTHON_DIR = path.resolve('./storage/bin/python')
const PYTHON_BIN = path.resolve('./storage/bin/python/bin/python3')
const PYTHON_URL = 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.12.3+20240415-x86_64-unknown-linux-musl-install_only.tar.gz'
const PYTHON_TAR = path.resolve('./storage/bin/python.tar.gz')

async function setupYtDlp() {
    // 1. Cek Python di sistem
    let hasPython = false
    try {
        execSync('python3 --version', { stdio: 'ignore' })
        hasPython = true
        ok('Python3 system detected.')
    } catch (_) { }

    // 2. Jika tidak ada Python, download Python standalone
    if (!hasPython && !fs.existsSync(PYTHON_BIN)) {
        inf('Python3 tidak ditemukan. Downloading Python standalone (~35MB)...')
        try {
            await downloadFile(PYTHON_URL, PYTHON_TAR)
            inf('Extracting Python...')
            if (!fs.existsSync(PYTHON_DIR)) fs.mkdirSync(PYTHON_DIR, { recursive: true })
            execSync(`tar -xzf "${PYTHON_TAR}" -C "${PYTHON_DIR}" --strip-components=1`, { stdio: 'pipe' })
            fs.unlinkSync(PYTHON_TAR)
            ok('Python standalone installed.')
        } catch (e) {
            wrn(`Gagal install Python: ${e.message}`)
            try { fs.unlinkSync(PYTHON_TAR) } catch (_) { }
        }
    } else if (!hasPython && fs.existsSync(PYTHON_BIN)) {
        ok('Python standalone exists.')
    }

    // Tambahkan Python standalone ke PATH
    if (fs.existsSync(PYTHON_BIN)) {
        process.env.PATH = path.dirname(PYTHON_BIN) + ':' + process.env.PATH
    }

    // 3. Download yt-dlp (Python script version, cuma 3MB)
    if (fs.existsSync(YTDLP_SCRIPT_PATH)) {
        const size = fs.statSync(YTDLP_SCRIPT_PATH).size
        if (size > 2_000_000 && size < 5_000_000) { // ~3MB
            ok(`yt-dlp script exists: ${(size / 1024 / 1024).toFixed(1)} MB`)
            try { fs.chmodSync(YTDLP_SCRIPT_PATH, '755') } catch (_) { }
            return
        }
        fs.unlinkSync(YTDLP_SCRIPT_PATH)
    }

    // Hapus binary ELF lama yg gagal jalan (30MB)
    const oldElf = path.resolve('./storage/bin/yt-dlp_linux')
    if (fs.existsSync(oldElf)) fs.unlinkSync(oldElf)

    inf('Downloading yt-dlp python script (~3MB)...')
    try {
        await downloadFile(YTDLP_URL, YTDLP_SCRIPT_PATH)
        fs.chmodSync(YTDLP_SCRIPT_PATH, '755')
        ok('yt-dlp script downloaded.')
    } catch (e) {
        wrn(`Gagal download yt-dlp: ${e.message}`)
    }
}

// ─────────────────────────────────────────────
// STEP 4.5: REMBG (PYTHON BACKEND & MODEL SETUP)
// ─────────────────────────────────────────────

async function setupRembg() {
    inf('Checking Python rembg module and dependencies...')
    
    let workingPython = null
    for (const cmd of ['python3', 'python', PYTHON_BIN]) {
        try {
            if (cmd === PYTHON_BIN && !fs.existsSync(PYTHON_BIN)) continue
            execSync(`"${cmd}" --version`, { stdio: 'ignore' })
            workingPython = cmd
            break
        } catch (_) {}
    }

    if (!workingPython) {
        wrn('Python runtime not found. Skipping rembg dependencies installation.')
        return
    }

    let rembgInstalled = false
    try {
        execSync(`"${workingPython}" -c "import rembg"`, { stdio: 'ignore' })
        rembgInstalled = true
        ok('rembg module already installed.')
    } catch (_) { }

    if (!rembgInstalled) {
        inf(`Installing rembg[cpu] dependency via ${workingPython}...`)
        try {
            execSync(`"${workingPython}" -m pip install "rembg[cpu]"`, { stdio: 'inherit' })
            ok('rembg dependencies installed successfully.')
        } catch (e) {
            wrn(`Gagal install rembg: ${e.message}`)
            return
        }
    }

    inf('Checking/Pre-downloading u2net background removal model...')
    try {
        execSync(`"${workingPython}" -c "from rembg import remove; remove(b'')"`, { stdio: 'inherit' })
        ok('u2net background removal model ready and cached.')
    } catch (e) {
        wrn(`Gagal cache model u2net: ${e.message}`)
    }
}

// ─────────────────────────────────────────────
// STEP 5: VALIDASI .env
// ─────────────────────────────────────────────

function validateEnv() {
    inf('Validating environment variables...')
    const envPath = './.env'
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8')
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) return
            const [key, ...val] = trimmed.split('=')
            if (key && val.length && !process.env[key.trim()]) {
                process.env[key.trim()] = val.join('=').trim()
            }
        })
        ok('.env loaded.')
    } else {
        wrn('.env tidak ditemukan — pastikan env variables sudah di-set di panel Pterodactyl.')
    }

    const required = ['OWNER_NUMBER', 'BOT_PREFIX']
    const missing = required.filter(k => !process.env[k])
    if (missing.length > 0) {
        err(`Missing required env vars: ${missing.join(', ')}`)
        process.exit(1)
    }

    const optional = ['GEMINI_API_KEY', 'GROQ_API_KEY']
    optional.forEach(k => {
        if (!process.env[k]) wrn(`${k} tidak di-set — fitur AI tidak aktif.`)
    })

    ok('Environment valid.')
}

// ─────────────────────────────────────────────
// STEP 5.5: OPENSSL HELPER FOR PRISMA
// ─────────────────────────────────────────────

async function setupOpenssl() {
    inf('Checking OpenSSL CLI tool...')
    const opensslPath = path.resolve('./storage/bin/openssl')
    
    // Check if openssl exists in PATH outside our local storage/bin directory
    let hasSystemOpenssl = false
    try {
        const pathDirs = process.env.PATH.split(path.delimiter)
        const systemDirs = pathDirs.filter(d => d !== localBinPath)
        const systemPath = systemDirs.join(path.delimiter)
        execSync('which openssl', { env: { ...process.env, PATH: systemPath }, stdio: 'pipe' })
        hasSystemOpenssl = true
    } catch (_) {}

    if (hasSystemOpenssl) {
        try {
            const version = execSync('openssl version', { stdio: 'pipe' }).toString().trim()
            ok(`OpenSSL (system): ${version}`)
            // If a mock openssl was previously created, remove it to use the system one
            if (fs.existsSync(opensslPath)) {
                fs.unlinkSync(opensslPath)
            }
            return
        } catch (_) {}
    }

    inf('OpenSSL CLI not found on system. Ensuring mock openssl helper exists for Prisma...')
    try {
        fs.writeFileSync(opensslPath, '#!/bin/sh\necho "OpenSSL 3.0.0"\n')
        fs.chmodSync(opensslPath, '755')
        ok('OpenSSL helper ready.')
    } catch (e) {
        wrn(`Failed to write OpenSSL helper: ${e.message}`)
    }
}

// ─────────────────────────────────────────────
// STEP 6: PRISMA
// ─────────────────────────────────────────────

async function setupPrisma() {
    inf('Generating Prisma client database bindings...')
    try {
        execSync('npx prisma generate', { stdio: 'inherit' })
        ok('Prisma client bindings generated successfully.')
    } catch (e) {
        wrn(`Prisma generate failed: ${e.message}`)
    }
}

// ─────────────────────────────────────────────
// STEP 7: SUMMARY
// ─────────────────────────────────────────────

function printSummary() {
    const fonts = fs.readdirSync(FONT_DIR).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'))
    const hasFfmpeg = commandExists('ffmpeg') || fs.existsSync(FFMPEG_PATH)
    const hasYtdlp = fs.existsSync(YTDLP_SCRIPT_PATH)

    console.log('\n' + '─'.repeat(50))
    console.log('  🤖 RonnBot v2.0 — Bootstrap Summary')
    console.log('─'.repeat(50))
    console.log(`  Fonts         : ${fonts.length > 0 ? fonts.join(', ') : 'none'}`)
    console.log(`  FFmpeg        : ${hasFfmpeg ? '✅ available' : '❌ not found (radio disabled)'}`)
    console.log(`  yt-dlp        : ${hasYtdlp ? '✅ ready' : '❌ not found (radio disabled)'}`)
    console.log(`  Owner         : ${process.env.OWNER_NUMBER ?? 'not set'}`)
    console.log(`  Prefix        : ${process.env.BOT_PREFIX ?? '!'}`)
    console.log(`  Session path  : ${process.env.SESSION_PATH ?? './storage/sessions'}`)
    console.log(`  Node version  : ${process.version}`)
    console.log(`  Dashboard     : ap2.nzb.zelpstore.id:${process.env.RADIO_PORT ?? '25637'}/dashboard`)
    console.log('─'.repeat(50) + '\n')
}

// ─────────────────────────────────────────────
// STEP 8: LAUNCH BOT
// ─────────────────────────────────────────────

function launchBot() {
    inf('Launching bot...\n')
    const bot = spawn('node', ['src/core/bot.js'], {
        stdio: 'inherit',
        env: process.env
    })
    bot.on('exit', (code, signal) => {
        code === 0
            ? log('👋', 'Bot exited cleanly.')
            : err(`Bot exited with code ${code} (signal: ${signal})`)
        process.exit(code ?? 1)
    })
    process.on('SIGTERM', () => bot.kill('SIGTERM'))
    process.on('SIGINT', () => bot.kill('SIGINT'))
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
    console.log('\n🚀 [Bootstrap] RonnBot v2.0 starting up...\n')
    try {
        setupDirectories()
        await setupFonts()
        await setupFfmpeg()
        await setupYtDlp()
        await setupRembg()
        await setupOpenssl()
        validateEnv()
        await setupPrisma()
        printSummary()
        launchBot()
    } catch (e) {
        err(`Bootstrap fatal error: ${e.message}`)
        console.error(e)
        process.exit(1)
    }
}

main()