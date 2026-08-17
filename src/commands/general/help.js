// src/commands/general/help.js
import fs from 'fs'
import path from 'path'
import { db } from '../../services/db.js'
import { interactiveService } from '../../services/interactive.js'
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import { getCleanQuoted } from '../../utils/message.js'

let cachedTotalUsers = 0
let lastUserCountFetch = 0
const USER_COUNT_CACHE_TTL = 5 * 60 * 1000 // 5 menit

/**
 * Kirim pesan menu dengan tombol interaktif WhatsApp Native Flow (List Menu + URL Button + Quick Reply)
 */
async function sendInteractiveNativeMenu(sock, from, msg, headerTitle, bodyText, footerText, dashboardUrl) {
    try {
        const interactiveMessage = {
            header: {
                title: headerTitle,
                hasMediaAttachment: false
            },
            body: {
                text: bodyText
            },
            footer: {
                text: footerText || 'Powered by Ronn Bot'
            },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: '📋 Buka Kategori Menu',
                            sections: [
                                {
                                    title: '🌟 PILIH KATEGORI FITUR BOT',
                                    highlight_label: 'Populer',
                                    rows: [
                                        {
                                            header: '🤖 Kecerdasan Buatan',
                                            title: 'AI & Assistant Menu',
                                            description: 'Chatbot, Q&A, Code, DeepSeek R1 & Hermes Swarm',
                                            id: '.aimenu'
                                        },
                                        {
                                            header: '📥 Media Downloader',
                                            title: 'Downloader Menu',
                                            description: 'Download Video & Audio YouTube, TikTok, IG, FB',
                                            id: '.downloadmenu'
                                        },
                                        {
                                            header: '🎨 Media & Kreativitas',
                                            title: 'Image & Media Menu',
                                            description: 'Bikin stiker, video note to sticker, filter',
                                            id: '.imagemenu'
                                        },
                                        {
                                            header: '🛠️ Alat Serbaguna',
                                            title: 'Tools & Utility Menu',
                                            description: 'Cuaca, kalkulator, OCR, QR code, shortlink',
                                            id: '.toolsmenu'
                                        },
                                        {
                                            header: '🎵 Musik & Radio',
                                            title: 'Audio & Radio Menu',
                                            description: 'Radio streaming 24/7, request lagu, antrean',
                                            id: '.audiomenu'
                                        },
                                        {
                                            header: '🛡️ Manajemen Komunitas',
                                            title: 'Admin & Group Menu',
                                            description: 'Kick, promote, demote, mute, grup info',
                                            id: '.adminmenu'
                                        },
                                        {
                                            header: '🔧 Sistem & Info',
                                            title: 'General & Info Menu',
                                            description: 'Ping, runtime, status bot, catatan',
                                            id: '.generalmenu'
                                        },
                                        {
                                            header: '👑 Pemilik Bot',
                                            title: 'Owner Menu',
                                            description: 'Broadcast pesan, evaluasi, setting bot',
                                            id: '.ownermenu'
                                        }
                                    ]
                                }
                            ]
                        })
                    },
                    {
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: '📻 Buka Web Dashboard',
                            url: dashboardUrl,
                            merchant_url: dashboardUrl
                        })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⚡ Cek Ping Bot',
                            id: '.ping'
                        })
                    }
                ],
                messageVersion: 1
            }
        }

        const msgObj = generateWAMessageFromContent(
            from,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject(interactiveMessage)
                    }
                }
            },
            { userJid: sock.user?.id, quoted: getCleanQuoted(msg) }
        )

        await sock.relayMessage(from, msgObj.message, { messageId: msgObj.key.id })
        return msgObj
    } catch (_) {
        return null
    }
}

/**
 * Kirim submenu dengan tombol interaktif kembali ke menu utama
 */
async function sendInteractiveSubmenu(sock, from, msg, title, bodyText, footerText) {
    try {
        const interactiveMessage = {
            header: {
                title: title,
                hasMediaAttachment: false
            },
            body: {
                text: bodyText
            },
            footer: {
                text: footerText || 'Powered by Ronn Bot'
            },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: '🔙 Kembali ke Menu Utama',
                            id: '.menu'
                        })
                    },
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⚡ Cek Ping Bot',
                            id: '.ping'
                        })
                    }
                ],
                messageVersion: 1
            }
        }

        const msgObj = generateWAMessageFromContent(
            from,
            {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject(interactiveMessage)
                    }
                }
            },
            { userJid: sock.user?.id, quoted: getCleanQuoted(msg) }
        )

        await sock.relayMessage(from, msgObj.message, { messageId: msgObj.key.id })
        return msgObj
    } catch (_) {
        return null
    }
}

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
    description: 'Tampilkan semua command yang tersedia (Interactive Buttons)',
    usage: '.help [kategori | command]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, from, sender, msg, sock } = ctx
        const { commands } = await import('../../core/loader.js')
        const prefix = process.env.BOT_PREFIX ?? '!'

        // Resolve active category if any
        let activeMenu = null

        // 1. Resolve from commandName (e.g. .aimenu)
        const cmdName = (ctx.commandName || '').toLowerCase()
        if (cmdName.endsWith('menu') && cmdName !== 'menu') {
            activeMenu = cmdName.replace('menu', '')
        }

        // 2. Resolve from args[0] (e.g. .help ai, .help aimenu, .menu 1)
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
                ai: { title: '🤖 AI & ASSISTANT MENU', emoji: '🤖' },
                downloader: { title: '📥 DOWNLOADER MENU', emoji: '📥' },
                image: { title: '🎨 IMAGE & MEDIA MENU', emoji: '🎨' },
                tools: { title: '🛠️ TOOLS & UTILITY MENU', emoji: '🛠️' },
                audio: { title: '🎵 AUDIO & RADIO MENU', emoji: '🎵' },
                admin: { title: '🛡️ ADMIN & GROUP MENU', emoji: '🛡️' },
                general: { title: '🔧 GENERAL & INFO MENU', emoji: '🔧' },
                owner: { title: '👑 OWNER MENU', emoji: '👑' },
                misc: { title: '📦 MISC MENU', emoji: '📦' }
            }

            const meta = categoryMeta[targetCategory] || categoryMeta.misc
            const cmdList = categories[targetCategory] || []

            let text = `Berikut daftar perintah yang tersedia:\n\n`

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

            text += `💡 Ketik *${prefix}help [nama_command]* untuk panduan detail.\n`
            text += `🔙 Tekan tombol *Kembali ke Menu Utama* di bawah atau balas *0*.`

            // Coba kirim via Native Interactive Submenu
            const interactiveSent = await sendInteractiveSubmenu(sock, from, msg, meta.title, text, 'Powered by Ronn Bot')

            if (!interactiveSent) {
                // Fallback ke pesan teks standar
                const subSent = await reply(`╭───〔 ${meta.title} 〕───⬣\n` + text)
                interactiveService.createSession(subSent.key.id, from, sender, async (subCtx, answer) => {
                    const clean = (answer || '').trim().toLowerCase()
                    if (clean === '0' || clean === 'menu' || clean === 'back' || clean === 'kembali') {
                        subCtx.commandName = 'menu'
                        subCtx.args = []
                        await this.execute(subCtx)
                    }
                })
            }

            return
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
        let botVersion = '5.18.9'
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'))
            botVersion = pkg.version || '5.18.9'
        } catch (_) { }

        const host = process.env.RADIO_HOST || 'ap1.nzb.zelpstore.id'
        const port = process.env.RADIO_PORT || '25637'
        const dashboardUrl = `http://${host}:${port}/dashboard`

        let bodyText = `👋 Hai, *${ctx.pushName || 'User'}*!\n\n`
        bodyText += `📊 *Runtime :* ${runtimeStr}\n`
        bodyText += `👥 *Users   :* ${usersCount} pengguna\n`
        bodyText += `⚡ *Version :* v${botVersion}\n`
        bodyText += `🔗 *Website :* ${dashboardUrl}\n\n`
        bodyText += `Silakan klik tombol *📋 Buka Kategori Menu* di bawah untuk menjelajahi seluruh fitur bot, atau buka Web Dashboard kami.`

        // Kirim Native Interactive Flow Message (Clickable Buttons & List)
        const interactiveResult = await sendInteractiveNativeMenu(
            sock,
            from,
            msg,
            '🤖 RONN BOT AUTOMATION SUITE 🤖',
            bodyText,
            'Powered by Ronn Bot',
            dashboardUrl
        )

        // Jika klien WhatsApp tidak mendukung interactiveMessage, kirim teks standar
        if (!interactiveResult) {
            let fallbackText = `╭───〔 RONN BOT 〕───⬣\n`
            fallbackText += `│ 👋 Hai, *${ctx.pushName || 'User'}*\n`
            fallbackText += `│\n`
            fallbackText += `│ 📊 Runtime : *${runtimeStr}*\n`
            fallbackText += `│ 👥 Users   : *${usersCount}*\n`
            fallbackText += `│ ⚡ Version : *v${botVersion}*\n`
            fallbackText += `│ 🔗 *Dashboard:* ${dashboardUrl}\n`
            fallbackText += `╰──────────────⬣\n\n`

            fallbackText += `┌〔 📋 PILIH KATEGORI MENU 〕\n`
            fallbackText += `│ 1️⃣  🤖 *AI & Assistant Menu*\n`
            fallbackText += `│ 2️⃣  📥 *Downloader Menu*\n`
            fallbackText += `│ 3️⃣  🎨 *Image & Media Menu*\n`
            fallbackText += `│ 4️⃣  🛠️ *Tools & Utility Menu*\n`
            fallbackText += `│ 5️⃣  🎵 *Audio & Radio Menu*\n`
            fallbackText += `│ 6️⃣  🛡️ *Admin & Group Menu*\n`
            fallbackText += `│ 7️⃣  🔧 *General & Info Menu*\n`
            fallbackText += `│ 8️⃣  👑 *Owner Menu*\n`
            fallbackText += `└──────────────────────────\n\n`
            fallbackText += `👉 *Balas pesan ini dengan angka (1-8)* untuk membuka menu!`

            const sentMenu = await reply(fallbackText.trim())

            interactiveService.createSession(sentMenu.key.id, from, sender, async (menuCtx, answer) => {
                const cleanAnswer = (answer || '').toLowerCase().replace(/^[!./#]/, '').trim()
                const categoryMap = {
                    '1': 'ai', 'ai': 'ai', 'aimenu': 'ai',
                    '2': 'downloader', 'download': 'downloader', 'dl': 'downloader', 'downloadmenu': 'downloader',
                    '3': 'image', 'media': 'image', 'imagemenu': 'image', 'mediamenu': 'image', 'stiker': 'image', 'sticker': 'image',
                    '4': 'tools', 'tool': 'tools', 'utility': 'tools', 'toolsmenu': 'tools', 'util': 'tools',
                    '5': 'audio', 'radio': 'audio', 'music': 'audio', 'audiomenu': 'audio', 'lagu': 'audio',
                    '6': 'admin', 'group': 'admin', 'adminmenu': 'admin', 'grup': 'admin',
                    '7': 'general', 'info': 'general', 'generalmenu': 'general',
                    '8': 'owner', 'ownermenu': 'owner'
                }

                const target = categoryMap[cleanAnswer]
                if (target) {
                    menuCtx.commandName = `${target}menu`
                    menuCtx.args = [target]
                    await this.execute(menuCtx)
                }
            })
        }
    }
}