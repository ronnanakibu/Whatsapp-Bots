// src/services/sessionSync.js
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { uploadFile, deleteFile } from '@huggingface/hub'
import { logger, botLogger } from '../utils/logger.js'

class SessionSyncService {
    constructor() {
        this.token = process.env.HF_TOKEN ? process.env.HF_TOKEN.replace(/^["']|["']$/g, '').trim() : ''
        this.repo = (process.env.HF_DATASET_REPO || 'ronnLbtrn/wabot-storage').replace(/^["']|["']$/g, '').trim()
        
        this.sessionDir = path.resolve('./storage/sessions')
        this.dbDir = path.resolve('./storage/database')
        this.dbFile = path.resolve('./storage/database/main.db')
        this.docsDir = path.resolve('./storage/documents')
        
        this.archiveSessionFile = path.resolve('./storage/session.tar.gz')
        this.archiveDocsFile = path.resolve('./storage/documents.tar.gz')

        this.backupDebounceTimer = null
        this.isBackingUp = false
        this.schedulerInterval = null
        this.lastBackupTime = null
        this.lastBackupStatus = 'idle'
    }

    /**
     * Helper to safely tar-pack a directory across Windows and Linux
     */
    #packDirectory(sourceDir, destArchive) {
        if (!fs.existsSync(sourceDir)) return false
        const files = fs.readdirSync(sourceDir)
        if (files.length === 0) return false

        try {
            execSync(`tar -czf "${destArchive}" -C "${sourceDir}" .`, { stdio: 'pipe' })
            return fs.existsSync(destArchive) && fs.statSync(destArchive).size > 0
        } catch (err) {
            logger.warn(`[CloudSync] Tar pack failed for ${sourceDir}: ${err.message}`)
            return false
        }
    }

    /**
     * Helper to safely unpack a tar archive across Windows and Linux
     */
    #unpackArchive(archivePath, targetDir) {
        if (!fs.existsSync(archivePath)) return false
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

        try {
            execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'pipe' })
            return true
        } catch (err) {
            logger.warn(`[CloudSync] Tar unpack failed for ${archivePath}: ${err.message}`)
            return false
        }
    }

    // ─────────────────────────────────────────────
    // 1. WHATSAPP SESSION SYNC
    // ─────────────────────────────────────────────

    async restoreSession() {
        const credsFile = path.join(this.sessionDir, 'creds.json')
        if (fs.existsSync(credsFile)) {
            botLogger.system('[CloudSync] Local session credentials exist. Skip restore.')
            return true
        }

        if (!this.token) {
            botLogger.warn('session-sync', 'HF_TOKEN not set, skipping session restore from Hugging Face Dataset.')
            return false
        }

        botLogger.system(`[CloudSync] Checking cloud session backup in HF Dataset: ${this.repo}...`)
        try {
            if (!fs.existsSync(this.sessionDir)) {
                fs.mkdirSync(this.sessionDir, { recursive: true })
            }

            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/session.tar.gz`
            const res = await fetch(downloadUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            })

            if (res.status === 404) {
                botLogger.system('[CloudSync] No cloud session backup found in dataset.')
                return false
            }

            if (!res.ok) {
                botLogger.warn('session-sync', `Failed to fetch session backup: HTTP ${res.status}`)
                return false
            }

            const arrayBuf = await res.arrayBuffer()
            fs.writeFileSync(this.archiveSessionFile, Buffer.from(arrayBuf))

            const restored = this.#unpackArchive(this.archiveSessionFile, this.sessionDir)
            if (restored) {
                botLogger.system('✅ [CloudSync] WhatsApp session restored from Hugging Face Dataset!')
                return true
            }
            return false
        } catch (err) {
            botLogger.warn('session-sync', `Error restoring session from HF: ${err.message}`)
            return false
        } finally {
            try {
                if (fs.existsSync(this.archiveSessionFile)) fs.unlinkSync(this.archiveSessionFile)
            } catch (_) {}
        }
    }

    async backupSession() {
        try {
            const credsFile = path.join(this.sessionDir, 'creds.json')
            if (!fs.existsSync(credsFile) || !this.token) return null

            const packed = this.#packDirectory(this.sessionDir, this.archiveSessionFile)
            if (!packed) return null

            const archiveBuffer = fs.readFileSync(this.archiveSessionFile)
            const blob = new Blob([archiveBuffer])

            const res = await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'session.tar.gz',
                    content: blob
                },
                commitTitle: 'Automated WhatsApp session backup [skip ci]'
            })

            logger.info('☁️ [CloudSync] WhatsApp session backed up to Hugging Face Dataset!')
            return res
        } catch (err) {
            logger.warn(`[CloudSync] Session backup failed: ${err.message}`)
            return null
        } finally {
            try {
                if (fs.existsSync(this.archiveSessionFile)) fs.unlinkSync(this.archiveSessionFile)
            } catch (_) {}
        }
    }

    /**
     * Delete invalid/expired session backup from Hugging Face Dataset
     */
    async deleteCloudSession() {
        if (!this.token) return false
        try {
            await deleteFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                path: 'session.tar.gz',
                commitTitle: 'Purge stale session credentials (401 Logged Out) [skip ci]'
            })
            logger.info('☁️ [CloudSync] Stale session.tar.gz removed from Hugging Face Dataset.')
            return true
        } catch (err) {
            // Ignore if file already doesn't exist
            logger.warn(`[CloudSync] Cloud session delete notice: ${err.message}`)
            return false
        }
    }

    // ─────────────────────────────────────────────
    // 2. SQLITE DATABASE SYNC (main.db)
    // ─────────────────────────────────────────────

    async restoreDatabase(force = false) {
        if (!force && fs.existsSync(this.dbFile) && fs.statSync(this.dbFile).size > 1024) {
            botLogger.system('[CloudSync] Local database (main.db) exists. Skip cloud restore.')
            return true
        }

        if (!this.token) {
            botLogger.warn('session-sync', 'HF_TOKEN not set, skipping database restore.')
            return false
        }

        botLogger.system(`[CloudSync] Downloading persistent database from HF Dataset: ${this.repo}...`)
        try {
            if (!fs.existsSync(this.dbDir)) fs.mkdirSync(this.dbDir, { recursive: true })

            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/main.db`
            const res = await fetch(downloadUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            })

            if (res.status === 404) {
                botLogger.system('[CloudSync] No main.db found in HF Dataset (Fresh setup).')
                return false
            }

            if (!res.ok) {
                botLogger.warn('session-sync', `Failed to download main.db: HTTP ${res.status}`)
                return false
            }

            const arrayBuf = await res.arrayBuffer()
            fs.writeFileSync(this.dbFile, Buffer.from(arrayBuf))
            botLogger.system(`✅ [CloudSync] Persistent database (main.db) successfully restored! (${(arrayBuf.byteLength / 1024).toFixed(1)} KB)`)
            return true
        } catch (err) {
            botLogger.warn('session-sync', `Error restoring main.db from HF: ${err.message}`)
            return false
        }
    }

    async backupDatabase() {
        if (!this.token) return null
        if (!fs.existsSync(this.dbFile)) return null

        try {
            // Checkpoint WAL if SQLite instance is loaded to ensure clean snapshot
            try {
                const { db } = await import('./db.js')
                if (db && typeof db.pragma === 'function') {
                    db.pragma('wal_checkpoint(TRUNCATE)')
                }
            } catch (_) {}

            const dbBuffer = fs.readFileSync(this.dbFile)
            if (dbBuffer.length === 0) return null

            const blob = new Blob([dbBuffer])
            const res = await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'main.db',
                    content: blob
                },
                commitTitle: `Automated database snapshot backup (${(dbBuffer.length / 1024).toFixed(1)} KB) [skip ci]`
            })

            logger.info(`☁️ [CloudSync] SQLite database (main.db) backed up! (${(dbBuffer.length / 1024).toFixed(1)} KB)`)
            return res
        } catch (err) {
            logger.warn(`[CloudSync] Database backup failed: ${err.message}`)
            return null
        }
    }

    // ─────────────────────────────────────────────
    // 3. DOCUMENTS & NOTES ATTACHMENTS SYNC
    // ─────────────────────────────────────────────

    async restoreDocuments() {
        if (!this.token) return false
        if (fs.existsSync(this.docsDir) && fs.readdirSync(this.docsDir).length > 0) {
            return true
        }

        try {
            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/documents.tar.gz`
            const res = await fetch(downloadUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            })
            if (!res.ok) return false

            const arrayBuf = await res.arrayBuffer()
            fs.writeFileSync(this.archiveDocsFile, Buffer.from(arrayBuf))
            const unpacked = this.#unpackArchive(this.archiveDocsFile, this.docsDir)
            if (unpacked) {
                botLogger.system('✅ [CloudSync] Uploaded notes & documents restored from HF Dataset!')
                return true
            }
            return false
        } catch (err) {
            return false
        } finally {
            try {
                if (fs.existsSync(this.archiveDocsFile)) fs.unlinkSync(this.archiveDocsFile)
            } catch (_) {}
        }
    }

    async backupDocuments() {
        if (!this.token) return null
        if (!fs.existsSync(this.docsDir)) return null

        try {
            const packed = this.#packDirectory(this.docsDir, this.archiveDocsFile)
            if (!packed) return null

            const buf = fs.readFileSync(this.archiveDocsFile)
            const res = await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'documents.tar.gz',
                    content: new Blob([buf])
                },
                commitTitle: 'Automated documents & materials backup [skip ci]'
            })
            return res
        } catch (err) {
            return null
        } finally {
            try {
                if (fs.existsSync(this.archiveDocsFile)) fs.unlinkSync(this.archiveDocsFile)
            } catch (_) {}
        }
    }

    // ─────────────────────────────────────────────
    // 4. YOUTUBE COOKIES SYNC (Bypass Bot Verification)
    // ─────────────────────────────────────────────

    async restoreCookies() {
        const cookieFile = path.resolve('./storage/youtube-cookies.txt')
        if (fs.existsSync(cookieFile) && fs.statSync(cookieFile).size > 10) return true
        if (!this.token) return false

        try {
            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/youtube-cookies.txt`
            const res = await fetch(downloadUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            })
            if (!res.ok) return false
            const text = await res.text()
            if (text && text.length > 10) {
                fs.writeFileSync(cookieFile, text, 'utf8')
                botLogger.system('✅ [CloudSync] YouTube cookies restored from HF Dataset!')
                return true
            }
            return false
        } catch (_) {
            return false
        }
    }

    async backupCookies() {
        const cookieFile = path.resolve('./storage/youtube-cookies.txt')
        if (!fs.existsSync(cookieFile) || !this.token) return null
        const content = fs.readFileSync(cookieFile)
        if (content.length === 0) return null

        try {
            const res = await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'youtube-cookies.txt',
                    content: new Blob([content])
                },
                commitTitle: 'Automated YouTube cookies backup [skip ci]'
            })
            return res
        } catch (_) {
            return null
        }
    }

    // ─────────────────────────────────────────────
    // 4.5. DYNAMIC SKILLS SYNC
    // ─────────────────────────────────────────────

    async restoreDynamicSkills() {
        const skillsFile = path.resolve('./storage/dynamic_skills.json')
        if (!this.token) return false

        try {
            const downloadUrl = `https://huggingface.co/datasets/${this.repo}/resolve/main/dynamic_skills.json`
            const res = await fetch(downloadUrl, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            })
            if (!res.ok) return false
            const text = await res.text()
            if (text && text.length > 10) {
                fs.writeFileSync(skillsFile, text, 'utf8')
                botLogger.system('✅ [CloudSync] Dynamic skills restored from HF Dataset!')
                return true
            }
            return false
        } catch (_) {
            return false
        }
    }

    async backupDynamicSkills() {
        const skillsFile = path.resolve('./storage/dynamic_skills.json')
        if (!fs.existsSync(skillsFile) || !this.token) return null
        const content = fs.readFileSync(skillsFile)
        if (content.length === 0) return null

        try {
            const res = await uploadFile({
                credentials: { accessToken: this.token },
                repo: { type: 'dataset', name: this.repo },
                file: {
                    path: 'dynamic_skills.json',
                    content: new Blob([content])
                },
                commitTitle: 'Automated dynamic skills library backup [skip ci]'
            })
            return res
        } catch (_) {
            return null
        }
    }

    // ─────────────────────────────────────────────
    // 5. FULL ALL-IN-ONE BACKUP & RESTORE
    // ─────────────────────────────────────────────

    async restoreAll(force = false) {
        botLogger.system(`☁️ [CloudSync] Initializing cloud memory sync from HF Dataset: ${this.repo}...`)
        const results = {
            database: await this.restoreDatabase(force),
            session: await this.restoreSession(),
            documents: await this.restoreDocuments(),
            cookies: await this.restoreCookies(),
            skills: await this.restoreDynamicSkills()
        }
        return results
    }

    async backupAll(reason = 'manual') {
        if (this.isBackingUp) return { ok: false, error: 'Backup already in progress' }
        this.isBackingUp = true
        this.lastBackupStatus = 'running'

        const startTime = Date.now()
        logger.info(`☁️ [CloudSync] Starting full cloud memory backup (${reason}) to ${this.repo}...`)

        try {
            const dbResult = await this.backupDatabase()
            const sessionResult = await this.backupSession()
            const docsResult = await this.backupDocuments()
            const cookieResult = await this.backupCookies()
            const skillsResult = await this.backupDynamicSkills()

            // Upload metadata summary
            const meta = {
                repo: this.repo,
                lastBackup: new Date().toISOString(),
                reason,
                dbSize: fs.existsSync(this.dbFile) ? fs.statSync(this.dbFile).size : 0,
                docsCount: fs.existsSync(this.docsDir) ? fs.readdirSync(this.docsDir).length : 0,
                elapsedMs: Date.now() - startTime
            }

            try {
                await uploadFile({
                    credentials: { accessToken: this.token },
                    repo: { type: 'dataset', name: this.repo },
                    file: {
                        path: 'backup-meta.json',
                        content: new Blob([Buffer.from(JSON.stringify(meta, null, 2))])
                    },
                    commitTitle: `Update backup metadata (${reason}) [skip ci]`
                })
            } catch (_) {}

            this.lastBackupTime = new Date()
            this.lastBackupStatus = 'success'
            logger.info(`✅ [CloudSync] Full backup completed in ${Date.now() - startTime}ms!`)

            return {
                ok: true,
                repo: this.repo,
                meta,
                commits: {
                    database: dbResult?.commit?.url,
                    session: sessionResult?.commit?.url,
                    documents: docsResult?.commit?.url,
                    cookies: cookieResult?.commit?.url,
                    skills: skillsResult?.commit?.url
                }
            }
        } catch (err) {
            this.lastBackupStatus = 'error'
            logger.error(`❌ [CloudSync] Backup failed: ${err.message}`)
            return { ok: false, error: err.message }
        } finally {
            this.isBackingUp = false
        }
    }

    /**
     * Trigger debounced backup (e.g. after note inserted or session changed)
     */
    triggerDebouncedBackup(delayMs = 30000) {
        if (this.backupDebounceTimer) {
            clearTimeout(this.backupDebounceTimer)
        }
        this.backupDebounceTimer = setTimeout(() => {
            this.backupAll('debounced')
        }, delayMs)
    }

    /**
     * Start background recurring sync (default: every 30 minutes)
     */
    initScheduler(intervalMs = 30 * 60 * 1000) {
        if (this.schedulerInterval) return
        this.schedulerInterval = setInterval(() => {
            this.backupAll('periodic-30m').catch(() => {})
        }, intervalMs)
        logger.info(`☁️ [CloudSync] Auto-sync scheduler active (interval: ${intervalMs / 60000}m)`)
    }
}

export const sessionSync = new SessionSyncService()
export default sessionSync
