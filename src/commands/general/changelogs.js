// src/commands/general/changelogs.js

import fs from 'fs'
import path from 'path'

// Helper to clean and sort version files (semver descending)
function getSortedLocalChangelogs() {
    const changelogDir = './changelogs'
    if (!fs.existsSync(changelogDir)) {
        fs.mkdirSync(changelogDir, { recursive: true })
    }
    const files = fs.readdirSync(changelogDir)
        .filter(f => f.endsWith('.md'))

    const parseVersion = (filename) => {
        const clean = filename.replace(/\.md$/, '').replace(/^v/, '')
        return clean.split('.').map(Number)
    }

    files.sort((a, b) => {
        const vA = parseVersion(a)
        const vB = parseVersion(b)
        for (let i = 0; i < Math.max(vA.length, vB.length); i++) {
            const numA = vA[i] ?? 0
            const numB = vB[i] ?? 0
            if (numB !== numA) return numB - numA
        }
        return 0
    })

    return files
}

function formatMarkdownToWa(content) {
    if (!content) return ''
    return content
        .replace(/^### (.*$)/gim, '*$1*') // H3
        .replace(/^## (.*$)/gim, '*$1*')  // H2
        .replace(/^# (.*$)/gim, '*$1*')   // H1
        .replace(/\*\*(.*?)\*\*/g, '*$1*') // **bold** -> *bold*
}

export default {
    name: 'changelogs',
    aliases: ['changelog', 'update', 'releases'],
    category: 'general',
    description: 'Melihat catatan rilis bot (Lokal atau GitHub)',
    usage: '.changelogs [git | list | versi]',
    example: '.changelogs\n.changelogs list\n.changelogs v2.1.0\n.changelogs git',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply } = ctx
        const subCommand = args[0]?.toLowerCase().trim()

        // ── 1. GITHUB CHANGELOGS (IF ARG IS 'git' or 'github') ──
        if (subCommand === 'git' || subCommand === 'github') {
            const owner = 'ronnanakibu'
            const repo = 'Whatsapp-Bots'

            try {
                await reply('⏳ Mengambil data rilis terbaru dari GitHub...')

                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`)

                if (!response.ok) {
                    if (response.status === 404) {
                        return reply('Belum ada rilis/changelog resmi yang dipublish di repositori GitHub.')
                    }
                    throw new Error(`GitHub API Error: ${response.statusText}`)
                }

                const data = await response.json()

                const releaseDate = new Date(data.published_at).toLocaleDateString('id-ID', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                })

                let text = `*📦 RILIS TERBARU GITHUB: ${data.name || data.tag_name}*\n`
                text += `*🏷️ Versi:* ${data.tag_name}\n`
                text += `*📅 Dirilis:* ${releaseDate}\n\n`
                text += `*📝 Catatan Rilis:*\n\n`

                let bodyText = data.body
                    .replace(/^### (.*$)/gim, '*$1*')
                    .replace(/^## (.*$)/gim, '*$1*')
                    .replace(/^# (.*$)/gim, '*$1*')
                    .replace(/\*\*(.*?)\*\*/g, '*$1*')

                text += `${bodyText}\n\n`
                text += `🔗 *Detail:* ${data.html_url}`

                return await reply(text.trim())
            } catch (error) {
                console.error('[Error Changelogs]', error)
                return reply('❌ Gagal mengambil data changelog dari GitHub. Coba lagi nanti.')
            }
        }

        // ── 2. LOCAL CHANGELOG LIST (IF ARG IS 'list') ──
        if (subCommand === 'list' || subCommand === 'daftar') {
            const files = getSortedLocalChangelogs()
            if (files.length === 0) {
                return reply('⚠️ Belum ada catatan rilis lokal di folder `changelogs/`.')
            }

            let text = `*📋 DAFTAR RILIS LOKAL (WABOT2.0)*\n`
            text += `Berikut adalah daftar versi rilis lokal yang tersedia:\n\n`
            for (const file of files) {
                const version = file.replace(/\.md$/, '')
                text += `• *${version}* (Ketik \`.changelogs ${version}\` untuk detail)\n`
            }
            text += `\n💡 *Ketik \`.changelogs\` untuk melihat versi terbaru, atau \`.changelogs git\` untuk GitHub.*`
            return await reply(text.trim())
        }

        // ── 3. SPECIFIC LOCAL VERSION OR LATEST (DEFAULT) ──
        const files = getSortedLocalChangelogs()
        if (files.length === 0) {
            return reply('⚠️ Belum ada catatan rilis lokal di folder `changelogs/`.')
        }

        // Determine which file to read
        let targetFile = files[0] // default to latest
        let isSpecific = false

        if (subCommand) {
            // Find if subCommand matches any filename (e.g. v2.1.0 or 2.1.0)
            const query = subCommand.startsWith('v') ? subCommand : `v${subCommand}`
            const match = files.find(f => f.replace(/\.md$/, '') === query)
            if (match) {
                targetFile = match
                isSpecific = true
            } else {
                return reply(`❌ Versi rilis lokal *${subCommand}* tidak ditemukan.\nKetik \`.changelogs list\` untuk melihat daftar versi yang tersedia.`)
            }
        }

        try {
            const filePath = path.join('./changelogs', targetFile)
            const mdContent = fs.readFileSync(filePath, 'utf-8')
            const formattedContent = formatMarkdownToWa(mdContent)

            let header = `*📝 WABOT2.0 - LOCAL CHANGELOGS ${isSpecific ? '' : '(TERBARU)'}*\n\n`
            let text = header + formattedContent + `\n\n`
            
            if (!isSpecific && files.length > 1) {
                text += `💡 *Ketik \`.changelogs list\` untuk melihat daftar semua versi lokal yang tersedia.*`
            } else {
                text += `💡 *Ketik \`.changelogs\` untuk kembali ke versi lokal terbaru.*`
            }

            await reply(text.trim())
        } catch (error) {
            console.error('[Error Local Changelog]', error)
            reply('❌ Gagal membaca file catatan rilis lokal.')
        }
    }
}