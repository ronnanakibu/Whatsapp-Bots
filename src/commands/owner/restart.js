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
    cooldown: 0,
    permissions: ['owner'],

    async execute(ctx) {
        const { reply, react, sender, chatId, args } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        if (args.length > 0) {
            return reply('⚠️ Perintah `.restart` tidak menerima argumen tambahan, cuy.')
        }

        await react('🔄')
        await reply('🔄 *Pterodactyl Reboot:* Mengirim sinyal restart ke panel... Tunggu sebentar ya, cuy.')

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