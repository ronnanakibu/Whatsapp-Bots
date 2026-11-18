// src/services/batchSticker.js
import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import mediaService from './media.js'
import { logger, botLogger } from '../utils/logger.js'
import { unwrapMessage, getCleanQuoted } from '../utils/message.js'

const SETTINGS_FILE = path.resolve('./storage/bot_settings.json')

class BatchStickerService {
    constructor() {
        this.settings = this.loadSettings()
        // Rolling buffer of recent incoming media: key = `${from}:${sender}` -> array of message objects with timestamp
        this.recentMediaMap = new Map()
        // Active batch collectors: key = `${from}:${sender}` -> { debounceTimer, resolve, messages }
        this.activeBatches = new Map()
        // Set of sender JIDs currently sending media batches, used to exempt from anti-spam
        this.activeBatchSenders = new Set()

        // Clean up old entries in recentMediaMap every 60s
        setInterval(() => this.cleanupRecentMedia(), 60000)
    }

    loadSettings() {
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
            }
        } catch (_) {}
        return {
            batchStickerEnabled: true, // Default ON
            groupSettings: {} // Per-group override: { [chatId]: boolean }
        }
    }

    saveSettings() {
        try {
            const dir = path.dirname(SETTINGS_FILE)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf8')
        } catch (e) {
            logger.error(`[BatchSticker] Failed to save settings: ${e.message}`)
        }
    }

    /**
     * Check if batch sticker processing is enabled for a given chat
     */
    isEnabled(chatId = null) {
        if (chatId && this.settings.groupSettings && typeof this.settings.groupSettings[chatId] === 'boolean') {
            return this.settings.groupSettings[chatId]
        }
        return this.settings.batchStickerEnabled ?? true
    }

    /**
     * Toggle or set batch sticker processing state
     */
    setEnabled(chatId, state) {
        if (chatId && chatId.endsWith('@g.us')) {
            if (!this.settings.groupSettings) this.settings.groupSettings = {}
            this.settings.groupSettings[chatId] = Boolean(state)
        } else {
            this.settings.batchStickerEnabled = Boolean(state)
        }
        this.saveSettings()
        return this.isEnabled(chatId)
    }

    /**
     * Helper to check if message contains media
     */
    isMediaMessage(msg) {
        if (!msg?.message) return false
        const unwrapped = unwrapMessage(msg.message)
        if (!unwrapped) return false
        const type = Object.keys(unwrapped)[0]
        if (type === 'imageMessage' || type === 'videoMessage' || type === 'ptvMessage' || type === 'stickerMessage') return true
        if (type === 'documentMessage') {
            const mime = unwrapped.documentMessage?.mimetype || ''
            return mime.startsWith('image/') || mime.startsWith('video/')
        }
        return false
    }

    /**
     * Check if media is animated
     */
    isAnimated(unwrapped, buffer = null) {
        if (!unwrapped) return false
        const type = Object.keys(unwrapped)[0]
        if (type === 'videoMessage' || type === 'ptvMessage') return true
        if (type === 'stickerMessage' && unwrapped.stickerMessage?.isAnimated) return true
        if (type === 'documentMessage') {
            const mime = unwrapped.documentMessage?.mimetype || ''
            return mime.startsWith('video/')
        }
        if (buffer && buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
            return buffer.includes(Buffer.from('ANIM'))
        }
        return false
    }

    /**
     * Record an incoming media message in recent window
     */
    recordMedia(from, sender, msg) {
        if (!this.isMediaMessage(msg)) return
        const key = `${from}:${sender}`
        const now = Date.now()

        let list = this.recentMediaMap.get(key)
        if (!list) {
            list = []
            this.recentMediaMap.set(key, list)
        }

        // Avoid duplicate message keys
        if (!list.some(item => item.msg.key?.id === msg.key?.id)) {
            list.push({ msg, timestamp: now })
        }

        // Keep at most 100 recent media items within last 12 seconds
        const cutoff = now - 12000
        list = list.filter(item => item.timestamp > cutoff)
        if (list.length > 100) list = list.slice(-100)
        this.recentMediaMap.set(key, list)

        // If there's an active collecting batch for this sender, add directly
        const activeBatch = this.activeBatches.get(key)
        if (activeBatch) {
            if (!activeBatch.messages.some(m => m.key?.id === msg.key?.id)) {
                activeBatch.messages.push(msg)
            }
            // Reset debounce timer
            clearTimeout(activeBatch.debounceTimer)
            activeBatch.debounceTimer = setTimeout(() => {
                activeBatch.resolve()
            }, 1200)
        }
    }

    /**
     * Check whether to bypass anti-spam for an incoming message
     */
    shouldBypassSpam(from, sender, msg) {
        if (!this.isEnabled(from)) return false
        if (!this.isMediaMessage(msg)) return false

        const key = `${from}:${sender}`
        // If an active batch is currently collecting or processing
        if (this.activeBatchSenders.has(sender) || this.activeBatches.has(key)) {
            return true
        }

        // Or if multiple media from this sender have arrived in the last 3 seconds (album detection)
        const recent = this.recentMediaMap.get(key)
        if (recent && recent.length >= 2) {
            const recentCountInLast3s = recent.filter(r => Date.now() - r.timestamp < 3000).length
            if (recentCountInLast3s >= 2) {
                return true
            }
        }

        return false
    }

    cleanupRecentMedia() {
        const now = Date.now()
        const cutoff = now - 15000
        for (const [key, list] of this.recentMediaMap.entries()) {
            const filtered = list.filter(item => item.timestamp > cutoff)
            if (filtered.length === 0) {
                this.recentMediaMap.delete(key)
            } else {
                this.recentMediaMap.set(key, filtered)
            }
        }
    }

    /**
     * Main entry point when a sticker command (.s / .sticker) is triggered on a media message
     */
    async handleStickerCommand(ctx, options = {}) {
        const { msg, from, sender } = ctx
        const key = `${from}:${sender}`

        // If batch processing is disabled for this chat and no --batch flag, return false
        if (!this.isEnabled(from) && !options.forceBatch) {
            return false
        }

        this.activeBatchSenders.add(sender)

        try {
            // Collect media from recent window (past 5 seconds)
            const now = Date.now()
            const pastCutoff = now - 5000
            let recentList = (this.recentMediaMap.get(key) || []).filter(item => item.timestamp > pastCutoff)

            let collectedMessages = []
            const seenIds = new Set()

            // Always add the current triggering message first
            if (msg.key?.id) {
                seenIds.add(msg.key.id)
                collectedMessages.push(msg)
            }

            for (const item of recentList) {
                if (!seenIds.has(item.msg.key?.id)) {
                    seenIds.add(item.msg.key.id)
                    collectedMessages.push(item.msg)
                }
            }

            // Wait 1200ms debounce to gather any trailing companion media in the album
            await new Promise((resolve) => {
                const batchEntry = {
                    messages: collectedMessages,
                    debounceTimer: setTimeout(() => resolve(), 1200),
                    resolve
                }
                this.activeBatches.set(key, batchEntry)
            })

            this.activeBatches.delete(key)

            // If only 1 media was found in total, return false so sticker.js executes normal single mode
            if (collectedMessages.length <= 1) {
                return false
            }

            // More than 1 media detected -> BATCH PROCESSING!
            botLogger.info?.('sticker', `[BatchSticker] Detected album/burst of ${collectedMessages.length} media from ${sender}`)
            await this.executeBatch(ctx, collectedMessages, options)
            return true
        } finally {
            this.activeBatches.delete(key)
            setTimeout(() => {
                this.activeBatchSenders.delete(sender)
            }, 5000)
        }
    }

    /**
     * Execute the sequential batch conversion with 3-second delay and live status message editing
     */
    async executeBatch(ctx, messageList, options) {
        const { from, sock, react, msg: triggerMsg } = ctx
        const total = messageList.length

        // Send initial progress message
        let statusMsg = null
        try {
            statusMsg = await sock.sendMessage(from, {
                text: `⏳ *Batch Sticker Processing: 1/${total}*\nSedang memproses stiker 1 dari ${total}, mohon tunggu... *(Jeda aman 3s)*`
            }, { quoted: getCleanQuoted(triggerMsg) })
        } catch (e) {
            logger.warn(`[BatchSticker] Failed to send initial status message: ${e.message}`)
        }

        let successCount = 0
        let failCount = 0

        for (let i = 0; i < total; i++) {
            const currentMsg = messageList[i]
            const index = i + 1

            // If not the first sticker, delay 3 seconds to avoid WhatsApp spam triggers
            if (i > 0) {
                await new Promise(r => setTimeout(r, 3000))

                // Update / Edit progress message
                if (statusMsg?.key) {
                    try {
                        await sock.sendMessage(from, {
                            text: `⏳ *Batch Sticker Processing: ${index}/${total}*\nSedang memproses stiker ke-${index} dari ${total}, mohon tunggu... *(Jeda aman 3s)*`,
                            edit: statusMsg.key
                        }).catch(() => {})
                    } catch (_) {}
                }
            }

            try {
                const unwrapped = unwrapMessage(currentMsg.message)
                const reconstructed = {
                    key: currentMsg.key,
                    message: unwrapped
                }

                const buffer = await downloadMediaMessage(reconstructed, 'buffer', {}, {
                    logger: console,
                    reconnectCount: 3,
                    reuploadRequest: sock.updateMediaMessage
                })

                if (!buffer) {
                    failCount++
                    continue
                }

                const isAnim = this.isAnimated(unwrapped, buffer)
                let stickerBuffer

                if (isAnim) {
                    stickerBuffer = await mediaService.toAnimatedMemeSticker(
                        buffer,
                        options.topText || '',
                        options.bottomText || '',
                        options.noCrop || false,
                        options.removeBg || false,
                        options.lqPercent || 0,
                        options.speedMultiplier || 1.0,
                        options.maxDuration || 30
                    )
                } else {
                    stickerBuffer = await mediaService.toMemeSticker(
                        buffer,
                        options.topText || '',
                        options.bottomText || '',
                        options.noCrop || false,
                        options.removeBg || false,
                        options.lqPercent || 0
                    )
                }

                if (stickerBuffer) {
                    await sock.sendMessage(from, { sticker: stickerBuffer })
                    successCount++
                } else {
                    failCount++
                }
            } catch (err) {
                logger.error(err, `[BatchSticker] Failed item ${index}/${total}`)
                failCount++
            }
        }

        // Final completion edit
        if (statusMsg?.key) {
            try {
                const failNote = failCount > 0 ? ` (${failCount} gagal)` : ''
                await sock.sendMessage(from, {
                    text: `✅ *Batch Sticker Selesai!*\nBerhasil memproses *${successCount}/${total}* stiker${failNote} dengan aman.`,
                    edit: statusMsg.key
                }).catch(() => {})
            } catch (_) {}
        }

        try {
            await react('✅')
        } catch (_) {}
    }
}

export const batchStickerService = new BatchStickerService()
export default batchStickerService
