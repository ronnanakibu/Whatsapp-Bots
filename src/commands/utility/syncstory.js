// src/commands/utility/syncstory.js
// !syncstory — Sinkronisasi manual Instagram Story @comeinone.f ke Website Kelas CE F

import { syncInstagramStories } from '../../services/storySync.js'

export default {
    name: 'syncstory',
    aliases: ['cekstory', 'igstory', 'archivestory', 'syncig'],
    category: 'utility',
    description: 'Cek story terbaru Instagram @comeinone.f dan arsipkan otomatis ke website kelas.',
    usage: '!syncstory',
    cooldown: 15,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, react, sock, chatId } = ctx

        await react('⏳')
        await reply('🔄 *Sedang memeriksa story terbaru dari Instagram @comeinone.f...*\n_Mohon tunggu sebentar, bot sedang mengunduh & memeriksa duplikasi arsip._')

        try {
            const result = await syncInstagramStories(sock, { notifyChatId: chatId })

            if (result.totalFound === 0) {
                await react('ℹ️')
                return reply('ℹ️ *Tidak Ada Story Baru*\n\nAkun Instagram *@comeinone.f* sedang tidak memiliki story aktif dalam 24 jam terakhir.')
            }

            const newlySyncedCount = result.synced.length
            const skippedCount = result.skipped.length
            const errorCount = result.errors.length

            let responseText = `📊 *Laporan Sinkronisasi Story Instagram*\n\n`
            responseText += `📸 *Target*: @comeinone.f\n`
            responseText += `🔍 *Total Story Terdeteksi*: ${result.totalFound}\n`
            responseText += `✅ *Berhasil Diarsipkan*: ${newlySyncedCount}\n`
            responseText += `⏩ *Sudah Pernah Ada (Skip)*: ${skippedCount}\n`

            if (errorCount > 0) {
                responseText += `⚠️ *Gagal Diproses*: ${errorCount}\n`
            }

            if (newlySyncedCount > 0) {
                responseText += `\n✨ *Story yang baru saja masuk arsip:*\n`
                for (const item of result.synced) {
                    responseText += `• ID: \`${item.igStoryId}\` (${item.filename})\n`
                }
                responseText += `\n🌐 *Lihat Arsip*: https://cef25.my.id\n`
            }

            await react('✅')
            return reply(responseText)
        } catch (err) {
            await react('❌')
            return reply(`❌ *Gagal melakukan sinkronisasi story:*\n${err.message}`)
        }
    }
}
