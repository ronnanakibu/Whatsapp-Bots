// src/commands/general/help.js
import fs from 'fs'
import path from 'path'
import { db } from '../../services/db.js'

let cachedTotalUsers = 0
let lastUserCountFetch = 0
const USER_COUNT_CACHE_TTL = 5 * 60 * 1000 // 5 menit

export default {
    name: 'help',
    aliases: [
        'menu', 'h',
        'aimenu',
        'audiomenu', 'radiomenu',
        'downloadmenu', 'downloadermenu',
        'imagemenu', 'mediamenu',
        'toolsmenu', 'utilitymenu',
        'ownermenu',
        'adminmenu', 'groupmenu',
        'generalmenu'
    ],
    category: 'general',
    description: 'Tampilkan daftar semua command dan panduan penggunaan bot.',
    usage: '.help [kategori | command]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply } = ctx
        const { commands } = await import('../../core/loader.js')
        const prefix = process.env.BOT_PREFIX ?? '!'

        // 1. Resolve active category if any
        let activeMenu = null
        const cmdName = (ctx.commandName || '').toLowerCase()
        if (cmdName.endsWith('menu') && cmdName !== 'menu') {
            activeMenu = cmdName.replace('menu', '')
        }

        const numberMap = {
            '1': 'ai',
            '2': 'downloader',
            '3': 'image',
            '4': 'tools',
            '5': 'audio',
            '6': 'admin',
            '7': 'general',
            '8': 'owner'
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

        let targetCategory = null
        if (activeMenu) {
            if (activeMenu === 'ai') targetCategory = 'ai'
            else if (activeMenu === 'audio' || activeMenu === 'radio' || activeMenu === 'music') targetCategory = 'audio'
            else if (activeMenu === 'downloader' || activeMenu === 'download' || activeMenu === 'dl') targetCategory = 'downloader'
            else if (activeMenu === 'image' || activeMenu === 'media' || activeMenu === 'stiker' || activeMenu === 'sticker') targetCategory = 'image'
            else if (activeMenu === 'tools' || activeMenu === 'utility' || activeMenu === 'util') targetCategory = 'tools'
            else if (activeMenu === 'owner') targetCategory = 'owner'
            else if (activeMenu === 'admin' || activeMenu === 'group') targetCategory = 'admin'
            else if (activeMenu === 'general' || activeMenu === 'info') targetCategory = 'general'
        }

        // !help [nama command] — detail satu command
        if (args.length && !targetCategory) {
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

        // Group commands by category
        const categories = {
            ai: [],
            downloader: [],
            image: [],
            tools: [],
            audio: [],
            admin: [],
            general: [],
            owner: [],
            misc: []
        }

        for (const [, cmd] of commands) {
            if (!cmd.name) continue

            let menuGroup = cmd.category ?? 'misc'

            if (menuGroup === 'media') {
                if (cmd.name === 'dl' || cmd.aliases?.includes('dl')) {
                    menuGroup = 'downloader'
                } else {
                    menuGroup = 'image'
                }
            } else if (menuGroup === 'radio') {
                menuGroup = 'audio'
            } else if (menuGroup === 'utility') {
                menuGroup = 'tools'
            } else if (menuGroup === 'admin') {
                menuGroup = 'admin'
            } else if (menuGroup === 'general') {
                menuGroup = 'general'
            } else if (menuGroup === 'owner') {
                menuGroup = 'owner'
            } else if (menuGroup === 'ai') {
                menuGroup = 'ai'
            } else {
                menuGroup = 'misc'
            }

            if (!categories[menuGroup]) categories[menuGroup] = []
            if (!categories[menuGroup].find(c => c.name === cmd.name)) {
                categories[menuGroup].push(cmd)
            }
        }

        const categoryMeta = {
            ai: { title: '🤖 AI & ASSISTANT', emoji: '🤖' },
            downloader: { title: '📥 DOWNLOADER', emoji: '📥' },
            image: { title: '🎨 IMAGE & MEDIA', emoji: '🎨' },
            tools: { title: '🛠️ TOOLS & UTILITY', emoji: '🛠️' },
            audio: { title: '🎵 AUDIO & RADIO', emoji: '🎵' },
            admin: { title: '🛡️ ADMIN & GROUP', emoji: '🛡️' },
            general: { title: '🔧 GENERAL & INFO', emoji: '🔧' },
            owner: { title: '👑 OWNER SUITE', emoji: '👑' },
            misc: { title: '📦 MISC', emoji: '📦' }
        }

        // Render specific submenu if requested
        if (targetCategory) {
            const meta = categoryMeta[targetCategory] || categoryMeta.misc
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
                    text += `│   └─ ${cmd.description}\n`
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
        let botVersion = '5.18.12'
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'))
            botVersion = pkg.version || '5.18.12'
        } catch (_) { }

        const host = process.env.RADIO_HOST || 'ap1.nzb.zelpstore.id'
        const port = process.env.RADIO_PORT || '25637'
        const dashboardUrl = `http://${host}:${port}/dashboard`

        // Full clean Prompt Menu Layout
        let menuText = `╭───〔 *RONN BOT AUTOMATION* 〕───⬣\n`
        menuText += `│ 👋 Hai, *${ctx.pushName || 'User'}*!\n`
        menuText += `│\n`
        menuText += `│ 📊 Runtime : *${runtimeStr}*\n`
        menuText += `│ 👥 Users   : *${usersCount} pengguna*\n`
        menuText += `│ ⚡ Version : *v${botVersion}*\n`
        menuText += `│ 🔗 *Dashboard:* ${dashboardUrl}\n`
        menuText += `╰───────────────────────────────⬣\n\n`

        const displayGroups = ['ai', 'downloader', 'image', 'tools', 'audio', 'admin', 'general', 'owner']

        for (const catKey of displayGroups) {
            const meta = categoryMeta[catKey]
            const list = categories[catKey] || []
            if (list.length === 0) continue

            menuText += `┌〔 ${meta.title} 〕\n`
            for (const cmd of list) {
                menuText += `│ ▫️ *${prefix}${cmd.name}* — ${cmd.description}\n`
            }
            menuText += `└──────────────────────────────\n\n`
        }

        menuText += `💡 *Tips Penggunaan:*\n`
        menuText += `• Ketik *${prefix}help [command]* untuk melihat panduan spesifik.\n`
        menuText += `• Contoh: *${prefix}help ai* atau *${prefix}help sticker*\n\n`
        menuText += `_Powered by Ronn Bot Automation_`

        return reply(menuText.trim())
    }
}