// src/core/bot.js
import dns from 'dns'
process.env.TZ = process.env.BOT_TIMEZONE || 'Asia/Jakarta'
dns.setDefaultResultOrder('ipv4first')

import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import qrcode from 'qrcode'
import 'dotenv/config'

import { loadCommands } from './loader.js'
import { store } from '../services/store.js'
import { handleIncomingMessage } from '../handlers/message.js'
import { handleRevokeMessage } from '../handlers/revoke.js'
import { logger, botLogger, setSocket } from '../utils/logger.js'
import { initReminderScheduler } from '../commands/general/remindme.js'
import { initWeatherScheduler } from '../commands/utility/cuaca.js'
import { initRecapScheduler } from '../commands/radio/recap.js'
import { startRadioServer, updateBotStatus } from '../server/radio.js'
import { metricsService } from '../services/metrics.js'

const pinoLogger = logger.child({ module: 'baileys' })

let reconnectCount = 0
const MAX_RECONNECT_ATTEMPTS = 5

// ─────────────────────────────────────────────
// ANTI-CRASH GLOBAL HANDLERS
// ─────────────────────────────────────────────

process.on('uncaughtException', (err) => {
    botLogger.err('bot', err, 'uncaughtException')
})

process.on('unhandledRejection', (reason) => {
    botLogger.err('bot', reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection')
})

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function startBot() {
    botLogger.section('BOT STARTUP')
    botLogger.system('Initializing...')

    // 1. Load all commands
    botLogger.system('Loading commands...')
    try {
        await loadCommands()
        botLogger.system('Commands loaded ✓')
        startRadioServer()
        botLogger.system('Radio server started ✓')
        
        // Start Discord Bot if token exists
        const { startDiscordBot } = await import('../discord/index.js')
        startDiscordBot()
        botLogger.system('Discord bot initialized ✓')
    } catch (err) {
        botLogger.err('bot', err, 'loadCommands')
    }

    // 2. Fetch WA version
    let version = [2, 3000, 1017531287]
    try {
        const { version: latestVersion } = await fetchLatestBaileysVersion()
        version = latestVersion
        botLogger.system(`WhatsApp Web version: ${version.join('.')}`)
    } catch (err) {
        botLogger.warn('bot', `Failed to fetch WA version, using fallback: ${err.message}`)
    }

    // 3. Load auth state
    const sessionPath = process.env.SESSION_PATH || './storage/sessions'
    botLogger.system(`Loading session from: ${sessionPath}`)

    let state, saveCreds
    try {
        const auth = await useMultiFileAuthState(sessionPath)
        state = auth.state
        saveCreds = auth.saveCreds
        botLogger.system('Auth state loaded ✓')
    } catch (err) {
        botLogger.err('bot', err, 'useMultiFileAuthState')
        return
    }

    // 4. Create socket
    botLogger.system('Connecting to WhatsApp...')
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pinoLogger.child({ level: 'fatal' }), // Sembunyikan log internal Baileys yang nyepam
        printQRInTerminal: false, // kita handle manual
    })

    // Daftarkan socket instance ke logger untuk WhatsApp channel logging
    setSocket(sock)

    // Bind In-Memory Store
    store.bind(sock.ev)
    botLogger.system('Store bonded ✓')

    // 5. Pairing code (kalau ada BOT_NUMBER)
    const phoneNumber = process.env.BOT_NUMBER?.replace(/[^0-9]/g, '') ?? null
    if (phoneNumber && !state.creds?.registered) {
        botLogger.system(`Requesting pairing code for +${phoneNumber}...`)
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber)
                const formatted = code.match(/.{1,4}/g)?.join('-') ?? code
                process.stdout.write('\n')
                botLogger.section(`PAIRING CODE: ${formatted.toUpperCase()}`)
            } catch (err) {
                botLogger.err('bot', err, 'requestPairingCode')
            }
        }, 3000)
    }

    sock.ev.on('creds.update', saveCreds)

    // 6. Connection events
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr && !phoneNumber) {
            botLogger.system('QR Code generated — scan with WhatsApp:')
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (!err) process.stdout.write(url + '\n')
            })
            updateBotStatus('qr', qr)
        }

        if (connection === 'connecting') {
            botLogger.connect('connecting')
            metricsService.setWhatsAppStatus('connecting')
            updateBotStatus('connecting')
        }

        if (connection === 'open') {
            reconnectCount = 0
            botLogger.connect('open', `Logged in as ${sock.user?.name ?? sock.user?.id}`)
            metricsService.setWhatsAppStatus('online')
            botLogger.section('BOT READY 🚀')
            updateBotStatus('open')

            // Start reminder scheduler setelah connected
            initReminderScheduler(sock)
            botLogger.system('Reminder scheduler started ✓')

            // Start weather scheduler setelah connected
            initWeatherScheduler(sock)
            botLogger.system('Weather scheduler started ✓')

            // Start weekly recap scheduler setelah connected
            initRecapScheduler(sock)
            botLogger.system('Weekly recap scheduler started ✓')
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error
            const statusCode = new Boom(error)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            botLogger.connect('close', `status=${statusCode} | ${error?.message ?? 'unknown'}`)
            metricsService.setWhatsAppStatus('offline')
            updateBotStatus('close')

            if (shouldReconnect) {
                if (reconnectCount < MAX_RECONNECT_ATTEMPTS) {
                    reconnectCount++
                    const delay = Math.min(Math.pow(2, reconnectCount) * 1000, 30_000)
                    botLogger.warn('bot', `Reconnecting in ${delay / 1000}s (attempt ${reconnectCount}/${MAX_RECONNECT_ATTEMPTS})`)
                    setTimeout(() => startBot(), delay)
                } else {
                    botLogger.fatal('bot', 'Max reconnect attempts reached. Exiting for automatic daemon restart.')
                    process.exit(1)
                }
            } else {
                botLogger.warn('bot', 'Logged out. Delete session folder and restart.')
            }
        }
    })

    // 7. Message handler
    sock.ev.on('messages.upsert', async (m) => {
        await handleIncomingMessage(sock, m)
    })

    // 8. Revoke handler (Anti-Delete)
    sock.ev.on('messages.update', async (m) => {
        await handleRevokeMessage(sock, m)
    })

    // ─────────────────────────────────────────────
    // GRACEFUL SHUTDOWN
    // ─────────────────────────────────────────────
    
    const shutdown = async (signal) => {
        botLogger.warn('bot', `Received ${signal}. Gracefully shutting down...`)

        // Flush log terakhir ke channel WhatsApp secara instan sebelum koneksi terputus
        try {
            const { flushLogsImmediately } = await import('../utils/logger.js')
            await flushLogsImmediately()
        } catch (e) {
            console.error('❌ Gagal mengirim log shutdown:', e)
        }

        try {
            sock.end(undefined)
        } catch (_) {}
        process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
}

startBot()