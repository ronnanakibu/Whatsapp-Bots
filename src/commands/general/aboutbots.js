// src/commands/general/aboutbots.js
// Perintah .aboutbots — Informasi Profil Developer & Mindmap Arsitektur Bot

export default {
    name: 'aboutbots',
    aliases: ['aboutbot', 'about', 'info', 'infobot'],
    category: 'general',
    description: 'Menampilkan detail profil developer serta mindmap arsitektur sistem WABOT 2.0',
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
        text += `• *Timezone:* Asia/Jakarta (GMT+7)\n`
        text += `• *RonnBot Dashboard:* http://ap2.nzb.zelpstore.id:${process.env.RADIO_PORT ?? '25637'}/dashboard\n`
        text += `• *Radio Dashboard:* http://ap2.nzb.zelpstore.id:${process.env.RADIO_PORT ?? '25637'}/radio\n\n`

        text += `──────────────────────────────\n\n`

        text += `*🌐 SYSTEM ARCHITECTURE MINDMAP*\n\n`
        text += `*Root (WABOT 2.0)*\n`
        text += ` ├── ⚙️ *Core Engine*\n`
        text += ` │    ├── \`start.js\` (Dotenv & Daemon Runner)\n`
        text += ` │    └── \`src/core/bot.js\` (Baileys Connection & Events)\n`
        text += ` ├── 🚀 *Command Modules* (\`src/commands/\`)\n`
        text += ` │    ├── \`entertainments/\` ➔ sound.js, meme.js\n`
        text += ` │    ├── \`general/\` ➔ changelogs.js, aboutbots.js\n`
        text += ` │    ├── \`group/\` ➔ pin.js (moderasi grup)\n`
        text += ` │    ├── \`owner/\` ➔ bc.js (broadcast owner)\n`
        text += ` │    └── \`utility/\` ➔ cuaca.js (laporan detail)\n`
        text += ` ├── 🧠 *System Services* (\`src/services/\`)\n`
        text += ` │    ├── \`interactive.js\` (Tanya-jawab interaktif)\n`
        text += ` │    └── \`memory.js\` (AI Context & Chat history)\n`
        text += ` ├── 🛠️ *Utility Helpers* (\`src/utils/\`)\n`
        text += ` │    ├── \`group.js\` (Role & Admin Validator)\n`
        text += ` │    ├── \`logger.js\` (Log Channel Buffer Queue)\n`
        text += ` │    └── \`rateLimiter.js\` (Cooldown Command Guard)\n`
        text += ` └── 🗄️ *Storage & DB*\n`
        text += `      ├── \`storage/database/main.db\` (SQLite3 Cache)\n`
        text += `      └── \`storage/sessions/\` (Kredensial Login WhatsApp)\n\n`

        text += `──────────────────────────────\n\n`

        text += `*🔄 MESSAGE EXECUTION WORKFLOW*\n\n`
        text += `*[Pesan Masuk]*\n`
        text += `      │\n`
        text += `      ▼\n`
        text += `*[Baileys Socket Connection]*\n`
        text += `      │\n`
        text += `      ▼\n`
        text += `*[src/utils/rateLimiter.js]* ➔ (Pencegahan Spam/Cooldown)\n`
        text += `      │\n`
        text += `      ▼\n`
        text += `*[src/core/bot.js]* ➔ (Parser & Router)\n`
        text += `      │\n`
        text += `      ├─ 💬 *[Obrolan Biasa / AI]* ➔ \`memory.js\` ➔ Call AI ➔ [Reply]\n`
        text += `      │\n`
        text += `      └─ 🚀 *[Command]* ➔ Panggil modul terkait (contoh: \`.cuaca\`)\n`
        text += `                │\n`
        text += `                ▼\n`
        text += `            *[API Open-Meteo]* ── (Gagal/502) ──➔ *[Google Weather]*\n`
        text += `                │ (Sukses)                              │ (Sukses)\n`
        text += `                ▼                                       ▼\n`
        text += `            *[Kirim Hasil]* 💻                      *[Kirim Hasil]* 💻\n`
        text += `                │                                       │\n`
        text += `                └───────────────────┬───────────────────┘\n`
        text += `                                    │\n`
        text += `                                    ▼\n`
        text += `                  *[src/utils/logger.js]* (Queue 2.5s)\n`
        text += `                                    │\n`
        text += `                                    ▼\n`
        text += `                  *[WhatsApp Log Channel]* 📜\n\n`

        text += `──────────────────────────────\n\n`
        text += `💡 *Ketik \`.menu\` untuk melihat seluruh daftar perintah bot.*`

        await reply(text.trim())
    }
}
