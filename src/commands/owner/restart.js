// src/commands/owner/restart.js
import { isOwner } from '../../utils/permissions.js'
import { sendPowerAction } from '../../services/pterodactyl.js'
import fs from 'fs'

export default {
    name: 'restart',
    aliases: ['reboot'],
    category: 'owner',
    description: '[OWNER] Memicu restart server container via Pterodactyl API.',
    usage: '.restart',
    example: '.restart',
    cooldown: 0,
    permissions: ['owner'],
    requireBotAdmin: false,
    tags: ['restart', 'reboot', 'pterodactyl', 'container', 'server', 'owner'],
    params: {
        type: 'object',
        properties: {},
        required: []
    },

    async execute(ctx) {
        const { reply, react, sender, chatId, args } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        const shouldPull = args.includes('--pull') || args.includes('-p') || args.includes('update')
        if (args.length > 0 && !shouldPull) {
            return reply('⚠️ Gunakan `.restart` untuk restart biasa atau `.restart --pull` untuk tarik kode terbaru dari GitHub lalu restart.')
        }

        await react('🔄')

        if (shouldPull) {
            try {
                const { execSync } = await import('child_process')
                const pullOutput = execSync('git pull origin main', { encoding: 'utf8', timeout: 30000 })
                await reply(`📦 *Git Pull Sukses:*\n\`\`\`\n${pullOutput.trim()}\n\`\`\``)
            } catch (gitErr) {
                await reply(`⚠️ *Git Pull Gagal:* ${gitErr.message}\nTetap melanjutkan proses restart...`)
            }
        }

        await reply('🔄 *Rebooting Bot:* Mengirim sinyal restart ke PM2/Server... Tunggu sebentar ya, cuy.')

        // Simpan sesi room chat biar pas bot up, dia bisa ngirim pesan broadcast sukses
        const restartSession = { chatId, active: true, time: Date.now() }
        fs.writeFileSync('./storage/restart.json', JSON.stringify(restartSession, null, 2))

        // Panggil service Pterodactyl
        const success = await sendPowerAction('restart')

        if (!success) {
            // Fallback: jika API Key tidak ada atau panel down, paksa exit process biar start.js/PM2 yg take over
            setTimeout(() => { process.exit(0) }, 1000)
        }
    }
}