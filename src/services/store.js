import { dbService } from './db.js'
import { logger } from '../utils/logger.js'
import { isViewOnceMessage } from '../utils/message.js'


const MAX_IN_MEMORY_PER_CHAT = 200

class DatabaseBackedStore {
    constructor() {
        this.memoryCache = new Map() // chatJid -> Map(msgId -> msg)
    }

    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                if (!msg?.key?.remoteJid || !msg.message) continue
                const jid = msg.key.remoteJid
                const id = msg.key.id
                if (!id) continue

                // 1. Save to Fast In-Memory Cache
                if (!this.memoryCache.has(jid)) {
                    this.memoryCache.set(jid, new Map())
                }
                const chatMap = this.memoryCache.get(jid)
                chatMap.set(id, msg)

                // Evict oldest in memory if exceeded
                if (chatMap.size > MAX_IN_MEMORY_PER_CHAT) {
                    const firstKey = chatMap.keys().next().value
                    chatMap.delete(firstKey)
                }

                // 2. Persist to SQLite Database (No size limit!)
                try {
                    const sender = msg.key.participant || (msg.key.fromMe ? 'bot' : jid)
                    const pushName = msg.pushName || null
                    const mType = Object.keys(msg.message || {})[0] || 'unknown'
                    const body =
                        msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || msg.message?.imageMessage?.caption
                        || msg.message?.videoMessage?.caption
                        || msg.message?.documentMessage?.caption
                        || ''

                    const isViewOnce = isViewOnceMessage(msg)


                    dbService.saveMessage({
                        id,
                        chatJid: jid,
                        senderJid: sender,
                        pushName,
                        messageType: mType,
                        body,
                        rawMessage: JSON.stringify(msg),
                        mediaPath: null,
                        isViewOnce
                    })
                } catch (err) {
                    logger.debug?.(`[Store] Failed to persist message ${id}: ${err.message}`)
                }
            }
        })

        // Auto-prune messages older than 14 days every 24 hours
        setInterval(() => {
            try {
                dbService.pruneMessages(14)
            } catch (_) {}
        }, 24 * 60 * 60 * 1000)
    }

    loadMessage(jid, id) {
        if (!id) return null

        // 1. Try In-Memory Cache first
        if (jid && this.memoryCache.has(jid)) {
            const cached = this.memoryCache.get(jid).get(id)
            if (cached) return cached
        }

        // Search all in-memory chats if jid not matched
        for (const chatMap of this.memoryCache.values()) {
            if (chatMap.has(id)) return chatMap.get(id)
        }

        // 2. Fallback to SQLite Database
        try {
            const row = dbService.getMessage(jid, id)
            if (row && row.raw_message) {
                const parsed = JSON.parse(row.raw_message)
                if (row.media_path) {
                    parsed._localMediaPath = row.media_path
                }
                parsed._isViewOnce = Boolean(row.is_view_once)
                return parsed
            }
        } catch (err) {
            logger.debug?.(`[Store] Error loading message ${id} from DB: ${err.message}`)
        }

        return null
    }
}

export const store = new DatabaseBackedStore()
