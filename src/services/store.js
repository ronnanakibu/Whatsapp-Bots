import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'

const STORE_PATH = path.resolve('./storage/sessions/store.json')
const MAX_MESSAGES_PER_CHAT = 100

class CustomInMemoryStore {
    constructor() {
        this.messages = {} // { [jid: string]: Message[] }
    }

    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                if (!msg.key.remoteJid) continue
                const jid = msg.key.remoteJid
                if (!this.messages[jid]) this.messages[jid] = []
                
                this.messages[jid].push(msg)
                
                // Keep only the latest messages to prevent memory leaks
                if (this.messages[jid].length > MAX_MESSAGES_PER_CHAT) {
                    this.messages[jid].shift()
                }
            }
        })
    }

    loadMessage(jid, id) {
        const chatMessages = this.messages[jid] || []
        return chatMessages.find(m => m.key.id === id) || null
    }

    writeToFile(filepath) {
        fs.writeFileSync(filepath, JSON.stringify(this.messages), 'utf8')
    }

    readFromFile(filepath) {
        try {
            const data = fs.readFileSync(filepath, 'utf8')
            this.messages = JSON.parse(data)
        } catch (e) {
            // Ignore error
        }
    }
}

const store = new CustomInMemoryStore()

// Ensure storage directory exists
const dir = path.dirname(STORE_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

// Load previous store if exists
try {
    if (fs.existsSync(STORE_PATH)) {
        store.readFromFile(STORE_PATH)
        logger.info('📦 [Store] Previous message store loaded')
    }
} catch (err) {
    logger.error('❌ [Store] Failed to load store:', err.message)
}

// Save to file every 10 seconds
setInterval(() => {
    try {
        store.writeToFile(STORE_PATH)
    } catch (e) {
        logger.error('❌ [Store] Failed to write store to file:', e.message)
    }
}, 10_000)

export { store }
