// src/commands/owner/update.js
import { isOwner } from '../../utils/permissions.js'
import { exec } from 'child_process'
import util from 'util'
import fs from 'fs'

const execPromise = util.promisify(exec)

export default {
    name: 'update',
    aliases: ['upgrade', 'gitpull'],
    category: 'owner',
    description: '[OWNER] Tarik commit terbaru dari GitHub (git pull origin main) dan restart PM2/bot secara otomatis.',
    usage: '.update',
    example: '.update',
    cooldown: 0,
    permissions: ['owner'],
    requireBotAdmin: false,
    tags: ['update', 'upgrade', 'git', 'pull', 'restart', 'owner'],
    params: {
        type: 'object',
        properties: {},
        required: []
    },

    async execute(ctx) {
        const { reply, react, sender, chatId } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        await react('⏳')
        await reply('🔄 *Memulai Pembaruan Sistem:* Menarik commit terbaru dari repository GitHub `main`...')

        try {
            const { stdout, stderr } = await execPromise('git pull origin main', { timeout: 30000 })
            const output = (stdout || stderr || '').trim()

            const restartSession = { chatId, active: true, time: Date.now() }
            fs.writeFileSync('./storage/restart.json', JSON.stringify(restartSession, null, 2))

            await react('✅')
            await reply(`📦 *Hasil Sinkronisasi Git:*\n\`\`\`\n${output}\n\`\`\`\n\n🚀 *Me-restart bot (PM2)...* Tunggu beberapa detik ya cuy!`)

            // Beri jeda 1 detik agar pesan WhatsApp terkirim sempurna sebelum proses keluar
            setTimeout(() => {
                process.exit(0)
            }, 1000)

        } catch (err) {
            await react('❌')
            await reply(`❌ *Gagal melakukan update:* ${err.message}`)
        }
    }
}
