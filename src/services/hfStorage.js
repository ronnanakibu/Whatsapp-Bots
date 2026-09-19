import { uploadFile } from '@huggingface/hub'
import { logger } from '../utils/logger.js'

export class HFStorageService {
    constructor() {
        this.token = process.env.HF_TOKEN
        this.repo = process.env.HF_DATASET_REPO || 'ronnlbtrn/wabot-storage'
        if (!this.token) {
            logger.warn('⚠️ [HFStorage] HF_TOKEN tidak diset, upload media mungkin gagal.')
        }
    }

    /**
     * Upload buffer ke HuggingFace Dataset
     * @param {Buffer|Blob} buffer Data file
     * @param {string} filename Nama file dengan ekstensinya (contoh: avatar_123.png)
     * @returns {Promise<string>} URL raw dari HuggingFace Dataset
     */
    async uploadMedia(buffer, filename) {
        if (!this.token) throw new Error('Missing HF_TOKEN for uploadMedia')

        // Jika buffer adalah Blob, konversi ke ArrayBuffer/Buffer (HF hub v0.x support Blob/Buffer/File)
        let data = buffer
        if (buffer instanceof Blob) {
            data = Buffer.from(await buffer.arrayBuffer())
        }

        try {
            await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: filename,
                    content: data
                },
                commitTitle: `Upload ${filename} via WABOT2.0`
            })

            // Return URL raw
            return `https://huggingface.co/datasets/${this.repo}/resolve/main/${filename}`
        } catch (err) {
            logger.error(`❌ [HFStorage] Gagal mengupload ${filename}:`, err.message)
            throw err
        }
    }

    /**
     * Hapus media (HuggingFace tidak mendukung hapus spesifik file via uploadFile API standard dengan mudah, 
     * biasanya pakai deleteFile atau commit API, ini implementasi dasar).
     */
    async deleteMedia(filename) {
        try {
            const { deleteFile } = await import('@huggingface/hub')
            await deleteFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                path: filename,
                commitTitle: `Delete ${filename} via WABOT2.0`
            })
            return true
        } catch (err) {
            logger.warn(`⚠️ [HFStorage] Gagal menghapus ${filename} di HF:`, err.message)
            return false
        }
    }
}

export const hfStorage = new HFStorageService()
export default hfStorage
