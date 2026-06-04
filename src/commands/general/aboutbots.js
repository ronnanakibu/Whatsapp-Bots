// src/commands/general/aboutbots.js
// Perintah .aboutbots — Informasi Profil Developer & Ringkasan Arsitektur Bot

export default {
    name: 'aboutbots',
    aliases: ['aboutbot', 'about', 'info', 'infobot'],
    category: 'general',
    description: 'Menampilkan detail profil developer serta arsitektur sistem WABOT 2.0',
    usage: '.aboutbots',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply } = ctx

        const ownerName = process.env.OWNER_NAME || 'Ronn'
        const botName = process.env.BOT_NAME || 'RonnBot'

        let text = `🤖 *ROBOT PROFILE & SYSTEM ARCHITECTURE*\n\n`

        text += `*👤 OWNER & DEVELOPER:*\n`
        text += `• *Nama Creator:* ${ownerName} (Ronn Anakibu)\n`
        text += `• *GitHub:* https://github.com/ronnanakibu\n`
        text += `• *Vibe:* JavaScript / TypeScript Backend Developer\n\n`

        text += `*🤖 BOT IDENTITIES:*\n`
        text += `• *Nama Bot:* ${botName} (WABOT 2.0)\n`
        text += `• *Base Engine:* WhiskeySockets Baileys (WebSocket Connection)\n`
        text += `• *Database Cache:* Better-SQLite3 (High Performance SQL)\n`
        text += `• *Timezone:* Asia/Jakarta (GMT+7)\n\n`

        text += `──────────────────────────────\n\n`

        text += `*📂 CORE SYSTEM ARCHITECTURE*\n`
        text += `Sistem RonnBot dibangun dengan struktur folder modular & mandiri:\n\n`

        text += `• *Core Engine:* \`src/core/bot.js\` — Inisialisasi socket Baileys, kelola autentikasi sesi, serta monitoring status bot.\n`
        text += `• *Command Modules:* Perintah terbagi rapi berdasarkan kategori di \`src/commands/\` (\`entertainments\`, \`general\`, \`group\`, \`owner\`, \`utility\`).\n`
        text += `• *AI Context Memory:* \`src/services/memory.js\` — Mengisolasi riwayat chat AI per chat room.\n`
        text += `• *Dynamic Redundancy:* Sistem cuaca yang otomatis melakukan fallback bertingkat jika server penyedia cuaca mengalami gangguan (Open-Meteo ➡️ Google Weather ➡️ WeatherAPI).\n`
        text += `• *Realtime Logger Channel:* Mengalirkan event log aktivitas bot ke WhatsApp Log Channel secara efisien menggunakan antrian buffer & perlindungan infinite loop.\n`
        text += `• *Automated Pipeline:* \`deploy.js\` — Pipeline otomatis sekali ketik untuk delta-sync SFTP ke panel Pterodactyl dan backup repositori ke GitHub.\n\n`

        text += `──────────────────────────────\n\n`
        text += `💡 *Ketik \`.menu\` untuk melihat seluruh daftar perintah bot.*`

        await reply(text.trim())
    }
}
