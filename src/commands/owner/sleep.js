// src/commands/owner/sleep.js
import { isOwner } from '../../utils/permissions.js'
import fs from 'fs'

const SLEEP_FILE = './storage/sleep.flag'

export default {
    name: 'sleep',
    aliases: ['tidur', 'pause'],
    category: 'owner',
    description: '[OWNER] Mengubah status bot menjadi mode tidur (silent/deafen).',
    usage: '.sleep',
    cooldown: 0,
    permissions: ['owner'],

    async execute(ctx) {
        const { reply, react, sender, args } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        if (args.length > 0) {
            return reply('⚠️ Perintah `.sleep` tidak menerima input/argumen tambahan apapun, cuy.')
        }

        if (fs.existsSync(SLEEP_FILE)) {
            return reply('😴 Bot sudah dalam mode tidur, cuy. Gunakan `.wake`, `.bangun`, atau `.pagi` untuk membangunkan.')
        }

        // Tulis flag file ke storage
        fs.writeFileSync(SLEEP_FILE, 'true')
        await react('😴')
        return reply('😴 *Bot Mode Tidur!* Bot sekarang masuk mode *deafen* (silent total) dan akan mengabaikan seluruh perintah sampai lu bangunin lagi pake `.wake` / `.bangun` / `.pagi`.')
    }
}