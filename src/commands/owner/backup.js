// src/commands/owner/backup.js
import fs from 'fs'
import path from 'path'
import { sessionSync } from '../../services/sessionSync.js'
import { isOwner } from '../../utils/permissions.js'

export default {
    name: 'backup',
    aliases: ['syncstorage', 'cloudsync', 'savecloud'],
    category: 'owner',
    description: 'Sinkronisasi memori & database bot ke Hugging Face Dataset (Persistent Storage)',
    usage: '.backup [now | restore | clearsession | status]',
    example: '.backup now\n.backup restore\n.backup clearsession\n.backup status',
    cooldown: 5,
    permissions: ['owner'],

    async execute(ctx) {
        const { args, reply, react, sender } = ctx

        if (!isOwner(sender)) {
            return reply('❌ Perintah ini khusus owner bot.')
        }

        const sub = (args[0] || 'status').toLowerCase().trim()

        if (sub === 'now' || sub === 'sync' || sub === 'upload') {
            await react('⏳')
            await reply(`☁️ *Memulai Sinkronisasi Cloud Memory ke Hugging Face Dataset...*\n\nRepo: \`${sessionSync.repo}\`\nMohon tunggu beberapa detik...`)

            try {
                const res = await sessionSync.backupAll('manual_owner_command')
                if (!res.ok) {
                    await react('❌')
                    return reply(`❌ Gagal backup: ${res.error || 'Terjadi kesalahan'}`)
                }

                await react('✅')
                const dbSizeKb = (res.meta.dbSize / 1024).toFixed(1)
                const elapsed = (res.meta.elapsedMs / 1000).toFixed(1)

                let commitText = ''
                if (res.commits?.database) commitText += `\n• Database Commit: ${res.commits.database}`
                if (res.commits?.session) commitText += `\n• Sesi Commit: ${res.commits.session}`

                return reply(
                    `✅ *Pencadangan Berhasil Disimpan di Cloud!* 🎉\n\n` +
                    `📦 *Dataset Repo:* https://huggingface.co/datasets/${res.repo}\n` +
                    `💾 *Ukuran Database:* ${dbSizeKb} KB\n` +
                    `📁 *Dokumen & Catatan:* ${res.meta.docsCount} berkas\n` +
                    `⏱️ *Waktu Proses:* ${elapsed} detik\n` +
                    `📅 *Waktu Sinkron:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n` +
                    commitText + `\n\n` +
                    `_Memori bot aman dari restart, redeploy, maupun downtime server._`
                )
            } catch (err) {
                await react('❌')
                return reply(`❌ Terjadi error saat backup: ${err.message}`)
            }
        }

        if (sub === 'restore' || sub === 'pull') {
            await react('⏳')
            await reply(`☁️ *Memeriksa dan Memulihkan Data dari Hugging Face Dataset...*`)

            try {
                const res = await sessionSync.restoreAll(true)
                await react('✅')
                return reply(
                    `✅ *Pemulihan Data Selesai!*\n\n` +
                    `• Database: ${res.database ? '✅ Terpulihkan' : '⚠️ Dilewati / Tidak Ada'}\n` +
                    `• Sesi WhatsApp: ${res.session ? '✅ Terpulihkan' : '⚠️ Sudah Ada / Dilewati'}\n` +
                    `• Dokumen Materi: ${res.documents ? '✅ Terpulihkan' : '⚠️ Tidak Ada Perubahan'}\n\n` +
                    `_Data telah disinkronkan ke penyimpanan lokal bot._`
                )
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal restore data: ${err.message}`)
            }
        }

        if (sub === 'clearsession' || sub === 'purgesession') {
            await react('⏳')
            try {
                const deleted = await sessionSync.deleteCloudSession()
                await react('✅')
                return reply(
                    `🗑️ *Pembersihan Sesi Cloud Selesai!*\n\n` +
                    `Status: ${deleted ? '✅ Sesi kedaluwarsa berhasil dihapus dari HF Dataset.' : 'ℹ️ Sesi di HF Dataset sudah bersih atau tidak ditemukan.'}\n\n` +
                    `_Bot berikutnya yang dinyalakan akan meminta pairing code / scan QR baru._`
                )
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal membersihkan sesi cloud: ${err.message}`)
            }
        }

        // Status default
        const dbFile = path.resolve('./storage/database/main.db')
        const credsFile = path.resolve('./storage/sessions/creds.json')
        const docsDir = path.resolve('./storage/documents')
        const skillsFile = path.resolve('./storage/dynamic_skills.json')

        const dbExists = fs.existsSync(dbFile)
        const dbSize = dbExists ? `${(fs.statSync(dbFile).size / 1024).toFixed(1)} KB` : 'Belum dibuat'
        const sessionExists = fs.existsSync(credsFile)
        const docsCount = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).length : 0
        let skillsCount = 0
        try {
            if (fs.existsSync(skillsFile)) {
                skillsCount = JSON.parse(fs.readFileSync(skillsFile, 'utf8')).length || 0
            }
        } catch (_) {}

        const hasToken = Boolean(sessionSync.token)
        const lastTime = sessionSync.lastBackupTime
            ? sessionSync.lastBackupTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'
            : 'Belum pernah di sesi ini'

        return reply(
            `☁️ *STATUS PERSISTENT STORAGE (HUGGING FACE DATASET)*\n\n` +
            `• *Dataset Target:* \`${sessionSync.repo}\`\n` +
            `• *HF Token Terpasang:* ${hasToken ? '✅ Ya (`HF_TOKEN`)' : '❌ Tidak ditemukan'}\n` +
            `• *Database Lokal (main.db):* ${dbExists ? `✅ Ada (${dbSize})` : '❌ Kosong'}\n` +
            `• *Sesi WhatsApp:* ${sessionExists ? '✅ Terkoneksi & Tersimpan' : '⚠️ Belum login'}\n` +
            `• *Dokumen Materi:* 📁 ${docsCount} berkas\n` +
            `• *Dynamic Skills Tersimpan:* ⚡ ${skillsCount} skrip otomatis\n` +
            `• *Terakhir Dicadangkan:* ${lastTime}\n` +
            `• *Status Scheduler:* 🟢 Aktif otomatis tiap 30 menit & saat shutdown\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *Perintah Pengoperasian:*\n` +
            `• Paksa Backup Sekarang: *.backup now*\n` +
            `• Pulihkan dari Cloud: *.backup restore*\n` +
            `• Tautan Pengaturan: https://huggingface.co/datasets/${sessionSync.repo}/settings`
        )
    }
}

