import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { dbService } from './db.js'
import { logger, botLogger } from '../utils/logger.js'
import { unwrapMessage } from '../utils/message.js'

const CACHE_DIR = path.resolve('./storage/media/cache')
const REVOKED_DIR = path.resolve('./storage/media/revoked')
const VIEWONCE_DIR = path.resolve('./storage/media/viewonce')

// Pastikan folder penyimpanan ada
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
if (!fs.existsSync(REVOKED_DIR)) fs.mkdirSync(REVOKED_DIR, { recursive: true })
if (!fs.existsSync(VIEWONCE_DIR)) fs.mkdirSync(VIEWONCE_DIR, { recursive: true })


const MAX_PRECACHE_SIZE = 15 * 1024 * 1024 // 15MB limit untuk auto-cache

class MediaCacheService {
    /**
     * Helper ekstensi berdasarkan mimetype / tipe pesan
     */
    getExtension(mType, mimetype = '') {
        if (mimetype.includes('image/png')) return 'png'
        if (mimetype.includes('image/jpeg') || mimetype.includes('image/jpg')) return 'jpg'
        if (mimetype.includes('image/webp')) return 'webp'
        if (mimetype.includes('video/mp4')) return 'mp4'
        if (mimetype.includes('audio/ogg') || mimetype.includes('audio/opus')) return 'ogg'
        if (mimetype.includes('audio/mp4') || mimetype.includes('audio/aac')) return 'm4a'
        if (mimetype.includes('audio/mpeg') || mimetype.includes('audio/mp3')) return 'mp3'
        if (mType === 'imageMessage') return 'jpg'
        if (mType === 'videoMessage' || mType === 'ptvMessage') return 'mp4'
        if (mType === 'audioMessage') return 'ogg'
        if (mType === 'stickerMessage') return 'webp'
        return 'bin'
    }

    /**
     * Otomatis mengunduh & menyimpan media pesan masuk di latar belakang
     */
    async cacheIncomingMedia(sock, msg) {
        try {
            if (!msg?.message) return

            const unwrapped = unwrapMessage(msg.message)
            if (!unwrapped) return

            const mType = Object.keys(unwrapped)[0]
            const mediaTypes = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'stickerMessage', 'documentMessage']
            if (!mediaTypes.includes(mType)) return

            const mediaContent = unwrapped[mType]
            if (!mediaContent) return

            // Batasi ukuran media besar agar hemat bandwidth
            const fileLength = Number(mediaContent.fileLength || 0)
            if (fileLength > MAX_PRECACHE_SIZE) return

            const msgId = msg.key?.id
            if (!msgId) return

            const ext = this.getExtension(mType, mediaContent.mimetype)
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
                botLogger.info('mediacache', `💾 [PRE-CACHE] Saved ${mType} (${(buffer.length / 1024).toFixed(1)} KB) -> ${filePath}`)
            }
        } catch (err) {
            // Silently ignore background caching errors (e.g. timeout)
            botLogger.debug?.('mediacache', `Failed to pre-cache media for ${msg?.key?.id}: ${err.message}`)
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

            // 3. Fallback: Download langsung dari Baileys
            const unwrapped = unwrapMessage(originalMsg?.message)
            if (!unwrapped) return null

            const buffer = await downloadMediaMessage(
                { key: originalMsg.key, message: unwrapped },
                'buffer',
                {},
                { logger: console, reconnectCount: 3, reuploadRequest: sock?.updateMediaMessage }
            )
            return buffer
        } catch (err) {
            logger.warn?.(`[MediaCache] getMediaBuffer failed: ${err.message}`)
            return null
        }
    }

    /**
     * Arsipkan media yang di-revoke secara permanen ke storage/media/revoked/
     */
    async archiveRevokedMedia(msgId, buffer, ext = 'bin') {
        try {
            const targetPath = path.join(REVOKED_DIR, `${msgId}.${ext}`)
            await fs.promises.writeFile(targetPath, buffer)
            botLogger.info('mediacache', `🗄️ [REVOKED MEDIA] Archived ${(buffer.length / 1024).toFixed(1)} KB -> ${targetPath}`)
            return targetPath
        } catch (err) {
            botLogger.warn('mediacache', `Gagal arsip revoked media ${msgId}: ${err.message}`)
            return null
        }
    }

    /**
     * Arsipkan media View Once secara permanen ke storage/media/viewonce/
     */
    async archiveViewOnceMedia(msgId, buffer, ext = 'bin') {
        try {
            const targetPath = path.join(VIEWONCE_DIR, `${msgId}.${ext}`)
            await fs.promises.writeFile(targetPath, buffer)
            botLogger.info('mediacache', `👁️ [VIEWONCE MEDIA] Archived ${(buffer.length / 1024).toFixed(1)} KB -> ${targetPath}`)
            return targetPath
        } catch (err) {
            botLogger.warn('mediacache', `Gagal arsip view once media ${msgId}: ${err.message}`)
            return null
        }
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
