// src/core/bot.js
import dns from 'dns'
import fs from 'fs'
import path from 'path'
process.env.TZ = process.env.BOT_TIMEZONE || 'Asia/Jakarta'
dns.setDefaultResultOrder('ipv4first')
try {
    const { setGlobalDispatcher, Agent } = await import('undici')
    setGlobalDispatcher(new Agent({
        connect: {
            family: 4,
            timeout: 25000
        }
    }))
} catch (_) {}

import makeWASocket, {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion,
    fetchLatestWaWebVersion,
    Browsers
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
import { initStorySyncScheduler } from '../services/storySync.js'
import { initScheduleSync } from '../services/scheduleSync.js'
import { startRadioServer, stopRadioServer, updateBotStatus } from '../server/radio.js'
import { markSessionCredsUpdated } from '../server/whatsappOps.js'
import { metricsService } from '../services/metrics.js'
import { mediaCache } from '../services/mediaCache.js'
import { inboxService } from '../services/inbox.js'
import { assertSingleProcessTopology, acquireRuntimeLease, releaseRuntimeLease } from '../services/runtimeSingleton.js'
import { sessionSync } from '../services/sessionSync.js'
import { db as sqliteDb, dbService } from '../services/db.js'
import { isOwner } from '../utils/permissions.js'

const pinoLogger = logger.child({ module: 'baileys' })

let reconnectCount = 0
let isStopping = false
let currentSocket = null
let isInitialized = false
let isShutdownRegistered = false
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
// ACTIVE MEMORY WATCHDOG (Render 512MB RAM Guard)
// ─────────────────────────────────────────────

setInterval(async () => {
    try {
        const mem = process.memoryUsage()
        const rssMB = Math.round(mem.rss / (1024 * 1024))
        const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024))

        // Proactive threshold: Sweep when RSS > 750MB or HeapUsed > 550MB (tuned for 2GB VPS)
        if ((rssMB > 750 || heapUsedMB > 550) && typeof global.gc === 'function') {
            botLogger.warn?.('system', `[MemoryGuard] Elevated RAM at ${rssMB}MB RSS (${heapUsedMB}MB Heap). Cleaning sharp cache & running GC...`)
            try {
                const sharp = (await import('sharp')).default
                if (sharp?.cache) sharp.cache(false)
            } catch (_) {}
            global.gc()
        }
    } catch (_) {}
}, 30000)

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function startBot() {
    botLogger.section('BOT STARTUP')
    botLogger.system('Initializing...')

    // 0. Enforce single-writer topology, then bind port & load commands (only on initial bootstrap)
    if (!isInitialized) {
        try {
            assertSingleProcessTopology()
            const lease = acquireRuntimeLease({ db: sqliteDb })
            if (!lease.acquired) {
                botLogger.fatal('bot', `Refusing duplicate active instance (${lease.code}; holder pid=${lease.holder?.pid ?? 'unknown'} host=${lease.holder?.hostname ?? 'unknown'}).`)
                process.exit(1)
            }
            if (lease.recoveredFromPid) {
                botLogger.warn('bot', `Recovered stale singleton lease from exited local PID ${lease.recoveredFromPid}.`)
            }
        } catch (err) {
            botLogger.fatal('bot', err.message)
            process.exit(1)
        }

        try {
            startRadioServer()
            botLogger.system('Web & Radio server started (Instant Port Binding) ✓')
        } catch (err) {
            botLogger.err('server', err, 'startRadioServer')
        }

        // 1. Load all commands
        botLogger.system('Loading commands...')
        try {
            await loadCommands()
            botLogger.system('Commands loaded ✓')
            
            // Start Discord Bot if token exists
            const { startDiscordBot } = await import('../discord/index.js')
            startDiscordBot()
            botLogger.system('Discord bot initialized ✓')
        } catch (err) {
            botLogger.err('bot', err, 'loadCommands')
        }
        isInitialized = true
    }

    // 2. Fetch WA live version dynamically with fallbacks
    let version = [2, 3000, 1056453267]
    try {
        const { version: liveVersion } = await fetchLatestWaWebVersion()
        if (liveVersion) {
            version = liveVersion
            botLogger.system(`WhatsApp Web live version: ${version.join('.')}`)
        }
    } catch (err) {
        try {
            const { version: baileysVersion } = await fetchLatestBaileysVersion()
            if (baileysVersion) {
                version = baileysVersion
                botLogger.system(`WhatsApp Web fallback version: ${version.join('.')}`)
            }
        } catch (_) {
            botLogger.warn('bot', `Failed to fetch WA version, using hardcoded fallback: ${err.message}`)
        }
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

    // Clean up previous socket if reconnecting
    if (currentSocket) {
        try {
            currentSocket.ws?.close()
            currentSocket.ev?.removeAllListeners()
        } catch (_) {}
    }

    // 4. Create socket with cacheable signal key store
    botLogger.system('Connecting to WhatsApp...')
    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger)
        },
        logger: pinoLogger.child({ level: 'fatal' }), // Sembunyikan log internal Baileys yang nyepam
        printQRInTerminal: false, // kita handle manual
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        getMessage: async (key) => {
            const msg = await store.loadMessage(key.remoteJid, key.id)
            return msg?.message || undefined
        }
    })
    currentSocket = sock


    // Daftarkan socket instance ke logger untuk WhatsApp channel logging
    setSocket(sock)

    // Hook socket outgoing media untuk universal real-time Telegram archiving
    mediaCache.hookSocketOutgoing(sock)

    // Hook outgoing bot replies for durable Inbox persistence
    inboxService.hookBaileysSocket(sock)

    // Bind In-Memory Store
    store.bind(sock.ev)
    botLogger.system('Store bonded ✓')

    // 5. Pairing code (kalau ada BOT_NUMBER)
    const rawBotNumber = (process.env.BOT_NUMBER ?? '').split(',')[0] ?? ''
    const phoneNumber = rawBotNumber.replace(/[^0-9]/g, '') || null
    const useQR = process.env.PRINTED_QR === 'true'

    if (phoneNumber && !state.creds?.registered && !useQR) {
        botLogger.system(`Requesting pairing code for +${phoneNumber}...`)
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber)
                const formatted = code.match(/.{1,4}/g)?.join('-') ?? code
                process.stdout.write('\n')
                botLogger.section(`PAIRING CODE: ${formatted.toUpperCase()}`)
                updateBotStatus('pairing', formatted.toUpperCase())
            } catch (err) {
                botLogger.err('bot', err, 'requestPairingCode')
            }
        }, 3000)
    }

    sock.ev.on('creds.update', async () => {
        await saveCreds()
        markSessionCredsUpdated()
        try {
            sessionSync.triggerDebouncedBackup(30000)
        } catch (_) {}
    })

    // 6. Connection events
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && (!phoneNumber || useQR)) {
            botLogger.system('QR Code generated — scan with WhatsApp:')
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (!err) process.stdout.write(url + '\n')
            })
            updateBotStatus('qr', qr)
            try {
                await qrcode.toFile('./storage/qr.png', qr, { width: 512, margin: 2 })
            } catch (_) {}
        }

        if (connection === 'connecting') {
            botLogger.connect('connecting')
            metricsService.setWhatsAppStatus('connecting')
            updateBotStatus('connecting', null, { reconnectCount, maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS })
        }

        if (connection === 'open') {
            try {
                const qrFile = path.resolve('./storage/qr.png')
                if (fs.existsSync(qrFile)) fs.unlinkSync(qrFile)
            } catch (_) {}
            reconnectCount = 0
            botLogger.connect('open', `Logged in as ${sock.user?.name ?? sock.user?.id}`)
            metricsService.setWhatsAppStatus('online')
            botLogger.section('BOT READY 🚀')
            updateBotStatus('open', null, { reconnectCount: 0, maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS })

            // Immediately back up the authenticated session & database to Hugging Face Dataset
            try {
                sessionSync.backupAll('initial_connect').catch(e => {
                    botLogger.warn('session-sync', `Initial backup warning: ${e.message}`)
                })
                sessionSync.initScheduler(30 * 60 * 1000)
            } catch (_) {}

            // Start reminder scheduler setelah connected
            initReminderScheduler(sock)
            botLogger.system('Reminder scheduler started ✓')

            // Start weather scheduler setelah connected
            initWeatherScheduler(sock)
            botLogger.system('Weather scheduler started ✓')

            // Start weekly recap scheduler setelah connected
            initRecapScheduler(sock)
            botLogger.system('Weekly recap scheduler started ✓')

            // Start Instagram Story auto-archive scheduler setelah connected
            initStorySyncScheduler(sock)
            botLogger.system('Instagram Story auto-archive scheduler started ✓')

            // Start schedule sync
            initScheduleSync(sock)
            botLogger.system('Schedule sync scheduler started ✓')

            // Start HF Space real-time log streamer
            import('../services/hfLogsStreamer.js').then(({ hfLogsStreamer }) => {
                hfLogsStreamer.startStreaming()
                botLogger.system('Hugging Face live log streamer started ✓')
            }).catch(err => {
                botLogger.warn('hf-logs', `Failed to start HF log streamer: ${err.message}`)
            })
        }

        if (connection === 'close') {
            try {
                const qrFile = path.resolve('./storage/qr.png')
                if (fs.existsSync(qrFile)) fs.unlinkSync(qrFile)
            } catch (_) {}
            const error = lastDisconnect?.error
            const statusCode = new Boom(error)?.output?.statusCode
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401
            const shouldReconnect = !isLoggedOut

            botLogger.connect('close', `status=${statusCode} | ${error?.message ?? 'unknown'}`)
            metricsService.setWhatsAppStatus('offline')
            updateBotStatus(isLoggedOut ? 'logged_out' : 'close', null, {
                statusCode,
                reason: error?.message ?? 'unknown',
                isLoggedOut,
                reconnectCount,
                maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS
            })

            // 401 Logged Out / Stale Session auto-recovery
            if (isLoggedOut && !isStopping) {
                botLogger.warn('bot', 'Session logged out (status 401). Purging stale session locally and from cloud storage...')
                try {
                    sock.ws?.close()
                    sock.ev?.removeAllListeners()
                } catch (_) {}

                try {
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true })
                        botLogger.system('Local session credentials cleared ✓')
                    }
                } catch (e) {
                    botLogger.warn('bot', `Failed to delete local session: ${e.message}`)
                }

                try {
                    await sessionSync.deleteCloudSession()
                } catch (_) {}

                reconnectCount = 0
                botLogger.system('Restarting connection in 3s to request new pairing code / QR...')
                setTimeout(() => {
                    startBot()
                }, 3000)
                return
            }

            if (shouldReconnect && !isStopping) {
                if (reconnectCount < MAX_RECONNECT_ATTEMPTS) {
                    reconnectCount++
                    const delay = Math.min(Math.pow(2, reconnectCount) * 1000, 30_000)
                    botLogger.warn('bot', `Reconnecting in ${delay / 1000}s (attempt ${reconnectCount}/${MAX_RECONNECT_ATTEMPTS})`)
                    updateBotStatus('reconnecting', null, {
                        statusCode,
                        reason: error?.message ?? 'unknown',
                        reconnectCount,
                        maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS
                    })
                    setTimeout(() => startBot(), delay)
                } else {
                    botLogger.fatal('bot', 'Max reconnect attempts reached. Exiting for automatic daemon restart.')
                    process.exit(1)
                }
            } else {
                botLogger.warn('bot', 'Connection closed without auto-reconnect.')
            }
        }
    })

    // 7. Message handler
    sock.ev.on('messages.upsert', async (m) => {
        await handleIncomingMessage(sock, m)
    })

    // 8. Revoke handler (Anti-Delete) + Inbox delivery/receipt updates
    sock.ev.on('messages.update', async (m) => {
        inboxService.ingestBaileysStatusUpdate(m)
        await handleRevokeMessage(sock, m)
    })

    // 9. Owner Activity tracking on Read Receipts + Inbox receipts
    sock.ev.on('message-receipt.update', async (receipts) => {
        try {
            if (!Array.isArray(receipts)) return
            for (const r of receipts) {
                const chatJid = r.key?.remoteJid
                if (chatJid && r.key?.id) {
                    if (r.receipt?.readTimestamp || r.receipt?.playedTimestamp) {
                        inboxService.updateMessageStatus(chatJid, r.key.id, 'READ')
                    } else if (r.receipt?.receiptTimestamp) {
                        inboxService.updateMessageStatus(chatJid, r.key.id, 'DELIVERED')
                    }
                }
                if (chatJid && chatJid.endsWith('@g.us')) {
                    const user = r.receipt?.userJid || r.key?.participant
                    if (r.key?.fromMe || (user && isOwner(user))) {
                        const ts = r.receipt?.readTimestamp ? (typeof r.receipt.readTimestamp === 'object' ? r.receipt.readTimestamp.low : Number(r.receipt.readTimestamp)) : Math.floor(Date.now() / 1000)
                        dbService.trackOwnerGroupActivity(chatJid, ts)
                    }
                }
            }
        } catch (_) {}
    })

    // 10. Owner Activity tracking on Chats Update (e.g. unread count reset to 0)
    sock.ev.on('chats.update', async (chats) => {
        try {
            if (!Array.isArray(chats)) return
            for (const chat of chats) {
                if (chat.id && chat.id.endsWith('@g.us')) {
                    if (chat.unreadCount === 0) {
                        dbService.trackOwnerGroupActivity(chat.id, Math.floor(Date.now() / 1000))
                    }
                }
            }
        } catch (_) {}
    })

    registerGracefulShutdown()
}

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN (Registered once at process level)
// ─────────────────────────────────────────────

function registerGracefulShutdown() {
    if (isShutdownRegistered) return
    isShutdownRegistered = true

    const shutdown = async (signal) => {
        botLogger.warn('bot', `Received ${signal}. Gracefully shutting down...`)

        // Flush log terakhir ke channel WhatsApp secara instan sebelum koneksi terputus
        try {
            const { flushLogsImmediately } = await import('../utils/logger.js')
            await flushLogsImmediately()
        } catch (e) {
            console.error('❌ Gagal mengirim log shutdown:', e)
        }

        // Backup sesi WhatsApp & database ke Hugging Face Dataset sebelum shutdown
        try {
            const { sessionSync } = await import('../services/sessionSync.js')
            await sessionSync.backupAll('shutdown')
        } catch (_) {}

        try {
            stopRadioServer()
        } catch (_) {}

        try {
            currentSocket?.end(undefined)
        } catch (_) {}

        try {
            releaseRuntimeLease()
        } catch (_) {}

        try {
            if (sqliteDb && typeof sqliteDb.close === 'function' && sqliteDb.open !== false) {
                sqliteDb.close()
            }
        } catch (_) {}
        process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
}

startBot()