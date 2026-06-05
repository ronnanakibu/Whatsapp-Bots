// src/commands/general/help.js
export default {
    name: 'help',
    aliases: ['menu', 'h'],
    category: 'general',
    description: 'Tampilkan semua command yang tersedia',
    usage: '.help [command]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply } = ctx
        const { commands } = await import('../../core/loader.js')
        const prefix = process.env.BOT_PREFIX ?? '!'
        const botName = process.env.BOT_NAME ?? 'RonnBot'

        // !help [nama command] — detail satu command
        if (args.length) {
            const cmd = commands.get(args[0].toLowerCase())
            if (!cmd) return reply(`❌ Command *${args[0]}* tidak ditemukan.`)

            return reply(
                `📊 *COMMAND DETAILS: ${cmd.name.toUpperCase()}*\n` +
                `────────────────────────\n` +
                `📌 *Name:*  \`${cmd.name}\`\n` +
                `📝 *Description:*  ${cmd.description}\n` +
                `💡 *Usage:*  \`${cmd.usage ?? '—'}\`\n` +
                `🔗 *Aliases:*  ${cmd.aliases?.map(a => `\`${a}\``).join(', ') ?? '—'}\n` +
                `⏳ *Cooldown:*  *${cmd.cooldown ?? 0}s*\n` +
                `📁 *Category:*  *${cmd.category ?? '—'}*\n` +
                `────────────────────────`
            )
        }

        // Group by category
        const categories = {}
        for (const [, cmd] of commands) {
            if (!cmd.name) continue
            const cat = cmd.category ?? 'misc'
            if (!categories[cat]) categories[cat] = []
            if (!categories[cat].find(c => c.name === cmd.name)) {
                categories[cat].push(cmd)
            }
        }

        const totalCmds = Object.values(categories).flat().length

        let text = `🌐 *${botName.toUpperCase()} WEB DASHBOARD:*\n`
        text += `http://ap2.nzb.zelpstore.id:${process.env.RADIO_PORT ?? '25637'}/dashboard\n`
        text += `Kalau Gabisa, pas di browser, hapus http:// nya ya..\n\n`
        text += `┌───────────────────────\n`
        text += `│  🤖 *${botName.toUpperCase()} SERVICES*\n`
        text += `│  ⚡ *Prefix:*  \`[ ${prefix} ]\`\n`
        text += `│  📦 *Commands:*  *${totalCmds} total*\n`
        text += `└───────────────────────\n\n`
        text += `Berikut daftar perintah yang tersedia di sistem kami:\n\n`

        const categoryEmoji = {
            general: '🔧',
            ai: '🤖',
            media: '🎨',
            owner: '👑',
            group: '👥',
            admin: '🛡️',
            utility: '🛠️',
            radio: '📻',
            entertainments: '🎮',
            misc: '📦'
        }

        for (const [cat, cmds] of Object.entries(categories)) {
            const emoji = categoryEmoji[cat] ?? '📦'
            text += `*${emoji} ${cat.toUpperCase()}*\n`
            text += `└─ ` + cmds.map(c => `\`${prefix}${c.name}\``).join('  ') + `\n\n`
        }

        text += `────────────────────────\n`
        text += `💡 *Tip:* Ketik *${prefix}help [nama_command]* untuk panduan detail.`

        await reply(text.trim())
    }
}