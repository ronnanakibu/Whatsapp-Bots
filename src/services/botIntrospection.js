// src/services/botIntrospection.js
import fs from 'fs'
import path from 'path'
import { getSocket } from '../utils/logger.js'
import { db } from './db.js'

class BotIntrospectionService {
    constructor() {
        this.groupsCache = null
        this.lastGroupsFetch = 0
        this.groupsTtlMs = 30000 // 30 detik TTL cache untuk menghindari query spam ke Baileys
    }

    /**
     * Ambil daftar grup yang di-join oleh bot secara aman dengan in-memory cache
     */
    async getParticipatingGroups(passedSock = null) {
        const now = Date.now()
        if (this.groupsCache && (now - this.lastGroupsFetch < this.groupsTtlMs)) {
            return this.groupsCache
        }

        const sock = passedSock || getSocket()
        if (!sock || typeof sock.groupFetchAllParticipating !== 'function') {
            return this.groupsCache || {}
        }

        try {
            const groups = await sock.groupFetchAllParticipating()
            this.groupsCache = groups || {}
            this.lastGroupsFetch = now
            return this.groupsCache
        } catch (err) {
            return this.groupsCache || {}
        }
    }

    /**
     * Hitung total grup aktif
     */
    async getGroupsCount(passedSock = null) {
        const groups = await this.getParticipatingGroups(passedSock)
        return Object.keys(groups).length
    }

    /**
     * Ambil sampel nama grup yang di-join bot
     */
    async getGroupsSample(limit = 5, passedSock = null) {
        const groups = await this.getParticipatingGroups(passedSock)
        return Object.values(groups).slice(0, limit).map(g => ({
            id: g.id,
            subject: g.subject || 'Tanpa Judul',
            participantsCount: g.participants?.length || 0
        }))
    }

    /**
     * Ambil statistik penggunaan resource & uptime server
     */
    getSystemHealth() {
        const mem = process.memoryUsage()
        const rssMB = Math.round(mem.rss / (1024 * 1024))
        const heapUsedMB = Math.round(mem.heapUsed / (1024 * 1024))
        const uptimeSec = Math.floor(process.uptime())

        const hours = Math.floor(uptimeSec / 3600)
        const minutes = Math.floor((uptimeSec % 3600) / 60)
        const seconds = uptimeSec % 60

        let uptimeStr = ''
        if (hours > 0) uptimeStr += `${hours} jam `
        if (minutes > 0 || hours > 0) uptimeStr += `${minutes} menit `
        uptimeStr += `${seconds} detik`

        const isRender = Boolean(process.env.RENDER || process.env.RENDER_EXTERNAL_URL)
        const platformStr = isRender ? 'Render Cloud (Linux Container)' : `${process.platform} (${process.arch})`

        return {
            rssMB,
            heapUsedMB,
            uptimeStr,
            uptimeSec,
            platform: platformStr,
            nodeVersion: process.version
        }
    }

    /**
     * Ambil identitas lengkap bot
     */
    getBotIdentity(passedSock = null) {
        const sock = passedSock || getSocket()
        const rawUser = sock?.user?.id || process.env.BOT_NUMBER || ''
        const botNumber = rawUser.split(':')[0].replace(/[^0-9]/g, '')

        let version = '6.0.0'
        try {
            const pkgPath = path.resolve('./package.json')
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
                if (pkg.version) version = pkg.version
            }
        } catch (_) {}

        return {
            name: 'RonnBot',
            version,
            botNumber: botNumber || 'Belum teridentifikasi',
            ownerName: process.env.OWNER_NAME || 'Rony Imanuel Sihombing',
            ownerNumber: '6285172013920',
            engine: 'Baileys Multi-Device + Hermes Agent OS',
            cloudRepo: process.env.HF_DATASET_REPO || 'ronnLbtrn/wabot-storage'
        }
    }

    /**
     * Ambil ringkasan database SQLite bot
     */
    getDatabaseSummary() {
        const summary = {
            usersCount: 0,
            songsCount: 0,
            notesCount: 0,
            dbSizeBytes: 0
        }

        const dbFile = path.resolve('./storage/database/main.db')
        if (fs.existsSync(dbFile)) {
            summary.dbSizeBytes = fs.statSync(dbFile).size
        }

        if (db) {
            try {
                const uRow = db.prepare('SELECT count(*) as count FROM users').get()
                summary.usersCount = uRow?.count || 0
            } catch (_) {}

            try {
                const sRow = db.prepare('SELECT count(*) as count FROM songs').get()
                summary.songsCount = sRow?.count || 0
            } catch (_) {}
        }

        const docsDir = path.resolve('./storage/documents')
        if (fs.existsSync(docsDir)) {
            try {
                summary.notesCount = fs.readdirSync(docsDir).length
            } catch (_) {}
        }

        return summary
    }

    /**
     * Ambil string ringkasan komprehensif untuk disuntikkan ke prompt LLM
     */
    async getIntrospectionContextPrompt(passedSock = null) {
        const identity = this.getBotIdentity(passedSock)
        const health = this.getSystemHealth()
        const dbSummary = this.getDatabaseSummary()
        const groupsCount = await this.getGroupsCount(passedSock)
        const groupsSample = await this.getGroupsSample(4, passedSock)

        const sampleText = groupsSample.length > 0
            ? groupsSample.map(g => `"${g.subject}" (${g.participantsCount} member)`).join(', ')
            : 'Belum ada grup'

        return `
🤖 [LIVE BOT SELF-AWARENESS & RUNTIME STATE]:
- Nama Bot: ${identity.name} v${identity.version} (Asisten Cerdas WhatsApp berbasis ${identity.engine})
- Pencipta & Owner: ${identity.ownerName} (@${identity.ownerNumber})
- Nomor WhatsApp Bot: +${identity.botNumber}
- Lingkungan Server: ${health.platform} | Node.js ${health.nodeVersion}
- Memori Server: ${health.rssMB} MB RSS (${health.heapUsedMB} MB Heap)
- Uptime Server: Berjalan aktif selama ${health.uptimeStr}
- Keanggotaan Grup: Saat ini bot BERGABUNG di ${groupsCount} grup WhatsApp aktif! (Contoh grup: ${sampleText})
- Statistik Database Lokal: ${dbSummary.usersCount} pengguna terdaftar, ${dbSummary.songsCount} lagu radio, ${dbSummary.notesCount} berkas catatan tersimpan
- Persistent Storage: Hugging Face Dataset (${identity.cloudRepo})

ATURAN KESADARAN DIRI:
- Jika ada pengguna yang bertanya tentang jumlah grup yang kamu ikuti, jumlah pengguna, RAM, uptime, owner, atau status mesinmu, KAMU TAHU PERSIS faktanya dari data di atas!
- JANGAN PERNAH katakan "Aku tidak tahu", "Aku cuma AI yang tidak join grup", dsb.! Jawablah dengan data nyata di atas secara bangga dan akurat.`
    }
}

export const botIntrospection = new BotIntrospectionService()
export default botIntrospection

