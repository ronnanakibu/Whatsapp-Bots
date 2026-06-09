// src/commands/owner/wake.js
import { isOwner } from '../../utils/permissions.js'
import fs from 'fs'

const SLEEP_FILE = './storage/sleep.flag'

export default {
    name: 'wake',
    aliases: ['bangun', 'pagi', 'resume'],
    category: 'owner',
    description: '[OWNER] Membangunkan bot dari mode tidur (silent mode).',
    usage: '.wake',
    cooldown: 0,
    permissions: ['owner'],

    async execute(ctx) {
        const { reply, react, sender, args } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        if (args.length > 0) {
            return reply('⚠️ Perintah ini tidak menerima argumen tambahan, cuy.')
        }

        if (!fs.existsSync(SLEEP_FILE)) {
            return reply('🦁 Bot sudah dalam kondisi bangun dan responsif kok, cuy.')
        }

        // Hapus flag file untuk mengaktifkan kembali bot
        fs.unlinkSync(SLEEP_FILE)
        await react('🦁')
        return reply('🦁 *Bot Bangun!* Sistem kembali aktif, responsif, dan siap menerima instruksi dari publik.')
    }
}