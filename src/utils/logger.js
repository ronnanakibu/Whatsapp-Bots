// src/utils/logger.js
// Terminal logger dengan warna, timestamp, dan per-module tracking
// Setiap proses bot keliatan jelas di terminal

import pino from 'pino'
import pinoPretty from 'pino-pretty'
import fs from 'fs'

// ─────────────────────────────────────────────
// AUTO-CREATE REQUIRED DIRS
// ─────────────────────────────────────────────

const requiredDirs = [
    './storage/logs',
    './storage/sessions',
    './storage/database',
    './storage/media'
]
for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const isProduction = process.env.NODE_ENV === 'production'
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'trace'

// ─────────────────────────────────────────────
// ANSI COLOR CODES — untuk terminal raw logging
// ─────────────────────────────────────────────

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',

    // Background
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
}

// ─────────────────────────────────────────────
// LEVEL CONFIG
// ─────────────────────────────────────────────

const LEVEL_CONFIG = {
    trace: { label: 'TRACE', color: C.gray, bg: '', icon: '·' },
    debug: { label: 'DEBUG', color: C.cyan, bg: '', icon: '✧' },
    info: { label: 'INFO ', color: C.green, bg: '', icon: '●' },
    warn: { label: 'WARN ', color: C.yellow, bg: '', icon: '▲' },
    error: { label: 'ERROR', color: C.red, bg: C.bgRed, icon: '✖' },
    fatal: { label: 'FATAL', color: C.white, bg: C.bgRed, icon: '☠' },
}

// ─────────────────────────────────────────────
// MODULE COLOR MAP — tiap modul punya warna sendiri
// ─────────────────────────────────────────────

const MODULE_COLORS = {
    'bot': C.cyan,
    'connection': C.blue,
    'loader': C.magenta,
    'handler': C.yellow,
    'command': C.green,
    'ai': C.magenta,
    'memory': C.cyan,
    'media': C.blue,
    'mediacache': C.blue,
    'viewonce': C.magenta,
    'revoke': C.red,
    'edit': C.yellow,
    'interactive': C.cyan,
    'store': C.gray,
    'reminder': C.yellow,
    'admin': C.red,
    'seamless': C.gray,
    'scheduler': C.yellow,
}


function getModuleColor(module) {
    return MODULE_COLORS[module?.toLowerCase()] ?? C.white
}

// ─────────────────────────────────────────────
// TIMESTAMP
// ─────────────────────────────────────────────

function ts() {
    return new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })
}

// ─────────────────────────────────────────────
// WHATSAPP CHANNEL LOGGER QUEUE & FLUSHER
// ─────────────────────────────────────────────

let sockInstance = null
let logBuffer = []
let flushTimeout = null
let isFlushing = false
let isLogging = false // Mencegah infinite loop logging re-entrant

// Error logger buffer to send only errors/fatal errors directly to owner
let errorBuffer = []
let errorFlushTimeout = null
let isErrorFlushing = false

function sendErrorToOwner(text) {
    const ownerRaw = process.env.OWNER_NUMBER
    if (!ownerRaw || !sockInstance || isLogging) return

    errorBuffer.push(text)

    if (!errorFlushTimeout && !isErrorFlushing) {
        errorFlushTimeout = setTimeout(flushErrorsToOwner, 2000)
    }
}

async function flushErrorsToOwner() {
    errorFlushTimeout = null
    if (errorBuffer.length === 0 || !sockInstance) return

    isErrorFlushing = true
    const batch = [...errorBuffer]
    errorBuffer = []

    isLogging = true
    try {
        const ownerRaw = process.env.OWNER_NUMBER || ''
        const owners = ownerRaw.split(',').map(n => n.trim()).filter(Boolean)
        
        for (const owner of owners) {
            const formattedJid = owner.includes('@') ? owner : `${owner.replace(/[^0-9]/g, '')}@s.whatsapp.net`
            const messageText = `⚠️ *[ALERT ERROR BOT]*\n\n${batch.join('\n\n')}`
            await sockInstance.sendMessage(formattedJid, { text: messageText })
        }
    } catch (err) {
        console.error('❌ [ErrorLogger] Gagal mengirim error log ke owner:', err.message)
    } finally {
        isLogging = false
        isErrorFlushing = false
        if (errorBuffer.length > 0) {
            errorFlushTimeout = setTimeout(flushErrorsToOwner, 2000)
        }
    }
}

export function setSocket(sock) {
    sockInstance = sock
}

export function getSocket() {
    return sockInstance
}

function sendWhatsAppLog(text) {
    const logJid = process.env.LOG_CHANNEL_JID
    if (!logJid || !sockInstance || isLogging) return

    logBuffer.push(text)

    if (!flushTimeout && !isFlushing) {
        flushTimeout = setTimeout(flushLogs, 2500)
    }
}

async function flushLogs() {
    flushTimeout = null
    if (logBuffer.length === 0 || !sockInstance) return

    isFlushing = true
    const currentBatch = [...logBuffer]
    logBuffer = []

    isLogging = true
    try {
        const logJid = process.env.LOG_CHANNEL_JID
        if (logJid) {
            const messageText = currentBatch.join('\n')
            await sockInstance.sendMessage(logJid, { text: messageText })
        }
    } catch (err) {
        console.error('❌ [ChannelLogger] Gagal flush log ke channel:', err.message)
    } finally {
        isLogging = false
        isFlushing = false
        if (logBuffer.length > 0) {
            flushTimeout = setTimeout(flushLogs, 2500)
        }
    }
}

export async function flushLogsImmediately() {
    if (logBuffer.length === 0 || !sockInstance) return

    if (flushTimeout) {
        clearTimeout(flushTimeout)
        flushTimeout = null
    }

    isFlushing = true
    const currentBatch = [...logBuffer]
    logBuffer = []

    isLogging = true
    try {
        const logJid = process.env.LOG_CHANNEL_JID
        if (logJid) {
            const messageText = currentBatch.join('\n')
            await sockInstance.sendMessage(logJid, { text: messageText })
        }
    } catch (err) {
        console.error('❌ [ChannelLogger] Gagal flush cepat log ke channel:', err.message)
    } finally {
        isLogging = false
        isFlushing = false
    }
}

// ─────────────────────────────────────────────
// TELEMETRY LOG LISTENERS (SOCKET.IO INTEGRATION)
// ─────────────────────────────────────────────

const logListeners = []
const messageListeners = []
const logHistory = []
const MAX_LOG_HISTORY = 100

export function getLogHistory() {
    return logHistory
}

export function addLogListener(cb) {
    if (typeof cb === 'function') logListeners.push(cb)
}
export function removeLogListener(cb) {
    const idx = logListeners.indexOf(cb)
    if (idx !== -1) logListeners.splice(idx, 1)
}

export function addMessageListener(cb) {
    if (typeof cb === 'function') messageListeners.push(cb)
}
export function removeMessageListener(cb) {
    const idx = messageListeners.indexOf(cb)
    if (idx !== -1) messageListeners.splice(idx, 1)
}

const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')

// Hook process.stdout.write
const consoleLogPath = './storage/logs/console.log'
const consoleLogStream = fs.createWriteStream(consoleLogPath, { flags: 'a' })
consoleLogStream.on('error', () => {
    // Abaikan write error (misal disk penuh / ENOSPC) agar proses bot tidak crash
})
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, encoding, callback) => {
    const str = chunk ? chunk.toString() : ''
    const plainText = stripAnsi(str).trim()
    if (plainText) {
        logHistory.push(plainText)
        if (logHistory.length > MAX_LOG_HISTORY) {
            logHistory.shift()
        }
        for (const listener of logListeners) {
            try { listener(plainText) } catch (err) {}
        }
        try {
            consoleLogStream.write(plainText + '\n')
        } catch (_) {}
    }
    return originalWrite(chunk, encoding, callback)
}


// ─────────────────────────────────────────────
// CORE RAW LOGGER — langsung ke stdout, tanpa pino
// Dipakai untuk log yang butuh format custom & warna
// ─────────────────────────────────────────────

function rawLog(level, module, ...args) {
    const cfg = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.info
    const modColor = getModuleColor(module)
    const modLabel = module ? `${modColor}${module.toLowerCase().padEnd(10)}${C.reset}` : '          '

    const timestamp = `${C.gray}${ts()}${C.reset}`
    const levelStr = `${cfg.color}${cfg.label.toLowerCase()}${C.reset}`

    const message = args.map(a =>
        typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a)
    ).join(' ')

    process.stdout.write(
        `${timestamp}  ${levelStr}  ${modLabel} ${C.dim}›${C.reset} ${message}\n`
    )

    // Kirim ke WhatsApp Channel (kecuali trace/debug agar tidak spamming/rate limit)
    if (level !== 'trace' && level !== 'debug') {
        const logMsg = `${cfg.icon} *[${level.toUpperCase()}]* ${module ? `[${module.toUpperCase()}] ` : ''}${message}`
        sendWhatsAppLog(logMsg)
        
        // Kirim log error / fatal langsung ke WhatsApp owner
        if (level === 'error' || level === 'fatal') {
            sendErrorToOwner(logMsg)
        }
    }
}

// ─────────────────────────────────────────────
// PINO LOGGER — untuk structured JSON di production
// ─────────────────────────────────────────────

export const logger = isProduction
    ? pino({ level: LOG_LEVEL }, pinoPretty({
        colorize: false,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
        destination: './storage/logs/app.log'
    }))
    : pino({ level: LOG_LEVEL }, pinoPretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
    }))

// ─────────────────────────────────────────────
// BOT LOGGER — custom pretty logger untuk dev
// Ini yang keliatan di terminal saat develop
// ─────────────────────────────────────────────

export const botLogger = {
    // ── Generic levels ──
    trace: (module, ...args) => rawLog('trace', module, ...args),
    debug: (module, ...args) => rawLog('debug', module, ...args),
    info: (module, ...args) => rawLog('info', module, ...args),
    warn: (module, ...args) => rawLog('warn', module, ...args),
    error: (module, ...args) => rawLog('error', module, ...args),
    fatal: (module, ...args) => rawLog('fatal', module, ...args),

    // ── Specialized event loggers ──

    /** Bot startup / system events */
    system: (msg) => {
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.cyan}system${C.reset}     ${C.dim}›${C.reset} ${msg}\n`
        )
        sendWhatsAppLog(`🤖 *[SYSTEM]* ${msg}`)
    },

    /** Incoming message */
    message: ({ sender, type, body, isGroup, chatId }) => {
        // Abaikan protocolMessage (misal keepalive / ack) agar log tidak berantakan
        if (type === 'protocolMessage') return

        const bodyPreview = body ? (body.length > 50 ? body.slice(0, 50) + '…' : body) : ''
        const scope = isGroup ? `${C.yellow}group${C.reset} ${C.dim}${chatId.split('@')[0]}${C.reset}` : `${C.green}dm${C.reset}    ${C.dim}${sender.split('@')[0]}${C.reset}`
        
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.blue}inbox${C.reset}      ${C.dim}›${C.reset} [${scope}] ${C.cyan}${type}${C.reset}${bodyPreview ? ` ${C.white}"${bodyPreview}"${C.reset}` : ''}\n`
        )
        
        // Broadcast to listeners for Message Observatory
        for (const listener of messageListeners) {
            try {
                listener({ sender, type, body: bodyPreview, isGroup, chatId })
            } catch (err) {}
        }
    },

    /** Command execution */
    command: (name, sender, args = []) => {
        const senderId = sender.split('@')[0].split(':')[0]
        const argsStr = args.length ? ` ${C.dim}${args.join(' ')}${C.reset}` : ''
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.green}command${C.reset}    ${C.dim}›${C.reset} ${C.bold}${name}${C.reset}${argsStr} ${C.dim}(by ${senderId})${C.reset}\n`
        )
        sendWhatsAppLog(`🚀 *[CMD]* ${name} ← ${sender} ${args.length ? `[${args.join(', ')}]` : ''}`)
    },

    /** Command result */
    commandDone: (name, ms) => {
        const speed = ms < 500 ? C.green : ms < 2000 ? C.yellow : C.red
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.green}success${C.reset}    ${C.dim}›${C.reset} ${name} in ${speed}${ms}ms${C.reset}\n`
        )
        sendWhatsAppLog(`✅ *[DONE]* ${name} (${ms}ms)`)
    },

    /** AI call */
    ai: (provider, model, chatId, ms = null) => {
        const target = chatId.split('@')[0]
        const msStr = ms !== null ? ` ${C.dim}(${ms}ms)${C.reset}` : ''
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.magenta}neural${C.reset}     ${C.dim}›${C.reset} ${C.bold}${model}${C.reset} ${C.dim}→ ${target}${C.reset}${msStr}\n`
        )
        sendWhatsAppLog(`🤖 *[AI]* ${provider}/${model} → ${chatId}${ms !== null ? ` (${ms}ms)` : ''}`)
    },

    /** AI route trigger (seamless/mention/dm) */
    aiTrigger: (route, preview) => {
        const routeColors = { seamless: C.cyan, mention: C.yellow, dm: C.green }
        const color = routeColors[route] ?? C.white
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${color}${route.padEnd(10)}${C.reset} ${C.dim}›${C.reset} "${preview}"\n`
        )
        sendWhatsAppLog(`💬 *[${route.toUpperCase()}]* "${preview}"`)
    },

    /** Admin/group action */
    admin: (action, target, by) => {
        const t = target.split('@')[0]
        const b = by.split('@')[0]
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.red}admin${C.reset}      ${C.dim}›${C.reset} ${action} ${C.dim}target=${t} by=${b}${C.reset}\n`
        )
        sendWhatsAppLog(`👑 *[ADMIN]* ${action} → ${target} by ${by}`)
    },

    /** Reminder fired */
    reminder: (id, chatId) => {
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.yellow}reminder${C.reset}   ${C.dim}›${C.reset} #${id} → ${chatId.split('@')[0]}\n`
        )
        sendWhatsAppLog(`⏰ *[REMIND]* #${id} → ${chatId}`)
    },

    /** Media processing */
    media: (type, ms = null) => {
        const msStr = ms !== null ? ` in ${C.dim}${ms}ms${C.reset}` : ''
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.blue}media${C.reset}      ${C.dim}›${C.reset} processed ${type}${msStr}\n`
        )
        sendWhatsAppLog(`🎨 *[MEDIA]* ${type}${ms !== null ? ` (${ms}ms)` : ''}`)
    },

    /** Connection events */
    connect: (status, detail = '') => {
        const color = status === 'open' ? C.green : status === 'close' ? C.red : C.yellow
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${color}network${C.reset}    ${C.dim}›${C.reset} status=${status} ${C.dim}${detail}${C.reset}\n`
        )
        sendWhatsAppLog(`📡 *[CONN]* ${status.toUpperCase()} ${detail}`)
    },

    /** Error dengan stack trace opsional */
    err: (module, err, context = '') => {
        const errMsg = err instanceof Error ? err.message : String(err)
        const stack = err instanceof Error && err.stack
            ? `\n_${err.stack.slice(0, 500)}_`
            : ''
        process.stdout.write(
            `${C.gray}${ts()}${C.reset}  ${C.red}failure${C.reset}    ${C.dim}›${C.reset} [${module}] ${context ? C.dim + context + ' ' + C.reset : ''}${C.red}${errMsg}${C.reset}\n`
        )
        const logMsg = `❌ *[ERROR]* [${module.toUpperCase()}] ${context ? `(${context}) ` : ''}${errMsg}${stack}`
        sendWhatsAppLog(logMsg)
        sendErrorToOwner(logMsg)
    },
        )
        const logMsg = `❌ *[ERROR]* [${module.toUpperCase()}] ${context ? `(${context}) ` : ''}${errMsg}${stack}`
        sendWhatsAppLog(logMsg)
        // Kirim log error langsung ke WhatsApp owner
        sendErrorToOwner(logMsg)
    },

    /** Separator / section header */
    section: (title) => {
        const line = '─'.repeat(50)
        process.stdout.write(`\n${C.dim}${line}\n  ${title}\n${line}${C.reset}\n\n`)
        sendWhatsAppLog(`\n--- *${title}* ---\n`)
    },

    /** Raw divider */
    divider: () => {
        process.stdout.write(`${C.dim}${'─'.repeat(60)}${C.reset}\n`)
    }
}

// ─────────────────────────────────────────────
// CHILD LOGGERS — backward compat + module-specific
// ─────────────────────────────────────────────

export const connLogger = { ...logger.child({ module: 'connection' }), bot: (m, ...a) => botLogger.info('connection', m, ...a) }
export const cmdLogger = { ...logger.child({ module: 'commands' }), bot: (m, ...a) => botLogger.info('command', m, ...a) }
export const aiLogger = { ...logger.child({ module: 'ai' }), bot: (m, ...a) => botLogger.info('ai', m, ...a) }
export const mediaLogger = { ...logger.child({ module: 'media' }), bot: (m, ...a) => botLogger.info('media', m, ...a) }
export const adminLogger = { ...logger.child({ module: 'admin' }), bot: (m, ...a) => botLogger.info('admin', m, ...a) }