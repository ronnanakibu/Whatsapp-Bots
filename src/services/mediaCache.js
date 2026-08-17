import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { dbService } from './db.js'
import { logger } from '../utils/logger.js'
import { unwrapMessage } from '../utils/message.js'

const CACHE_DIR = path.resolve('./storage/media/cache')
const REVOKED_DIR = path.resolve('./storage/media/revoked')

// Pastikan folder penyimpanan ada
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
if (!fs.existsSync(REVOKED_DIR)) fs.mkdirSync(REVOKED_DIR, { recursive: true })

const MAX_PRECACHE_SIZE = 15 * 1024 * 1024 // 15MB limit untuk auto-cache

class MediaCacheService {
    /**
     * Helper ekstensi berdasarkan mimetype / tipe pesan
     */
    getExtension(mType, mimetype = '') {
        if (mimetype.includes('image/png')) return 'png'
        if (mimetype.includes('image/webp')) return 'webp'
        if (mimetype.includes('image/')) return 'jpg'
        if (mimetype.includes('video/')) return 'mp4'
        if (mimetype.includes('audio/ogg')) return 'ogg'
        if (mimetype.includes('audio/')) return 'mp3'
        if (mType === 'imageMessage') return 'jpg'
        if (mType === 'videoMessage' || mType === 'ptvMessage') return 'mp4'
        if (mType === 'audioMessage') return 'ogg'
        if (mType === 'stickerMessage') return 'webp'
        return 'bin'
    }

    /**
     * Auto-cache media saat pesan masuk (asynchronous di background)
     */
    async cacheIncomingMedia(sock, msg) {
        try {
            if (!msg?.message || msg.key?.fromMe) return
            const msgId = msg.key.id
            if (!msgId) return

            const unwrapped = unwrapMessage(msg.message)
            if (!unwrapped) return

            const mType = Object.keys(unwrapped)[0]
            const mediaTypes = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'stickerMessage', 'documentMessage']
            if (!mediaTypes.includes(mType)) return

            const mediaContent = unwrapped[mType]
            if (!mediaContent) return

            // Cek file length jika ada
            const fileLength = Number(mediaContent.fileLength || 0)
            if (fileLength > MAX_PRECACHE_SIZE) {
                logger.debug?.(`[MediaCache] Skipped large media (${(fileLength / 1024 / 1024).toFixed(1)}MB) for ${msgId}`)
                return
            }

            const ext = this.getExtension(mType, mediaContent.mimetype || '')
            const filePath = path.join(CACHE_DIR, `${msgId}.${ext}`)

            // Jika sudah ada di disk, lewati
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return

            // Download di background
            const buffer = await downloadMediaMessage(
                { key: msg.key, message: unwrapped },
                'buffer',
                {},
                { logger: console, reconnectCount: 2, reuploadRequest: sock?.updateMediaMessage }
            )

            if (buffer && buffer.length > 0) {
                await fs.promises.writeFile(filePath, buffer)
                dbService.updateMessageMediaPath(msgId, filePath)
                logger.debug?.(`[MediaCache] Cached media ${msgId} (${(buffer.length / 1024).toFixed(1)} KB) -> ${filePath}`)
            }
        } catch (err) {
            // Silently ignore background caching errors (e.g. timeout)
            logger.debug?.(`[MediaCache] Failed to pre-cache media for ${msg?.key?.id}: ${err.message}`)
        }
    }

    /**
     * Dapatkan buffer media: Cek cache lokal terlebih dahulu, baru fallback ke Baileys download
     */
    async getMediaBuffer(sock, originalMsg) {
        try {
            const msgId = originalMsg?.key?.id
            const localPath = originalMsg?._localMediaPath

            // 1. Cek localMediaPath dari DB
            if (localPath && fs.existsSync(localPath)) {
                return await fs.promises.readFile(localPath)
            }

            // 2. Cek apakah ada di cache folder
            if (msgId) {
                const files = fs.readdirSync(CACHE_DIR)
                const matched = files.find(f => f.startsWith(msgId))
                if (matched) {
                    const foundPath = path.join(CACHE_DIR, matched)
                    return await fs.promises.readFile(foundPath)
                }
            }

            // 3. Fallback: Download via Baileys
            const unwrapped = unwrapMessage(originalMsg.message)
            return await downloadMediaMessage(
                { key: originalMsg.key, message: unwrapped },
                'buffer',
                {},
                { logger: console, reconnectCount: 3, reuploadRequest: sock?.updateMediaMessage }
            )
        } catch (err) {
            logger.warn(`[MediaCache] getMediaBuffer failed: ${err.message}`)
            return null
        }
    }

    /**
     * Arsipkan media terhapus ke folder permanen (storage/media/revoked)
     */
    async archiveRevokedMedia(msgId, buffer, ext = 'bin') {
        try {
            const filePath = path.join(REVOKED_DIR, `${Date.now()}_${msgId}.${ext}`)
            if (buffer) {
                await fs.promises.writeFile(filePath, buffer)
                return filePath
            }
        } catch (err) {
            logger.error(`[MediaCache] Failed to archive revoked media ${msgId}:`, err.message)
        }
        return null
    }

    /**
     * Bersihkan file cache lama yang berumur > X hari
     */
    cleanOldCache(days = 14) {
        try {
            const now = Date.now()
            const maxAge = days * 24 * 60 * 60 * 1000
            const files = fs.readdirSync(CACHE_DIR)
            let cleaned = 0

            for (const file of files) {
                const fullPath = path.join(CACHE_DIR, file)
                const stats = fs.statSync(fullPath)
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(fullPath)
                    cleaned++
                }
            }
            if (cleaned > 0) {
                logger.info(`[MediaCache] Cleaned ${cleaned} expired cache files (> ${days} days).`)
            }
        } catch (err) {
            logger.error('[MediaCache] Clean cache error:', err.message)
        }
    }
}

export const mediaCache = new MediaCacheService()
