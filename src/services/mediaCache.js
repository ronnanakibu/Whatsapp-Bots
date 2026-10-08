import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { dbService } from './db.js'
import { logger, botLogger } from '../utils/logger.js'
import { unwrapMessage } from '../utils/message.js'

const CACHE_DIR = path.resolve('./storage/media/cache')
const REVOKED_DIR = path.resolve('./storage/media/revoked')
const VIEWONCE_DIR = path.resolve('./storage/media/viewonce')

import { tgStorage } from './tgStorage.js'

// Pastikan folder penyimpanan ada
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
if (!fs.existsSync(REVOKED_DIR)) fs.mkdirSync(REVOKED_DIR, { recursive: true })
if (!fs.existsSync(VIEWONCE_DIR)) fs.mkdirSync(VIEWONCE_DIR, { recursive: true })

const MAX_PRECACHE_SIZE = 15 * 1024 * 1024 // 15MB limit untuk auto-cache

class MediaCacheService {
    constructor() {
        // Jalankan pembersihan otomatis setiap 1 jam (retensi 1 hari untuk hemat volume Railway)
        setInterval(() => {
            this.cleanOldCache(1)
        }, 60 * 60 * 1000)

        // Bersihkan sekali saat inisialisasi awal
        setTimeout(() => {
            this.cleanOldCache(1)
        }, 15000)
    }

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
     * Arsipkan media yang di-revoke ke Telegram Channel & disk lokal
     */
    async archiveRevokedMedia(msgId, buffer, ext = 'bin', meta = {}) {
        let targetPath = path.join(REVOKED_DIR, `${msgId}.${ext}`)
        try {
            await fs.promises.writeFile(targetPath, buffer)
            botLogger.info('mediacache', `🗄️ [REVOKED MEDIA] Archived ${(buffer.length / 1024).toFixed(1)} KB -> ${targetPath}`)
        } catch (err) {
    /**
     * Format caption Telegram rapi sesuai template
     */
    formatTelegramCaption(activity, filename, buffer, meta = {}) {
        let mediaType = 'Document'
        const ext = path.extname(filename).toLowerCase().replace('.', '')
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext) || meta.mType === 'imageMessage') mediaType = 'Photo'
        else if (['mp4', 'mkv', 'mov', 'webm'].includes(ext) || meta.mType === 'videoMessage' || meta.mType === 'ptvMessage') mediaType = 'Video'
        else if (meta.mType === 'audioMessage') mediaType = meta.ptt ? 'Voice Note' : 'Audio'
        else if (['mp3', 'ogg', 'opus', 'm4a', 'wav'].includes(ext)) mediaType = 'Audio'
        else if (meta.mType === 'stickerMessage' || ext === 'webp') mediaType = 'Sticker'

        // Sender : Parsed Sender JID
        const rawSender = meta.senderNumber || meta.sender || meta.senderJid || ''
        const parsedSender = rawSender.split('@')[0].split(':')[0] || 'Unknown'
        const senderLine = meta.senderName && meta.senderName !== parsedSender
            ? `${parsedSender} (${meta.senderName})`
            : parsedSender

        // From: (Parsed Group ID into name, if group), (if private message, just write "Direct Message")
        let fromLine = 'Direct Message'
        if (meta.isGroup || (meta.from && meta.from.endsWith('@g.us')) || (meta.chatJid && meta.chatJid.endsWith('@g.us'))) {
            fromLine = meta.groupName || meta.chatName || meta.from || 'Group'
        }

        // Timestamp:
        const now = meta.timestamp ? new Date(meta.timestamp) : new Date()
        const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'

        // Size:
        const bytes = buffer ? buffer.length : (meta.size || 0)
        const sizeStr = bytes > 1024 * 1024
            ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
            : `${(bytes / 1024).toFixed(1)} KB`

        return [
            `[${activity}]`,
            `${mediaType} ${filename}`,
            `Sender : ${senderLine}`,
            `From: ${fromLine}`,
            `Timestamp: ${timestamp}`,
            `Size: ${sizeStr}`
        ].join('\n')
    }

    /**
     * Arsipkan media yang di-revoke ke Telegram Channel & disk lokal
     */
    async archiveRevokedMedia(msgId, buffer, ext = 'bin', meta = {}) {
        let targetPath = path.join(REVOKED_DIR, `${msgId}.${ext}`)
        try {
            await fs.promises.writeFile(targetPath, buffer)
            botLogger.info('mediacache', `🗄️ [REVOKED MEDIA] Archived ${(buffer.length / 1024).toFixed(1)} KB -> ${targetPath}`)
        } catch (err) {
            botLogger.warn('mediacache', `Gagal tulis disk revoked media ${msgId}: ${err.message}`)
            targetPath = null
        }

        // Upload ke Telegram Channel sebagai arsip cloud unlimited
        if (tgStorage.isConfigured) {
            try {
                const filename = `revoked_${msgId}.${ext}`
                const caption = this.formatTelegramCaption('Anti-Delete', filename, buffer, meta)
                const mediaType = meta.mType === 'imageMessage' ? 'photo' : (meta.mType === 'videoMessage' ? 'video' : (meta.mType === 'audioMessage' ? 'audio' : 'document'))
                await tgStorage.uploadMedia(buffer, filename, {
                    caption,
                    type: mediaType
                })
            } catch (err) {
                botLogger.warn('mediacache', `Gagal upload revoked media ke Telegram: ${err.message}`)
            }
        }

        return targetPath
    }

    /**
     * Arsipkan media View Once ke Telegram Channel & disk lokal
     */
    async archiveViewOnceMedia(msgId, buffer, ext = 'bin', meta = {}) {
        let targetPath = path.join(VIEWONCE_DIR, `${msgId}.${ext}`)
        try {
            await fs.promises.writeFile(targetPath, buffer)
            botLogger.info('mediacache', `👁️ [VIEWONCE MEDIA] Archived ${(buffer.length / 1024).toFixed(1)} KB -> ${targetPath}`)
        } catch (err) {
            botLogger.warn('mediacache', `Gagal tulis disk view once media ${msgId}: ${err.message}`)
            targetPath = null
        }

        // Upload ke Telegram Channel sebagai arsip cloud unlimited
        if (tgStorage.isConfigured) {
            try {
                const filename = `viewonce_${msgId}.${ext}`
                const caption = this.formatTelegramCaption('View Once', filename, buffer, meta)
                const mediaType = meta.mType === 'imageMessage' ? 'photo' : (meta.mType === 'videoMessage' ? 'video' : (meta.mType === 'audioMessage' ? 'audio' : 'document'))
                await tgStorage.uploadMedia(buffer, filename, {
                    caption,
                    type: mediaType
                })
            } catch (err) {
                botLogger.warn('mediacache', `Gagal upload view once media ke Telegram: ${err.message}`)
            }
        }

        return targetPath
    }

    /**
     * Bersihkan file cache & arsip lama (retensi default 1 hari untuk menjaga volume Railway 500MB)
     */
    cleanOldCache(days = 1) {
        try {
            const now = Date.now()
            const maxAge = days * 24 * 60 * 60 * 1000
            let cleaned = 0

            const targetDirs = [CACHE_DIR, REVOKED_DIR, VIEWONCE_DIR]
            for (const dir of targetDirs) {
                if (!fs.existsSync(dir)) continue
                const files = fs.readdirSync(dir)
                for (const file of files) {
                    const fullPath = path.join(dir, file)
                    try {
                        const stats = fs.statSync(fullPath)
                        if (now - stats.mtimeMs > maxAge) {
                            fs.unlinkSync(fullPath)
                            cleaned++
                        }
                    } catch {}
                }
            }

            // Hard quota: Jika CACHE_DIR melebihi 100MB, bersihkan file terlama sampai di bawah 50MB
            this._enforceQuota(CACHE_DIR, 100 * 1024 * 1024, 50 * 1024 * 1024)

            if (cleaned > 0) {
                logger.info(`[MediaCache] Cleaned ${cleaned} expired cache/archive files (> ${days} day(s)).`)
            }
        } catch (err) {
            logger.error('[MediaCache] Clean cache error:', err.message)
        }
    }

    /**
     * Memastikan folder tidak melebihi kuota maksimal (FIFO)
     */
    _enforceQuota(dir, maxSizeBytes, targetSizeBytes) {
        try {
            if (!fs.existsSync(dir)) return
            const files = fs.readdirSync(dir)
            let totalSize = 0
            const fileStats = []

            for (const file of files) {
                const fullPath = path.join(dir, file)
                try {
                    const stat = fs.statSync(fullPath)
                    totalSize += stat.size
                    fileStats.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs })
                } catch {}
            }

            if (totalSize > maxSizeBytes) {
                // Urutkan dari yang paling lama diubah
                fileStats.sort((a, b) => a.mtime - b.mtime)
                for (const item of fileStats) {
                    try {
                        fs.unlinkSync(item.path)
                        totalSize -= item.size
                        if (totalSize <= targetSizeBytes) break
                    } catch {}
                }
                logger.info(`[MediaCache] Enforced storage quota on ${path.basename(dir)} down to ${(totalSize / 1024 / 1024).toFixed(1)} MB`)
            }
        } catch (err) {
            logger.debug?.(`[MediaCache] Enforce quota failed: ${err.message}`)
        }
    }
}

export const mediaCache = new MediaCacheService()

