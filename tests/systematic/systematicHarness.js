/**
 * tests/systematic/systematicHarness.js
 * 
 * Specialized test harness for Milestone 1: Systematic Command Verification.
 * Enforces rigorous side-effect isolation, SQLite fixture in os.tmpdir(),
 * process.exit interception, timer unreffing, and MockWASocket stubs.
 */

import os from 'os'
import path from 'path'
import fs from 'fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

// ── 1. ISOLATED ENVIRONMENT SETUP ──
// Disposable SQLite database fixture in tempdir to guarantee ./storage/database/main.db is never touched
export const TEMP_DB_PATH = path.join(os.tmpdir(), `wabot_systematic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`)

process.env.NODE_ENV = 'test'
process.env.DB_PATH = TEMP_DB_PATH
process.env.BOT_PREFIX = '.'
process.env.BOT_NUMBER = '6281234567890'
process.env.OWNER_NUMBER = '6285172013920'
process.env.AUTO_READ = 'false'
process.env.GROQ_API_KEY = 'mock_systematic_groq_key'
process.env.GEMINI_API_KEY = 'mock_systematic_gemini_key'
process.env.HF_TOKEN = 'mock_systematic_hf_token'
process.env.OPENAI_API_KEY = 'mock_systematic_openai_key'
process.env.TELEGRAM_BOT_TOKEN = 'mock_systematic_tg_token'
process.env.NVIDIA_API_KEY = 'mock_systematic_nvidia_key'
process.env.SAFE_BROWSING_API_KEY = ''
process.env.SUNO_COOKIE = ''
process.env.PTERO_API_KEY = ''

// ── 2. BACKGROUND TIMER UNREF & UNHANDLED REJECTION GUARD ──
// Patch global.setInterval and global.setTimeout so background services do not hold event loop open
const origSetInterval = global.setInterval
const origSetTimeout = global.setTimeout

global.setInterval = function (...args) {
    const timer = origSetInterval.apply(this, args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}

global.setTimeout = function (...args) {
    const timer = origSetTimeout.apply(this, args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}

process.on('unhandledRejection', (_reason) => {
    // Suppress crash from detached background promises (e.g. aborts, disconnects) during offline testing
})

// ── 2B. 3-TIER NETWORK SHIELDING ──
let originalFetch = null
let originalHttpRequest = null
let originalHttpsRequest = null
let originalSocketConnect = null

export function installNetworkShield() {
    process.env.GROQ_API_KEY = 'mock_systematic_groq_key'
    process.env.GEMINI_API_KEY = 'mock_systematic_gemini_key'
    process.env.HF_TOKEN = 'mock_systematic_hf_token'
    process.env.OPENAI_API_KEY = 'mock_systematic_openai_key'
    process.env.TELEGRAM_BOT_TOKEN = 'mock_systematic_tg_token'
    process.env.NVIDIA_API_KEY = 'mock_systematic_nvidia_key'
    process.env.SAFE_BROWSING_API_KEY = ''
    process.env.SUNO_COOKIE = ''
    process.env.PTERO_API_KEY = ''

    if (!originalFetch) {
        originalFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
            let urlStr = ''
            if (typeof input === 'string') {
                urlStr = input
            } else if (input && typeof input.url === 'string') {
                urlStr = input.url
            } else if (input && typeof input.href === 'string') {
                urlStr = input.href
            } else {
                urlStr = String(input || '')
            }
            if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
                return originalFetch(input, init)
            }
            throw new Error(`[NetworkShield] Blocked outbound fetch: ${urlStr}`)
        }
    }

    if (!originalHttpRequest) {
        originalHttpRequest = http.request
        http.request = function (options, cb) {
            let host = ''
            if (typeof options === 'string') {
                try { host = new URL(options).hostname } catch (_) { host = options }
            } else if (options && typeof options === 'object') {
                host = options.host || options.hostname || ''
            }
            if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('127.')) {
                return originalHttpRequest.call(this, options, cb)
            }
            throw new Error(`[NetworkShield] Blocked outbound HTTP request: ${host}`)
        }
    }

    if (!originalHttpsRequest) {
        originalHttpsRequest = https.request
        https.request = function (options, cb) {
            let host = ''
            if (typeof options === 'string') {
                try { host = new URL(options).hostname } catch (_) { host = options }
            } else if (options && typeof options === 'object') {
                host = options.host || options.hostname || ''
            }
            if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('127.')) {
                return originalHttpsRequest.call(this, options, cb)
            }
            throw new Error(`[NetworkShield] Blocked outbound HTTPS request: ${host}`)
        }
    }

    if (!originalSocketConnect) {
        originalSocketConnect = net.Socket.prototype.connect
        net.Socket.prototype.connect = function (...args) {
            const target = args[0]
            let host = ''
            if (typeof target === 'object' && target !== null) {
                host = target.host || target.hostname || ''
            } else if (typeof args[1] === 'string') {
                host = args[1]
            }
            if (host && host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('127.')) {
                throw new Error(`[NetworkShield] Blocked outbound socket connect: ${host}`)
            }
            return originalSocketConnect.apply(this, args)
        }
    }
}

export function restoreNetworkShield() {
    if (originalFetch) {
        globalThis.fetch = originalFetch
        originalFetch = null
    }
    if (originalHttpRequest) {
        http.request = originalHttpRequest
        originalHttpRequest = null
    }
    if (originalHttpsRequest) {
        https.request = originalHttpsRequest
        originalHttpsRequest = null
    }
    if (originalSocketConnect) {
        net.Socket.prototype.connect = originalSocketConnect
        originalSocketConnect = null
    }
}

// Auto-install network shield on harness load
installNetworkShield()

// ── 2C. PRE-LAYER 6 EXECUTION SHIELDING ──
export function shieldCommandExecution(cmd, mockResult = 'Requires External API / Credentials') {
    if (!cmd || typeof cmd.execute !== 'function') return () => {}
    const originalExecute = cmd.execute
    cmd.execute = async (ctx) => {
        const reqList = cmd.params?.required || cmd.parameters?.required || []
        if (reqList.length > 0 && (!ctx?.args || ctx.args.length === 0)) {
            return `⚠️ Masukkan parameter: <${reqList.join('> <')}>`
        }
        return mockResult
    }
    return () => {
        cmd.execute = originalExecute
    }
}

// ── 3. PROCESS.EXIT INTERCEPTION ──
// Protects the test runner from shutdown/restart commands attempting process termination
let exitTrapped = false
let interceptedExitCode = null
const origExit = process.exit

export function installExitTrap() {
    exitTrapped = true
    interceptedExitCode = null
    process.exit = function (code = 0) {
        interceptedExitCode = code
        // Intercepted: Do NOT terminate the Node process
    }
}

export function restoreExitTrap() {
    exitTrapped = false
    process.exit = origExit
    return interceptedExitCode
}

export function getInterceptedExitCode() {
    return interceptedExitCode
}

// ── 4. MOCK SOCKET & CONTEXT FACTORY ──
import { MockWASocket, createMockSocket } from '../e2e/harness/mockSocket.js'
import { createMockContext, OWNER_JID, BOT_JID, TEST_GROUP_JID, TEST_USER_JID } from '../e2e/harness/mockContext.js'
import { resetCooldown } from '../../src/middleware/cooldown.js'

export { OWNER_JID, BOT_JID, TEST_GROUP_JID, TEST_USER_JID }

/**
 * Creates an enhanced MockWASocket with complete Baileys stubs
 */
export function createSystematicMockSocket(options = {}) {
    const sock = createMockSocket({
        botJid: BOT_JID,
        botName: 'RonnBot',
        ...options
    })

    // Stub missing group administration methods
    sock.groupSettingUpdate = async (jid, setting) => {
        sock.groupSettings = sock.groupSettings || []
        sock.groupSettings.push({ jid, setting, timestamp: Date.now() })
        return true
    }
    sock.groupUpdateDescription = async (jid, desc) => {
        sock.groupDescriptions = sock.groupDescriptions || []
        sock.groupDescriptions.push({ jid, desc, timestamp: Date.now() })
        return true
    }
    sock.groupRevokeInvite = async (jid) => 'MOCK_REVOKED_INVITE_' + Date.now()

    return sock
}

/**
 * Factory for creating variant message contexts:
 * - USER_DM: Regular user in private chat
 * - USER_GROUP: Regular user in group chat
 * - ADMIN_GROUP: Group admin in group chat
 * - OWNER_DM: Bot owner in private chat
 * - OWNER_GROUP: Bot owner in group chat
 * - BOT_NOT_ADMIN: Group admin in group chat where bot is NOT admin
 * - INVALID_PARAMS: Context containing invalid parameters triggering Layer 2 validator
 */
export function createVariantContext(variantType, commandName, args = [], options = {}) {
    const sock = options.sock || createSystematicMockSocket()
    const cleanCmd = String(commandName || '').toLowerCase()

    switch (variantType) {
        case 'USER_DM': {
            const sender = '628991111111@s.whatsapp.net'
            resetCooldown(sender, cleanCmd)
            return createMockContext({
                role: 'user',
                sender,
                isGroup: false,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'USER_GROUP': {
            const sender = '628992222222@s.whatsapp.net'
            resetCooldown(sender, cleanCmd)
            return createMockContext({
                role: 'user',
                sender,
                isGroup: true,
                from: TEST_GROUP_JID,
                botIsAdmin: true,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'ADMIN_GROUP': {
            const sender = '628113333333@s.whatsapp.net'
            resetCooldown(sender, cleanCmd)
            return createMockContext({
                role: 'admin',
                sender,
                isGroup: true,
                from: TEST_GROUP_JID,
                botIsAdmin: true,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'OWNER_DM': {
            resetCooldown(OWNER_JID, cleanCmd)
            return createMockContext({
                role: 'owner',
                sender: OWNER_JID,
                isGroup: false,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'OWNER_GROUP': {
            resetCooldown(OWNER_JID, cleanCmd)
            return createMockContext({
                role: 'owner',
                sender: OWNER_JID,
                isGroup: true,
                from: TEST_GROUP_JID,
                botIsAdmin: true,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'BOT_NOT_ADMIN': {
            const sender = '628113333333@s.whatsapp.net'
            resetCooldown(sender, cleanCmd)
            return createMockContext({
                role: 'admin',
                sender,
                isGroup: true,
                from: TEST_GROUP_JID,
                botIsAdmin: false,
                sock,
                commandName: cleanCmd,
                args,
                body: `.${cleanCmd} ${args.join(' ')}`.trim()
            })
        }
        case 'INVALID_PARAMS': {
            const sender = OWNER_JID
            resetCooldown(sender, cleanCmd)
            const oversizedArg = 'a'.repeat(501)
            return createMockContext({
                role: 'owner',
                sender: OWNER_JID,
                isGroup: false,
                sock,
                commandName: cleanCmd,
                args: [oversizedArg],
                body: `.${cleanCmd} ${oversizedArg}`
            })
        }
        default:
            throw new Error(`Unknown variant type: ${variantType}`)
    }
}

// ── 5. BENIGN ARGUMENTS FOR HAPPY PATH EXECUTION ──
export function getBenignArgs(cmd) {
    const name = cmd.name.toLowerCase()

    if (name === 'eval') return ['1 + 1']
    if (name === 'kalkulator') return ['5 * 10']
    if (name === 'ping' || name === 'help' || name === 'uptime' || name === 'aboutbots' || name === 'changelogs') return []
    if (name === 'kick' || name === 'promote' || name === 'demote' || name === 'add') {
        return ['628999999999@s.whatsapp.net']
    }
    if (name === 'cuaca') return ['Jakarta']
    if (name === 'translate') return ['id', 'good morning']
    if (name === 'qr') return ['WABOT2.0']
    if (name === 'shortlink') return ['https://google.com']
    if (name === 'lyrics') return ['imagine']
    if (name === 'notes') return ['list']
    if (name === 'remindme') return ['list']
    if (name === 'files' || name === 'src') return ['ls']
    if (name === 'poll') return ['Pilihan', 'Opsi A', 'Opsi B']
    if (name === 'stalk') return ['wabot']
    if (name === 'ceklink') return ['https://example.com']
    if (name === 'cekhoax') return ['vaksin covid']
    if (name === 'pdf') return ['https://example.com']
    if (name === 'baca') return ['https://example.com']
    if (name === 'sumurl') return ['https://example.com']
    if (name === 'truth' || name === 'dare') return []
    if (name === 'groups' || name === 'groupinfo' || name === 'listadmin' || name === 'kickme' || name === 'grouplink') return []
    if (name === 'mute' || name === 'unmute' || name === 'aimod') return []
    if (name === 'sleep' || name === 'wake' || name === 'setlogchannel' || name === 'catchup') return []
    if (name === 'restart' || name === 'shutdown') return []
    if (name === 'setjadwalgroup' || name === 'setkategori') return []

    // Parameter heuristic inspection
    const raw = cmd.params || cmd.parameters
    if (raw?.required && Array.isArray(raw.required) && raw.required.length > 0) {
        const firstReq = raw.required[0].toLowerCase()
        if (firstReq.includes('url') || firstReq.includes('link')) return ['https://example.com']
        if (firstReq.includes('user') || firstReq.includes('number') || firstReq.includes('target')) return ['628999999999@s.whatsapp.net']
        if (firstReq.includes('prompt') || firstReq.includes('text') || firstReq.includes('teks')) return ['Halo WABOT']
        if (firstReq.includes('code') || firstReq.includes('kode')) return ['1 + 1']
        return ['test_argument']
    }

    const usage = cmd.usage || ''
    const match = usage.match(/<([^>]+)>/)
    if (match) {
        const p = match[1].toLowerCase()
        if (p.includes('url') || p.includes('link')) return ['https://example.com']
        if (p.includes('user') || p.includes('target') || p.includes('nomor')) return ['628999999999@s.whatsapp.net']
        if (p.includes('prompt') || p.includes('teks')) return ['Halo WABOT']
        return ['test_argument']
    }

    return []
}

// ── 6. STATIC EXTERNAL DEPENDENCY DETECTOR (AIRTIGHT & TRANSITIVE) ──
export function detectExternalDependencies(filePath, visited = new Set()) {
    if (!filePath || !fs.existsSync(filePath)) return 'None (Internal/Offline)'
    if (visited.has(filePath)) return 'None (Internal/Offline)'
    visited.add(filePath)

    try {
        const content = fs.readFileSync(filePath, 'utf8')
        const deps = new Set()

        // 1. Hugging Face & Gradio Ecosystem
        if (/services\/hf\.js/.test(content)) deps.add('Hugging Face / Gradio Client')
        if (/services\/hfStorage\.js/.test(content)) deps.add('Hugging Face Storage API')
        if (/services\/hfLogsStreamer\.js/.test(content)) deps.add('Hugging Face Logs Streamer')
        if (/@gradio\/client/.test(content)) deps.add('Gradio Client')
        if (/@huggingface\/hub/.test(content)) deps.add('Hugging Face Hub API')

        // 2. AI / LLM Services & Routers
        if (/utils\/aiRouter\.js/.test(content)) deps.add('Hermes Agent OS / AI Router')
        if (/services\/ai\.js/.test(content)) deps.add('aiService (Groq/Gemini/NVIDIA)')
        if (/services\/hermes\.js/.test(content)) deps.add('Hermes Agent OS (Groq)')
        if (/services\/dynamicSkills\.js/.test(content)) deps.add('Dynamic Skills (Groq/NVIDIA/AI)')
        if (/services\/moderator\.js/.test(content)) deps.add('AI Moderator (Groq)')
        if (/groq-sdk/.test(content)) deps.add('Groq Cloud LLM API')
        if (/@google\/generative-ai|@google\/genai/.test(content)) deps.add('Google Gemini API')
        if (/openai/.test(content)) deps.add('OpenAI API')

        // 3. Audio / Radio / Streaming Services
        if (/services\/radio\.js/.test(content)) deps.add('Radio Stream / Audio FFmpeg')
        if (/services\/youtube\.js/.test(content)) deps.add('YouTube API')
        if (/services\/ytdlp\.js/.test(content)) deps.add('yt-dlp Binary')
        if (/yt-search/.test(content)) deps.add('YouTube Search API')
        if (/play-dl/.test(content)) deps.add('play-dl (SoundCloud / YouTube)')
        if (/@distube\/ytdl-core/.test(content)) deps.add('ytdl-core')

        // 4. Social Media & Downloader Services
        if (/services\/downloader\//.test(content)) deps.add('Video/Audio Downloader (IG/TikTok/YT/FB)')
        if (/services\/storySync\.js/.test(content)) deps.add('Instagram Story Sync API')
        if (/services\/sessionSync\.js/.test(content)) deps.add('Hugging Face Dataset Backup')
        if (/btch-downloader/.test(content)) deps.add('btch-downloader')
        if (/instagram-url-direct/.test(content)) deps.add('instagram-url-direct')

        // 5. External Cloud & Third-Party APIs
        if (/services\/lyrics\.js/.test(content)) deps.add('Lyrics REST API (LRCLIB)')
        if (/services\/suno\.js/.test(content)) deps.add('Suno Music Generation API')
        if (/services\/pterodactyl\.js/.test(content)) deps.add('Pterodactyl Game Server API')
        if (/services\/annas\.js/.test(content)) deps.add('Anna Archive API')
        if (/services\/gdrive\.js/.test(content)) deps.add('Google Drive API')
        if (/services\/tgStorage\.js/.test(content)) deps.add('Telegram Storage Bridge')
        if (/discord\//.test(content)) deps.add('Discord Webhook / Bot')

        // 6. Generic HTTP / REST Clients & Calls
        if (/axios/.test(content)) deps.add('External HTTP/REST API (axios)')
        if (/fetch\s*\(/.test(content)) deps.add('External HTTP/REST API (fetch)')

        // 7. Transitive Resolution for Relative Imports (e.g. restore.js -> ./enhance.js, sumurl -> ./baca.js)
        const dir = path.dirname(filePath)
        const relativeImportMatches = [
            ...content.matchAll(/import\s+(?:(?:\{[^}]*\}|[\w*\s,]+)\s+from\s+)?['"](\.[^'"]+)['"]/g),
            ...content.matchAll(/import\(['"](\.[^'"]+)['"]\)/g),
            ...content.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)
        ]

        for (const match of relativeImportMatches) {
            const relPath = match[1]
            let targetPath = path.resolve(dir, relPath)
            if (!fs.existsSync(targetPath)) {
                if (fs.existsSync(targetPath + '.js')) targetPath = targetPath + '.js'
                else if (fs.existsSync(path.join(targetPath, 'index.js'))) targetPath = path.join(targetPath, 'index.js')
                else continue
            }
            if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
                const subResult = detectExternalDependencies(targetPath, visited)
                if (subResult !== 'None (Internal/Offline)') {
                    subResult.split('; ').forEach(d => deps.add(d))
                }
            }
        }

        return deps.size > 0 ? Array.from(deps).join('; ') : 'None (Internal/Offline)'
    } catch (_) {
        return 'None (Internal/Offline)'
    }
}

// ── 7. FILESYSTEM & ENVIRONMENT PROTECTION ──
const envPath = path.resolve('.env')
const envBackupPath = path.resolve('.env.systematic_backup')

export function backupEnvironment() {
    try {
        if (fs.existsSync(envPath)) {
            fs.copyFileSync(envPath, envBackupPath)
        }
    } catch (_) {}
}

export function restoreEnvironment() {
    try {
        if (fs.existsSync(envBackupPath)) {
            fs.copyFileSync(envBackupPath, envPath)
            fs.unlinkSync(envBackupPath)
        }
    } catch (_) {}

    // Clean up flags that might affect subsequent runtime runs
    const sleepFlag = path.resolve('./storage/sleep.flag')
    if (fs.existsSync(sleepFlag)) {
        try { fs.unlinkSync(sleepFlag) } catch (_) {}
    }
    const restartFile = path.resolve('./storage/restart.json')
    if (fs.existsSync(restartFile)) {
        try { fs.unlinkSync(restartFile) } catch (_) {}
    }
}

export async function cleanupDatabaseFixture() {
    try {
        const { memoryService } = await import('../../src/services/memory.js')
        if (memoryService?.db && memoryService.db.open) memoryService.db.close()
    } catch (_) {}
    try {
        const { db } = await import('../../src/services/db.js')
        if (db && db.open) db.close()
    } catch (_) {}
    try {
        if (fs.existsSync(TEMP_DB_PATH)) fs.unlinkSync(TEMP_DB_PATH)
        if (fs.existsSync(`${TEMP_DB_PATH}-wal`)) fs.unlinkSync(`${TEMP_DB_PATH}-wal`)
        if (fs.existsSync(`${TEMP_DB_PATH}-shm`)) fs.unlinkSync(`${TEMP_DB_PATH}-shm`)
    } catch (_) {}
}
