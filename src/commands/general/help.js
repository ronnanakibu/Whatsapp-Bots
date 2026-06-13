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
    description: 'Tampilkan semua command yang tersedia',
    usage: '.help [command]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply } = ctx
        const { commands } = await import('../../core/loader.js')
        const prefix = process.env.BOT_PREFIX ?? '!'

        // Resolve active category if any
        let activeMenu = null
        
        // 1. Resolve from commandName (e.g. .aimenu)
        const cmdName = ctx.commandName.toLowerCase()
        if (cmdName.endsWith('menu')) {
            activeMenu = cmdName.replace('menu', '')
        }
        
        // 2. Resolve from args[0] (e.g. .help ai, .help aimenu)
        if (!activeMenu && args.length) {
            const arg = args[0].toLowerCase()
            if (arg.endsWith('menu')) {
                activeMenu = arg.replace('menu', '')
            } else {
                activeMenu = arg
            }
        }

        let targetCategory = null
        if (activeMenu) {
            if (activeMenu === 'ai') targetCategory = 'ai'
            else if (activeMenu === 'audio' || activeMenu === 'radio') targetCategory = 'audio'
            else if (activeMenu === 'downloader' || activeMenu === 'download') targetCategory = 'downloader'
            else if (activeMenu === 'image' || activeMenu === 'media') targetCategory = 'image'
            else if (activeMenu === 'tools' || activeMenu === 'utility') targetCategory = 'tools'
            else if (activeMenu === 'owner') targetCategory = 'owner'
            else if (activeMenu === 'admin' || activeMenu === 'group') targetCategory = 'admin'
            else if (activeMenu === 'general') targetCategory = 'general'
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

        // Group by category
        const categories = {
            audio: [],
            ai: [],
            image: [],
            downloader: [],
            tools: [],
            owner: [],
            admin: [],
            general: [],
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

        // Render submenu if targetCategory resolved
        if (targetCategory) {
            const categoryMeta = {
                audio: { title: '🎵 AUDIO MENU', emoji: '🎵' },
                ai: { title: '🤖 AI MENU', emoji: '🤖' },
                image: { title: '🎨 IMAGE MENU', emoji: '🎨' },
                downloader: { title: '📥 DOWNLOADER MENU', emoji: '📥' },
                tools: { title: '🛠️ TOOLS MENU', emoji: '🛠️' },
                owner: { title: '👤 OWNER MENU', emoji: '👑' },
                admin: { title: '🛡️ ADMIN MENU', emoji: '🛡️' },
                general: { title: '🔧 GENERAL MENU', emoji: '🔧' },
                misc: { title: '📦 MISC MENU', emoji: '📦' }
            }

            const meta = categoryMeta[targetCategory] || categoryMeta.misc
            const cmdList = categories[targetCategory] || []

            let text = `╭───〔 ${meta.title} 〕───⬣\n`
            text += `│ Berikut daftar perintah yang tersedia:\n`
            text += `╰──────────────⬣\n\n`

            if (cmdList.length === 0) {
                text += `(Tidak ada perintah)\n`
            } else {
                text += `┌〔 COMMANDS 〕\n`
                for (const cmd of cmdList) {
                    text += `│ ${meta.emoji} *${prefix}${cmd.name}*\n`
                    text += `│   └─ ${cmd.description}\n`
                }
                text += `└──────────────\n\n`
            }

            text += `💡 Ketik *${prefix}help [nama_command]* untuk panduan detail.\n\n`
            text += `Powered by Ronn Bot Radio`

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
                }).catch(() => {})
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
        let botVersion = '5.3.0'
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'))
            botVersion = pkg.version || '5.3.0'
        } catch (_) {}

        const dashboardUrl = `http://ap2.nzb.zelpstore.id:${process.env.RADIO_PORT ?? '25637'}/dashboard`

        let text = `╭───〔 RONN BOT 〕───⬣\n`
        text += `│ 👋 Hai, ${ctx.pushName || 'User'}\n`
        text += `│\n`
        text += `│ 📊 Runtime : ${runtimeStr}\n`
        text += `│ 👥 Users   : ${usersCount}\n`
        text += `│ ⚡ Version : v${botVersion}\n`
        text += `│ 🔗 ${dashboardUrl}\n`
        text += `╰──────────────⬣\n\n`

        text += `┌〔 MAIN MENU 〕\n`
        text += `│ 🎵 Audio\n`
        text += `│ 🤖 AI\n`
        text += `│ 🎨 Image\n`
        text += `│ 📥 Downloader\n`
        text += `│ 🛠️ Tools\n`
        text += `│ 👤 Owner\n`
        text += `│ 🛡️ Admin\n`
        text += `│ 🔧 General\n`
        text += `└──────────────\n\n`

        text += `Ketik:\n`
        text += `${prefix}aimenu\n`
        text += `${prefix}downloadmenu\n`
        text += `${prefix}toolsmenu\n`
        text += `${prefix}ownermenu\n`
        text += `${prefix}audiomenu\n`
        text += `${prefix}imagemenu\n`
        text += `${prefix}adminmenu\n`
        text += `${prefix}generalmenu\n\n`

        text += `Powered by Ronn Bot Radio`

        await reply(text.trim())
    }
}