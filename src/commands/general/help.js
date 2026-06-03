// src/commands/general/help.js
export default {
    name: 'help',
    aliases: ['menu', 'h'],
    category: 'general',
    description: 'Tampilkan semua command yang tersedia',
    usage: '!help [command]',
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
                `╭━━━〔 *Command Info* 〕━━━\n` +
                `┃ 📌 *Name:* ${cmd.name.toUpperCase()}\n` +
                `┃ 📝 *Description:* ${cmd.description}\n` +
                `┃ 💡 *Usage:* ${cmd.usage ?? '—'}\n` +
                `┃ 🔗 *Aliases:* ${cmd.aliases?.join(', ') ?? '—'}\n` +
                `┃ ⏳ *Cooldown:* ${cmd.cooldown ?? 0}s\n` +
                `┃ 📁 *Category:* ${cmd.category ?? '—'}\n` +
                `╰━━━━━━━━━━━━━━━━━━━━━━`
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

        let text = `╭━━━〔 *${botName.toUpperCase()} MENU* 〕━━━\n`
        text += `┃ 🤖 *Bot Name:* ${botName}\n`
        text += `┃ ⚡ *Prefix:* [ ${prefix} ]\n`
        text += `┃ 📦 *Total Commands:* ${totalCmds}\n`
        text += `╰━━━━━━━━━━━━━━━━━━━━━━\n\n`

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
            text += `╭── ❲ ${emoji} *${cat.toUpperCase()}* ❳ ──\n`
            text += cmds.map(c => `│ • ${prefix}${c.name}`).join('\n')
            text += `\n╰─────────────\n\n`
        }

        text += `💡 *Tip:* Ketik *${prefix}help [command]* untuk melihat detail.`

        await reply(text.trim())
    }
}