import { logger } from '../../utils/logger.js'
import fs from 'fs'
import path from 'path'

export default {
    name: 'setjadwalgroup',
    aliases: ['jadwalgroup', 'setcegroup'],
    category: 'admin',
    description: 'Set grup saat ini sebagai target pengiriman reminder otomatis Jadwal Kuliah.',
    usage: '.setjadwalgroup',
    cooldown: 0,
    permissions: ['admin', 'owner'],
    async execute(ctx) {
        const { reply, react, chatId, isGroup } = ctx

        if (!isGroup) {
            return reply('⚠️ Command ini hanya bisa digunakan di dalam Grup!')
        }

        try {
            // Save to .env
            const envPath = path.resolve('.env')
            let envContent = fs.readFileSync(envPath, 'utf8')

            if (envContent.includes('CEF_GROUP_JID=')) {
                envContent = envContent.replace(/CEF_GROUP_JID=.*/g, `CEF_GROUP_JID=${chatId}`)
            } else {
                envContent += `\nCEF_GROUP_JID=${chatId}\n`
            }

            fs.writeFileSync(envPath, envContent)
            process.env.CEF_GROUP_JID = chatId

            await react('✅')
            await reply(`✅ Berhasil! Grup ini sekarang telah di-set sebagai target pengiriman reminder jadwal harian F-Class.\n\nSetiap jam 05:00 AM, bot akan mengirim jadwal untuk hari itu (jika ada).`)

        } catch (err) {
            logger.error('❌ Gagal save CEF_GROUP_JID:', err)
            await react('❌')
            await reply('❌ Gagal menyimpan pengaturan grup.')
        }
    }
}
