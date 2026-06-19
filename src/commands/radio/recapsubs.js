import { db } from '../../services/db.js'
import { initRecapScheduler } from './recap.js'

export default {
    name: 'recapsubs',
    aliases: ['subrecap', 'langgananrekap'],
    category: 'radio',
    description: 'Langganan atau berhenti berlangganan laporan rekap radio mingguan otomatis.',
    usage: '.recapsubs',
    cooldown: 5,
    permissions: ['owner'], // Hanya owner yang boleh mendaftarkan grup langganan

    async execute(ctx) {
        const { reply, react, chatId, sock } = ctx
        
        // Pastikan scheduler berjalan
        initRecapScheduler(sock)

        await react('⏳')

        try {
            // Pastikan tabel recap_subscriptions ada
            db.exec(`
                CREATE TABLE IF NOT EXISTS recap_subscriptions (
                    chat_id TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
            `)

            const existing = db.prepare('SELECT chat_id FROM recap_subscriptions WHERE chat_id = ?').get(chatId)

            if (existing) {
                db.prepare('DELETE FROM recap_subscriptions WHERE chat_id = ?').run(chatId)
                await react('✅')
                return reply('🗑️ *Berhasil Berhenti Berlangganan!* Grup ini tidak akan lagi menerima rekap radio mingguan otomatis.')
            } else {
                db.prepare('INSERT INTO recap_subscriptions (chat_id) VALUES (?)').run(chatId)
                await react('✅')
                return reply('✅ *Berhasil Berlangganan!*\n\nGrup ini akan menerima laporan rekap radio mingguan otomatis setiap hari *Senin pukul 00:00 (Tengah Malam)*.')
            }
        } catch (err) {
            await react('❌')
            return reply(`❌ Gagal mengubah status langganan: ${err.message}`)
        }
    }
}
