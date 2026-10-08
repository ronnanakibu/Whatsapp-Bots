import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { dbService } from './db.js'
import { logger, botLogger } from '../utils/logger.js'
import { unwrapMessage } from '../utils/message.js'
import { tgStorage } from './tgStorage.js'

const CACHE_DIR = path.resolve('./storage/media/cache')
const REVOKED_DIR = path.resolve('./storage/media/revoked')
const VIEWONCE_DIR = path.resolve('./storage/media/viewonce')

// Pastikan folder penyimpanan ada
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
if (!fs.existsSync(REVOKED_DIR)) fs.mkdirSync(REVOKED_DIR, { recursive: true })
if (!fs.existsSync(VIEWONCE_DIR)) fs.mkdirSync(VIEWONCE_DIR, { recursive: true })

const MAX_PRECACHE_SIZE = 15 * 1024 * 1024 // 15MB limit untuk auto-cache

class MediaCacheService {
    constructor() {
        this._groupNameCache = new Map()
        this._archivedMsgIds = new Set()
        this._recentBufferHashes = new Map()

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
     * Dapatkan nama subjek grup dengan in-memory cache agar hemat request
     */
    async getGroupName(sock, groupId) {
        if (!groupId || !groupId.endsWith('@g.us')) return null
        if (this._groupNameCache.has(groupId)) {
            return this._groupNameCache.get(groupId)
        }
        try {
            const meta = await sock?.groupMetadata?.(groupId).catch(() => null)
            if (meta?.subject) {
                this._groupNameCache.set(groupId, meta.subject)
                return meta.subject
            }
        } catch (_) {}
        return groupId.split('@')[0]
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
     * Format caption Telegram terstandarisasi rapi sesuai permintaan
     *
     * [Activity]
     * (Media type) (Media name)
     * Sender : Parsed Sender JID
     * From: (Parsed Group ID into name, if group), (if private message, just write "Direct Message")
     * Timestamp:
     * Size
     */
    formatTelegramCaption(activity, filename, buffer, meta = {}) {
        let mediaType = 'Document'
        const ext = path.extname(filename).toLowerCase().replace('.', '')
        if (['jpg', 'jpeg', 'png'].includes(ext) || meta.mType === 'imageMessage') mediaType = 'Photo'
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
            const rawGid = (meta.from || meta.chatJid || '').split('@')[0]
            if (meta.groupName && meta.groupName !== rawGid) {
                fromLine = `${meta.groupName} (${rawGid})`
            } else if (meta.groupName) {
                fromLine = meta.groupName
            } else if (rawGid) {
                fromLine = rawGid
            } else {
                fromLine = 'Group'
            }
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
     * Konversi berbagai tipe sumber media Baileys (Buffer, file path, URL, Stream) menjadi Buffer
     */
    async extractMediaBuffer(source) {
        if (!source) return null
        if (Buffer.isBuffer(source)) return source
        if (source instanceof Uint8Array) return Buffer.from(source)
        if (typeof source === 'string') {
            if (fs.existsSync(source)) {
                return await fs.promises.readFile(source)
            }
            if (source.startsWith('http://') || source.startsWith('https://')) {
                const res = await fetch(source)
                const ab = await res.arrayBuffer()
                return Buffer.from(ab)
            }
        }
        if (source && typeof source === 'object') {
            if (source.url && typeof source.url === 'string') {
                if (fs.existsSync(source.url)) {
                    return await fs.promises.readFile(source.url)
                }
                if (source.url.startsWith('http://') || source.url.startsWith('https://')) {
                    const res = await fetch(source.url)
                    const ab = await res.arrayBuffer()
                    return Buffer.from(ab)
                }
            }
            if (typeof source.pipe === 'function' || typeof source[Symbol.asyncIterator] === 'function') {
                const chunks = []
                for await (const chunk of source) {
                    chunks.push(chunk)
                }
                return Buffer.concat(chunks)
            }
        }
        return null
    }

    /**
     * Hook Baileys socket.sendMessage untuk otomatis menangkap dan mengarsipkan semua media yang dikirim oleh bot
     */
    hookSocketOutgoing(sock) {
        if (!sock || sock._mediaArchiverHooked) return
        sock._mediaArchiverHooked = true

        const originalSendMessage = sock.sendMessage.bind(sock)
        sock.sendMessage = async (jid, content, options) => {
            const sentResult = await originalSendMessage(jid, content, options)
            try {
                this.archiveOutgoingMedia(sock, jid, content, sentResult).catch(err => {
                    botLogger.debug?.('mediacache', `Failed to archive outgoing media: ${err.message}`)
                })
            } catch (_) {}
            return sentResult
        }
    }

    /**
     * Arsipkan media yang diupload/dikirim oleh bot ke Telegram Channel
     */
    async archiveOutgoingMedia(sock, jid, content, sentResult) {
        if (!tgStorage.isConfigured || !content || typeof content !== 'object') return
        if (process.env.LOG_CHANNEL_JID && jid === process.env.LOG_CHANNEL_JID) return

        const actualContent = content.viewOnceMessage?.message 
            || content.ephemeralMessage?.message 
            || content

        let mediaType = null
        let source = null
        let ext = 'bin'
        let tgType = 'document'
        let customName = null

        if (actualContent.image) {
            mediaType = 'imageMessage'
            source = actualContent.image
            ext = actualContent.mimetype?.includes('png') ? 'png' : 'jpg'
            tgType = 'photo'
        } else if (actualContent.video) {
            mediaType = 'videoMessage'
            source = actualContent.video
            ext = 'mp4'
            tgType = 'video'
        } else if (actualContent.audio) {
            mediaType = 'audioMessage'
            source = actualContent.audio
            ext = actualContent.ptt ? 'ogg' : (actualContent.mimetype?.includes('mp3') ? 'mp3' : 'ogg')
            tgType = 'audio'
        } else if (actualContent.sticker) {
            mediaType = 'stickerMessage'
            source = actualContent.sticker
            ext = 'webp'
            tgType = 'document'
        } else if (actualContent.document) {
            mediaType = 'documentMessage'
            source = actualContent.document
            customName = actualContent.fileName
            ext = customName ? path.extname(customName).replace('.', '') || 'bin' : 'bin'
            tgType = 'document'
        }

        if (!source) return

        const buffer = await this.extractMediaBuffer(source)
        if (!buffer || buffer.length === 0) return

        // Debounce buffer identik agar tidak dobel upload
        const hash = crypto.createHash('md5').update(buffer).digest('hex')
        if (this._recentBufferHashes.has(hash)) {
            const time = this._recentBufferHashes.get(hash)
            if (Date.now() - time < 30000) return
        }
        this._recentBufferHashes.set(hash, Date.now())

        const isGroup = typeof jid === 'string' && jid.endsWith('@g.us')
        let groupName = null
        if (isGroup) {
            groupName = await this.getGroupName(sock, jid)
        }

        const botJid = sock.user?.id || 'Bot'
        const botName = sock.user?.name || 'RonnBot'
        const msgId = sentResult?.key?.id || Date.now().toString()
        const filename = customName || `sent_${msgId}.${ext}`

        const caption = this.formatTelegramCaption('Sent Media', filename, buffer, {
            sender: botJid,
            senderName: botName,
            isGroup,
            groupName,
            from: jid,
            mType: mediaType,
            ptt: Boolean(actualContent.ptt)
        })

        await tgStorage.uploadMedia(buffer, filename, {
            caption,
            type: tgType
        })
        botLogger.info('mediacache', `☁️ [TG-VAULT] Archived sent ${mediaType} (${(buffer.length / 1024).toFixed(1)} KB)`)
    }

    /**
     * Arsipkan media yang diterima ke Telegram Channel
     */
    async archiveIncomingMediaToTelegram(sock, msg, buffer, mType, ext) {
        if (!tgStorage.isConfigured || !buffer || buffer.length === 0) return

        const msgId = msg.key?.id || Date.now().toString()
        if (this._archivedMsgIds.has(msgId)) return
        this._archivedMsgIds.add(msgId)
        if (this._archivedMsgIds.size > 2000) {
            const first = this._archivedMsgIds.values().next().value
            this._archivedMsgIds.delete(first)
        }

        // Debounce buffer identik
        const hash = crypto.createHash('md5').update(buffer).digest('hex')
        if (this._recentBufferHashes.has(hash)) {
            const time = this._recentBufferHashes.get(hash)
            if (Date.now() - time < 30000) return
        }
        this._recentBufferHashes.set(hash, Date.now())

        const from = msg.key?.remoteJid || ''
        const isGroup = from.endsWith('@g.us')
        const sender = isGroup ? (msg.key?.participant || from) : from
        const pushName = msg.pushName || ''

        let groupName = null
        if (isGroup) {
            groupName = await this.getGroupName(sock, from)
        }

        const filename = `incoming_${msgId}.${ext}`
        const caption = this.formatTelegramCaption('Received Media', filename, buffer, {
            sender,
            senderName: pushName,
            isGroup,
            groupName,
            from,
            mType,
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now()
        })

        const tgType = mType === 'imageMessage' ? 'photo' 
            : (mType === 'videoMessage' || mType === 'ptvMessage' ? 'video' 
            : (mType === 'audioMessage' ? 'audio' : 'document'))

        await tgStorage.uploadMedia(buffer, filename, {
            caption,
            type: tgType
        })
        botLogger.info('mediacache', `☁️ [TG-VAULT] Archived incoming ${mType} (${(buffer.length / 1024).toFixed(1)} KB)`)
    }

    /**
     * Otomatis mengunduh & menyimpan media pesan masuk di latar belakang dan upload ke Telegram
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

            // Jika sudah ada di disk, baca buffer
            let buffer = null
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                buffer = await fs.promises.readFile(filePath)
            } else {
                // Download di background
                buffer = await downloadMediaMessage(
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
            }

            // Cek apakah pesan adalah View Once
            const isViewOnce = Boolean(
                msg.message?.viewOnceMessage || 
                msg.message?.viewOnceMessageV2 || 
                msg.message?.viewOnceMessageV2Extension || 
                mediaContent.viewOnce
            )

            // Jika bukan View Once (View Once diarsip secara khusus oleh viewOnce handler), arsipkan ke Telegram
            if (buffer && buffer.length > 0 && tgStorage.isConfigured && !isViewOnce) {
                this.archiveIncomingMediaToTelegram(sock, msg, buffer, mType, ext).catch(err => {
                    botLogger.debug?.('mediacache', `Gagal upload incoming media ke Telegram: ${err.message}`)
                })
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
