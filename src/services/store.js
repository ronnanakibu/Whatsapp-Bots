import { makeInMemoryStore } from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'

const STORE_PATH = path.resolve('./storage/sessions/store.json')
const storeLogger = pino({ level: 'silent' }) // We don't want store logs spamming our console

// Buat store global
const store = makeInMemoryStore({ logger: storeLogger })

// Pastikan direktori storage ada
const dir = path.dirname(STORE_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

// Kalau ada file store sebelumnya, load
try {
    if (fs.existsSync(STORE_PATH)) {
        store.readFromFile(STORE_PATH)
        logger.info('📦 [Store] Previous message store loaded')
    }
} catch (err) {
    logger.error('❌ [Store] Failed to load store:', err.message)
}

// Simpan ke file tiap 10 detik biar sinkron dan gak makan RAM doang
setInterval(() => {
    try {
        store.writeToFile(STORE_PATH)
    } catch (e) {
        logger.error('❌ [Store] Failed to write store to file:', e.message)
    }
}, 10_000)

export { store }
