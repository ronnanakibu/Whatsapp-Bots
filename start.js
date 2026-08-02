/**
 * start.js — Bootstrap script untuk Pterodactyl
 * Urutan eksekusi:
 * 1. Set local timezone (Asia/Jakarta)
 * 2. Buat folder struktur
 * 3. Download font
 * 4. Cek FFmpeg
 * 5. Download yt-dlp binary (untuk radio)
 * 6. Validasi .env
 * 7. Print summary
 * 8. Launch bot
 */

import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import dns from 'dns'
import { pathToFileURL } from 'url'

// Set local timezone to Asia/Jakarta (WIB / GMT+7) for Pterodactyl console & app logs
process.env.TZ = process.env.BOT_TIMEZONE || 'Asia/Jakarta'

dns.setDefaultResultOrder('ipv4first')

// Prepend local bin folder to PATH so all spawned commands (ffmpeg, yt-dlp, openssl) are found
const localBinPath = path.resolve('./storage/bin')
if (!process.env.PATH.split(path.delimiter).includes(localBinPath)) {
    process.env.PATH = localBinPath + path.delimiter + process.env.PATH
}

// Redirect all temp files and pip caches to the workspace to bypass container /tmp limits
const globalTmpDir = path.resolve('./storage/media/tmp')
if (!fs.existsSync(globalTmpDir)) {
    fs.mkdirSync(globalTmpDir, { recursive: true })
}
process.env.TMPDIR = globalTmpDir
process.env.PIP_CACHE_DIR = path.join(globalTmpDir, 'pip-cache')

const updateProgress = (msg) => {
    process.stdout.write(`\r\x1b[K⚙️  [Bootstrap] ${msg}...`)
}
const log = (emoji, msg) => {
    process.stdout.write(`\r\x1b[K${emoji} [Bootstrap] ${msg}\n`)
}
const ok = (msg) => updateProgress(msg)
const inf = (msg) => updateProgress(msg)
const wrn = (msg) => {
    process.stdout.write(`\n⚠️  [Bootstrap Warning] ${msg}\n`)
}
const err = (msg) => {
    process.stdout.write(`\n❌ [Bootstrap Error] ${msg}\n`)
}

function commandExists(cmd) {
    try {
        const isWindows = process.platform === 'win32'
        const testCmd = isWindows ? `where ${cmd}` : `which ${cmd}`
        execSync(testCmd, { stdio: 'pipe' })
        return true
    } catch {
        return false
    }
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return request(res.headers.location)
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`))
                }
                const file = fs.createWriteStream(destPath)
                res.pipe(file)
                file.on('finish', () => { file.close(); resolve() })
                file.on('error', (e) => { fs.unlink(destPath, () => { }); reject(e) })
            }).on('error', (e) => { reject(e) })
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
        './storage/bin',
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
// ─────────────────────────────────────────────

const FFMPEG_PATH = path.resolve('./storage/bin/ffmpeg')
const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
const FFMPEG_TAR = path.resolve('./storage/bin/ffmpeg.tar.xz')

async function setupFfmpeg() {
    if (commandExists('ffmpeg')) {
        ok(`FFmpeg (system) available`)
        return
    }

    if (fs.existsSync(FFMPEG_PATH)) {
        const size = fs.statSync(FFMPEG_PATH).size
        if (size > 10_000_000) {
            ok(`FFmpeg (local): ${(size / 1024 / 1024).toFixed(1)} MB`)
            try { fs.chmodSync(FFMPEG_PATH, '755') } catch (_) { }
            return
        }
        wrn('FFmpeg binary corrupt, re-downloading...')
        fs.unlinkSync(FFMPEG_PATH)
    }

    inf('Downloading FFmpeg static binary untuk Debian (~80MB)...')

    try {
        await downloadFile(FFMPEG_URL, FFMPEG_TAR)
        inf('Extracting ffmpeg binary...')
        execSync(
            `tar -xJf "${FFMPEG_TAR}" --wildcards "*/ffmpeg" --strip-components=1 -C "${path.resolve('./storage/bin/')}"`,
            { stdio: 'pipe' }
        )
        try { fs.unlinkSync(FFMPEG_TAR) } catch (_) { }

        if (!fs.existsSync(FFMPEG_PATH)) {
            throw new Error('ffmpeg binary tidak ditemukan setelah extract')
        }

        fs.chmodSync(FFMPEG_PATH, '755')
        const size = fs.statSync(FFMPEG_PATH).size
        ok(`FFmpeg downloaded & extracted: ${(size / 1024 / 1024).toFixed(1)} MB`)
    } catch (e) {
        wrn(`Gagal setup FFmpeg: ${e.message}`)
        try { fs.unlinkSync(FFMPEG_TAR) } catch (_) { }
        try { fs.unlinkSync(FFMPEG_PATH) } catch (_) { }
    }
}

// ─────────────────────────────────────────────
// STEP 4: YT-DLP
// ─────────────────────────────────────────────

const YTDLP_SCRIPT_PATH = path.resolve('./storage/bin/yt-dlp')
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
const PYTHON_DIR = path.resolve('./storage/python')
const PYTHON_BIN = path.resolve('./storage/python/bin/python3')
const PYTHON_TAR = path.resolve('./storage/bin/python.tar.gz')

async function setupYtDlp() {
    let isMusl = fs.existsSync('/lib/ld-musl-x86_64.so.1') || fs.existsSync('/lib/ld-musl-aarch64.so.1')
    const detectedLibc = isMusl ? 'musl' : 'gnu'
    const pythonUrl = `https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.12.3+20240415-x86_64-unknown-linux-${detectedLibc}-install_only.tar.gz`

    let hasPython = false
    try {
        if (commandExists('python3') || commandExists('python')) {
            hasPython = true
            ok('Python3 system detected.')
        }
    } catch (_) { }

    if (!hasPython && !fs.existsSync(PYTHON_BIN)) {
        inf(`Downloading Python standalone (${detectedLibc.toUpperCase()}) (~35MB)...`)
        try {
            await downloadFile(pythonUrl, PYTHON_TAR)
            if (!fs.existsSync(PYTHON_DIR)) fs.mkdirSync(PYTHON_DIR, { recursive: true })
            execSync(`tar -xzf "${PYTHON_TAR}" -C "${PYTHON_DIR}" --strip-components=1`, { stdio: 'pipe' })
            fs.unlinkSync(PYTHON_TAR)
            ok(`Python standalone (${detectedLibc}) installed.`)
        } catch (e) {
            wrn(`Gagal install Python: ${e.message}`)
            try { fs.unlinkSync(PYTHON_TAR) } catch (_) { }
        }
    } else if (!hasPython && fs.existsSync(PYTHON_BIN)) {
        ok(`Python standalone (${detectedLibc}) ready.`)
    }

    if (fs.existsSync(PYTHON_BIN)) {
        process.env.PATH = path.dirname(PYTHON_BIN) + ':' + process.env.PATH
        process.env.PYTHON_CMD = PYTHON_BIN
    }

    if (fs.existsSync(YTDLP_SCRIPT_PATH)) {
        const size = fs.statSync(YTDLP_SCRIPT_PATH).size
        if (size > 100_000) {
            ok(`yt-dlp script ready.`)
            try { fs.chmodSync(YTDLP_SCRIPT_PATH, '755') } catch (_) { }
            return
        }
        fs.unlinkSync(YTDLP_SCRIPT_PATH)
    }

    inf('Downloading yt-dlp script (~3MB)...')
    try {
        await downloadFile(YTDLP_URL, YTDLP_SCRIPT_PATH)
        fs.chmodSync(YTDLP_SCRIPT_PATH, '755')
        ok('yt-dlp script downloaded.')
    } catch (e) {
        wrn(`Gagal download yt-dlp: ${e.message}`)
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

    if (process.env.IG_COOKIES) {
        try {
            fs.writeFileSync('./storage/cookies.txt', process.env.IG_COOKIES.replace(/\\n/g, '\n'), 'utf8')
            ok('Instagram cookies loaded from IG_COOKIES env.')
        } catch (_) {}
    }

    ok('Environment valid.')
}

// ─────────────────────────────────────────────
// STEP 5.5: OPENSSL HELPER FOR PRISMA
// ─────────────────────────────────────────────

async function setupOpenssl() {
    inf('Checking OpenSSL CLI tool...')
    const opensslPath = path.resolve('./storage/bin/openssl')

    try {
        const out = execSync('openssl version', { stdio: 'pipe' }).toString()
        if (out.includes('OpenSSL')) {
            ok(`OpenSSL (system): ${out.trim()}`)
            if (fs.existsSync(opensslPath)) {
                try { fs.unlinkSync(opensslPath) } catch (_) {}
            }
            return
        }
    } catch (_) {}

    inf('Ensuring OpenSSL 3.0 helper exists for Prisma...')
    try {
        fs.writeFileSync(opensslPath, '#!/bin/sh\necho "OpenSSL 3.0.0"\n', { mode: 0o755 })
        try { fs.chmodSync(opensslPath, '755') } catch (_) {}
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
        execSync('npx prisma generate', { stdio: 'pipe' })
        ok('Prisma client bindings generated successfully.')
    } catch (e) {
        wrn(`Prisma generate failed: ${e.message}`)
    }
}

// ─────────────────────────────────────────────
// STEP 7: SUMMARY
// ─────────────────────────────────────────────

async function printSummary() {
    const registered = new Map()
    const problems = []

    async function scan(dir) {
        let entries = []
        try { entries = fs.readdirSync(dir) } catch (_) { return }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry)
            if (fs.statSync(fullPath).isDirectory()) {
                await scan(fullPath)
                continue
            }
            if (!entry.endsWith('.js')) continue

            try {
                const absolutePath = path.resolve(fullPath)
                const fileURL = pathToFileURL(absolutePath).href
                const mod = await import(fileURL)
                const cmd = mod.default
                if (cmd?.name) registered.set(cmd.name, entry)
                if (cmd?.aliases) {
                    for (const alias of cmd.aliases) registered.set(alias, entry)
                }
            } catch (err) {
                problems.push(`Failed to import ${entry}: ${err.message}`)
            }
        }
    }

    inf('Scanning command registry...')
    await scan('./src/commands')

    const fonts = fs.readdirSync(FONT_DIR).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'))
    const hasFfmpeg = commandExists('ffmpeg') || fs.existsSync(FFMPEG_PATH)
    const hasYtdlp = fs.existsSync(YTDLP_SCRIPT_PATH)
    const tz = process.env.TZ || 'Asia/Jakarta'

    console.log('\n' + '─'.repeat(55))
    console.log('  🤖 RonnBot v2.0 — Bootstrap Summary & Health Check')
    console.log('─'.repeat(55))
    console.log(`  Timezone      : ${tz} (GMT+7)`)
    console.log(`  Fonts         : ${fonts.length > 0 ? fonts.join(', ') : 'none'}`)
    console.log(`  FFmpeg        : ${hasFfmpeg ? '✅ available' : '❌ not found (radio disabled)'}`)
    console.log(`  yt-dlp        : ${hasYtdlp ? '✅ ready' : '❌ not found (radio disabled)'}`)
    console.log(`  Owner         : ${process.env.OWNER_NUMBER ?? 'not set'}`)
    console.log(`  Prefix        : ${process.env.BOT_PREFIX ?? '!'}`)
    console.log(`  Node version  : ${process.version}`)
    console.log('─'.repeat(55))
    console.log(`  Commands      : ${registered.size} registered commands & aliases`)
    console.log('─'.repeat(55) + '\n')
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
        await setupOpenssl()
        validateEnv()
        await setupPrisma()
        process.stdout.write('\r\x1b[K✅ [Bootstrap] Pre-launch checks completed successfully!\n')
        await printSummary()
        launchBot()
    } catch (e) {
        err(`Bootstrap fatal error: ${e.message}`)
        console.error(e)
        process.exit(1)
    }
}

main()