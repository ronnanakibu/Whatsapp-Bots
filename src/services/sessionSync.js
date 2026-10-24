// src/services/sessionSync.js
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { uploadFile } from '@huggingface/hub'
import { logger, botLogger } from '../utils/logger.js'

class SessionSyncService {
    constructor() {
        this.token = process.env.HF_TOKEN ? process.env.HF_TOKEN.replace(/^["']|["']$/g, '') : ''
        this.repo = process.env.HF_DATASET_REPO || 'ronnlbtrn/wabot-storage'
        this.sessionDir = path.resolve('./storage/sessions')
        this.archiveFile = path.resolve('./storage/session.tar.gz')
        this.backupDebounceTimer = null
        this.isBackingUp = false
    }

    /**
     * Restore session from Hugging Face Dataset if local session is missing
     */
    async restoreSession() {
        const credsFile = path.join(this.sessionDir, 'creds.json')
        if (fs.existsSync(credsFile)) {
            botLogger.system('[SessionSync] Local session credentials exist. Skip restore.')
            return true
        }

        if (!this.token) {
            botLogger.warn('session-sync', 'HF_TOKEN not set, skipping session restore from Hugging Face Dataset.')
            return false
        }

        botLogger.system(`[SessionSync] Checking cloud session backup in HF Dataset: ${this.repo}...`)
        try {
            if (!fs.existsSync(this.sessionDir)) {
                fs.mkdirSync(this.sessionDir, { recursive: true })
            }

            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/session.tar.gz`
            const res = await fetch(downloadUrl, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            })

            if (res.status === 404) {
                botLogger.system('[SessionSync] No cloud session backup found (Fresh setup).')
                return false
            }

            if (!res.ok) {
                botLogger.warn('session-sync', `Failed to fetch session backup: HTTP ${res.status} ${res.statusText}`)
                return false
            }

            const arrayBuf = await res.arrayBuffer()
            const buf = Buffer.from(arrayBuf)
            fs.writeFileSync(this.archiveFile, buf)

            // Extract archive
            try {
                execSync(`tar -xzf "${this.archiveFile}" -C "${this.sessionDir}"`, { stdio: 'pipe' })
                botLogger.system('✅ [SessionSync] WhatsApp session successfully restored from Hugging Face Dataset!')
                return true
            } catch (tarErr) {
                botLogger.err('session-sync', tarErr, 'tar-extract')
                return false
            } finally {
                try {
                    if (fs.existsSync(this.archiveFile)) fs.unlinkSync(this.archiveFile)
                } catch (_) {}
            }
        } catch (err) {
            botLogger.warn('session-sync', `Error restoring session from HF: ${err.message}`)
            return false
        }
    }

    /**
     * Immediately backup the current session directory to Hugging Face Dataset
     */
    async backupSession() {
        if (this.isBackingUp) return
        this.isBackingUp = true

        try {
            const credsFile = path.join(this.sessionDir, 'creds.json')
            if (!fs.existsSync(credsFile)) {
                return
            }

            if (!this.token) {
                return
            }

            // Create compressed archive of storage/sessions
            try {
                execSync(`tar -czf "${this.archiveFile}" -C "${this.sessionDir}" .`, { stdio: 'pipe' })
            } catch (tarErr) {
                logger.warn(`[SessionSync] Failed to pack session: ${tarErr.message}`)
                return
            }

            const archiveBuffer = fs.readFileSync(this.archiveFile)

            await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'session.tar.gz',
                    content: archiveBuffer
                },
                commitTitle: 'Automated WhatsApp session credentials backup [skip ci]'
            })

            logger.info('☁️ [SessionSync] WhatsApp session backed up to Hugging Face Dataset!')
        } catch (err) {
            logger.warn(`[SessionSync] Backup failed: ${err.message}`)
        } finally {
            try {
                if (fs.existsSync(this.archiveFile)) fs.unlinkSync(this.archiveFile)
            } catch (_) {}
            this.isBackingUp = false
        }
    }

    /**
     * Trigger a debounced backup (e.g. called on creds.update)
     */
    triggerDebouncedBackup(delayMs = 30000) {
        if (this.backupDebounceTimer) {
            clearTimeout(this.backupDebounceTimer)
        }
        this.backupDebounceTimer = setTimeout(() => {
            this.backupSession()
        }, delayMs)
    }
}

export const sessionSync = new SessionSyncService()
export default sessionSync
