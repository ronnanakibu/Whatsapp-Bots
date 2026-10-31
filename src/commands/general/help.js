// src/commands/general/help.js
import fs from 'fs'
import path from 'path'
import { db } from '../../services/db.js'
import { getDashboardUrl } from '../../utils/url.js'

let cachedTotalUsers = 0
let lastUserCountFetch = 0
const USER_COUNT_CACHE_TTL = 5 * 60 * 1000 // 5 menit

export default {
    name: 'help',
    aliases: [
        'menu', 'h',
        'aimenu',
        'mediamenu', 'imagemenu',
        'downloadmenu', 'downloadermenu',
        'toolsmenu', 'utilitymenu',
        'audiomenu', 'radiomenu', 'musicmenu',
        'groupmenu', 'adminmenu',
        'generalmenu',
        'entertainmentmenu', 'funmenu',
        'ownermenu'
    ],
    category: 'general',
    description: 'Tampilkan daftar semua command dan panduan penggunaan bot.',
    usage: '.help [kategori | command]',
    example: '.help ai',
    cooldown: 3,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['help', 'menu', 'panduan', 'commands', 'bantuan', 'general'],
    params: {
        type: 'object',
        properties: {
            kategoriOrCommand: {
                type: 'string',
                description: 'Nama kategori menu atau nama command spesifik untuk melihat panduan detail'
            }
        },
        required: []
    },

    async execute(ctx) {
        const { args, reply } = ctx
        const prefix = process.env.BOT_PREFIX ?? '.'

        // Resolve commands from Unified Registry or fallback to loader
        let commandsMap = new Map()
        try {
            const { getAllCommands } = await import('../../core/registry.js')
            commandsMap = getAllCommands()
        } catch (_) {
            const { commands } = await import('../../core/loader.js')
            commandsMap = commands
        }

        // 1. Resolve active category if any
        let activeMenu = null
        const cmdName = (ctx.commandName || '').toLowerCase()
        if (cmdName.endsWith('menu') && cmdName !== 'menu') {
            activeMenu = cmdName.replace('menu', '')
        }

        const numberMap = {
            '1': 'ai',
            '2': 'media',
            '3': 'downloader',
            '4': 'tools',
            '5': 'audio',
            '6': 'group',
            '7': 'general',
            '8': 'entertainment',
            '9': 'owner'
        }

        if (!activeMenu && args.length) {
            const arg = args[0].toLowerCase()
            if (numberMap[arg]) {
                activeMenu = numberMap[arg]
            } else if (arg.endsWith('menu') && arg !== 'menu') {
                activeMenu = arg.replace('menu', '')
            } else {
                activeMenu = arg
            }
        }

        const categoryAliases = {
            ai: 'ai',
            assistant: 'ai',
            media: 'media',
            image: 'media',
            video: 'media',
            stiker: 'media',
            sticker: 'media',
            downloader: 'downloader',
            download: 'downloader',
            dl: 'downloader',
            tools: 'tools',
            utility: 'tools',
            util: 'tools',
            audio: 'audio',
            music: 'audio',
            radio: 'audio',
            group: 'group',
            admin: 'group',
            general: 'general',
            info: 'general',
            entertainment: 'entertainment',
            fun: 'entertainment',
            hiburan: 'entertainment',
            game: 'entertainment',
            games: 'entertainment',
            owner: 'owner'
        }

        let targetCategory = activeMenu ? (categoryAliases[activeMenu] || null) : null

        // .help [nama command] — detail satu command
        if (args.length && !targetCategory) {
            const cleanArg = args[0].toLowerCase().replace(/^[.!/]+/, '')
            let cmd = commandsMap.get(cleanArg)
            if (!cmd) {
                // Search aliases
                for (const [, c] of commandsMap) {
                    if (c.aliases && c.aliases.includes(cleanArg)) {
                        cmd = c
                        break
                    }
                }
            }

            if (!cmd) return reply(`❌ Command *${args[0]}* tidak ditemukan.`)

            return reply(
                `📊 *COMMAND DETAILS: ${cmd.name.toUpperCase()}*\n` +
                `────────────────────────\n` +
                `📌 *Name:*  \`${cmd.name}\`\n` +
                `📝 *Description:*  ${cmd.description || '—'}\n` +
                `💡 *Usage:*  \`${cmd.usage ?? `.${cmd.name}`}\`\n` +
                `🔗 *Aliases:*  ${cmd.aliases?.map(a => `\`${a}\``).join(', ') || '—'}\n` +
                `⏳ *Cooldown:*  *${cmd.cooldown ?? 0}s*\n` +
                `📁 *Category:*  *${cmd.category ?? 'general'}*\n` +
                `🔒 *Permissions:*  *${(cmd.permissions || ['user']).join(', ')}*\n` +
                `────────────────────────`
            )
        }

        // Group commands by canonical categories
        const CANONICAL_ORDER = [
            'ai',
            'media',
            'downloader',
            'tools',
            'audio',
            'group',
            'general',
            'entertainment',
            'owner'
        ]

        const categories = {}
        for (const cat of CANONICAL_ORDER) {
            categories[cat] = []
        }

        for (const [, cmd] of commandsMap) {
            if (!cmd.name) continue
            let cat = cmd.category || 'general'
            if (cat === 'utility') cat = 'tools'
            if (cat === 'entertainments') cat = 'entertainment'
            if (cat === 'admin') cat = 'group'
            if (cat === 'radio') cat = 'audio'

            if (!categories[cat]) categories[cat] = []
            if (!categories[cat].find(c => c.name === cmd.name)) {
                categories[cat].push(cmd)
            }
        }

        const categoryMeta = {
            ai: { title: '🤖 AI & ASSISTANT', emoji: '🤖' },
            media: { title: '🎨 IMAGE & MEDIA', emoji: '🎨' },
            downloader: { title: '📥 DOWNLOADER', emoji: '📥' },
            tools: { title: '🛠️ TOOLS & UTILITY', emoji: '🛠️' },
            audio: { title: '🎵 AUDIO & MUSIC', emoji: '🎵' },
            group: { title: '🛡️ GROUP & ADMIN', emoji: '🛡️' },
            general: { title: '🔧 GENERAL & INFO', emoji: '🔧' },
            entertainment: { title: '🎉 ENTERTAINMENT & FUN', emoji: '🎉' },
            owner: { title: '👑 OWNER SUITE', emoji: '👑' }
        }

        // Render specific submenu if requested
        if (targetCategory && categoryMeta[targetCategory]) {
            const meta = categoryMeta[targetCategory]
            const cmdList = categories[targetCategory] || []

            let text = `╭───〔 ${meta.title} 〕───⬣\n`
            text += `│ Berikut daftar perintah dalam kategori ini:\n`
            text += `╰──────────────⬣\n\n`

            if (cmdList.length === 0) {
                text += `(Tidak ada perintah)\n`
            } else {
                text += `┌〔 DAFTAR PERINTAH 〕\n`
                for (const cmd of cmdList) {
                    text += `│ ${meta.emoji} *${prefix}${cmd.name}*\n`
                    text += `│   └─ ${cmd.description || 'Tidak ada deskripsi'}\n`
                }
                text += `└──────────────\n\n`
            }

            text += `💡 Ketik *${prefix}help [nama_command]* untuk melihat cara pakai detail.\n`
            text += `🔙 Ketik *${prefix}menu* untuk melihat seluruh daftar menu.`

            return reply(text.trim())
        }

        // Fetch user count with caching
        let usersCount = cachedTotalUsers
        if (Date.now() - lastUserCountFetch >= USER_COUNT_CACHE_TTL) {
            if (cachedTotalUsers === 0) {
                try {
                    const groups = await ctx.sock.groupFetchAllParticipating()
                    const participants = new Set()
                    for (const group of Object.values(groups)) {
                        if (group.participants) {
                            for (const p of group.participants) {
                                participants.add(p.id)
                            }
                        }
                    }
                    cachedTotalUsers = participants.size
                    lastUserCountFetch = Date.now()
                    usersCount = cachedTotalUsers
                } catch (e) {
                    try {
                        const userCountRow = db.prepare('SELECT COUNT(*) as count FROM users').get()
                        usersCount = userCountRow ? userCountRow.count : 0
                    } catch (dbErr) {
                        usersCount = 0
                    }
                }
            } else {
                ctx.sock.groupFetchAllParticipating().then(groups => {
                    const participants = new Set()
                    for (const group of Object.values(groups)) {
                        if (group.participants) {
                            for (const p of group.participants) {
                                participants.add(p.id)
                            }
                        }
                    }
                    cachedTotalUsers = participants.size
                    lastUserCountFetch = Date.now()
                }).catch(() => { })
            }
        }

        // Live runtime calculation
        const uptime = process.uptime()
        const hours = Math.floor(uptime / 3600)
        const minutes = Math.floor((uptime % 3600) / 60)
        const seconds = Math.floor(uptime % 60)

        const runtimeParts = []
        if (hours > 0) runtimeParts.push(`${hours} jam`)
        if (minutes > 0) runtimeParts.push(`${minutes} menit`)
        if (seconds > 0 || runtimeParts.length === 0) runtimeParts.push(`${seconds} detik`)
        const runtimeStr = runtimeParts.join(' ')

        // Get bot version from package.json
        let botVersion = '6.0.0'
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'))
            botVersion = pkg.version || '6.0.0'
        } catch (_) { }

        const dashboardUrl = getDashboardUrl()

        // Full clean Prompt Menu Layout
        let menuText = `╭───〔 *RONN BOT AUTOMATION* 〕───⬣\n`
        menuText += `│ 👋 Hai, *${ctx.pushName || 'User'}*!\n`
        menuText += `│\n`
        menuText += `│ 📊 Runtime : *${runtimeStr}*\n`
        menuText += `│ 👥 Users   : *${usersCount} pengguna*\n`
        menuText += `│ ⚡ Version : *v${botVersion}*\n`
        menuText += `│ 🔗 *Dashboard:* ${dashboardUrl}\n`
        menuText += `╰───────────────────────────────⬣\n\n`

        for (const catKey of CANONICAL_ORDER) {
            const meta = categoryMeta[catKey]
            const list = categories[catKey] || []
            if (list.length === 0) continue

            menuText += `┌〔 ${meta.title} 〕\n`
            for (const cmd of list) {
                menuText += `│ ▫️ *${prefix}${cmd.name}* — ${cmd.description || '—'}\n`
            }
            menuText += `└──────────────────────────────\n\n`
        }

        menuText += `💡 *Tips Penggunaan:*\n`
        menuText += `• Ketik *${prefix}help [kategori]* (misal: *${prefix}help ai* atau *${prefix}help media*)\n`
        menuText += `• Ketik *${prefix}help [command]* (misal: *${prefix}help ping*)\n\n`
        menuText += `_Powered by Ronn Bot Automation_`

        return reply(menuText.trim())
    }
}
