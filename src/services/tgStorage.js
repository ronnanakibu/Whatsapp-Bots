import { logger, botLogger } from '../utils/logger.js'

export class TGStorageService {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN
        this.channelId = process.env.TELEGRAM_CHANNEL_ID
        if (!this.token || !this.channelId) {
            logger.warn('⚠️ [TGStorage] TELEGRAM_BOT_TOKEN atau TELEGRAM_CHANNEL_ID belum diset.')
        }
    }

    get isConfigured() {
        return Boolean(this.token && this.channelId)
    }

    /**
     * Upload buffer ke Telegram Channel
     * @param {Buffer|Uint8Array} buffer Data file
     * @param {string} filename Nama file
     * @param {Object} options { caption, mimetype, type: 'document'|'photo'|'video'|'audio' }
     * @returns {Promise<{ ok: boolean, fileId: string, messageId: number }>}
     */
    async uploadMedia(buffer, filename, options = {}) {
        if (!this.isConfigured) {
            throw new Error('Telegram credentials (TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID) not configured')
        }

        const { caption = '', mimetype = 'application/octet-stream', type = 'document' } = options
        const blob = new Blob([buffer], { type: mimetype })
        const formData = new FormData()
        formData.append('chat_id', this.channelId)

        let endpoint = 'sendDocument'
        if (type === 'photo' || (mimetype.startsWith('image/') && !mimetype.includes('webp'))) {
            endpoint = 'sendPhoto'
            formData.append('photo', blob, filename)
        } else if (type === 'video' || mimetype.startsWith('video/')) {
            endpoint = 'sendVideo'
            formData.append('video', blob, filename)
        } else if (type === 'audio' || mimetype.startsWith('audio/')) {
            endpoint = 'sendAudio'
            formData.append('audio', blob, filename)
        } else {
            endpoint = 'sendDocument'
            formData.append('document', blob, filename)
        }

        if (caption) {
            formData.append('caption', caption.slice(0, 1024))
            if (options.parse_mode) {
                formData.append('parse_mode', options.parse_mode)
            }
        }

        const url = `https://api.telegram.org/bot${this.token}/${endpoint}`
        const res = await fetch(url, {
            method: 'POST',
            body: formData
        })

        const data = await res.json()
        if (!data.ok) {
            logger.error(`❌ [TGStorage] Upload error (${endpoint}): ${data.description || JSON.stringify(data)}`)
            throw new Error(data.description || 'Failed to upload to Telegram')
        }

        const result = data.result
        let fileId = null
        if (result.photo) {
            fileId = result.photo[result.photo.length - 1].file_id
        } else if (result.video) {
            fileId = result.video.file_id
        } else if (result.audio) {
            fileId = result.audio.file_id
        } else if (result.document) {
            fileId = result.document.file_id
        }

        botLogger.info('tgstorage', `☁️ [TG-VAULT] Archived ${filename} (${(buffer.length / 1024).toFixed(1)} KB) -> Telegram Channel Msg #${result.message_id}`)

        return {
            ok: true,
            messageId: result.message_id,
            fileId
        }
    }

    /**
     * Dapatkan buffer media langsung dari server Telegram menggunakan file_id
     * @param {string} fileId 
     * @returns {Promise<Buffer|null>}
     */
    async getFileBuffer(fileId) {
        if (!this.isConfigured || !fileId) return null
        try {
            const res = await fetch(`https://api.telegram.org/bot${this.token}/getFile?file_id=${fileId}`)
            const data = await res.json()
            if (!data.ok || !data.result?.file_path) return null

            const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${data.result.file_path}`
            const fileRes = await fetch(downloadUrl)
            const arrayBuffer = await fileRes.arrayBuffer()
            return Buffer.from(arrayBuffer)
        } catch (err) {
            logger.error(`[TGStorage] getFileBuffer failed for ${fileId}:`, err.message)
            return null
        }
    }
}

export const tgStorage = new TGStorageService()
export default tgStorage
