// src/commands/utility/uptime.js
// !uptime [url] — Cek apakah website up atau down
import { safeFetch } from '../../utils/safeOutboundUrl.js'

export default {
    name: 'uptime',
    aliases: ['cekweb', 'isdown', 'checksite'],
    category: 'tools',
    description: 'Cek apakah website/URL sedang up atau down (HTTP check). Untuk status bot, gunakan .aboutbots.',
    usage: '.uptime [url]',
    example: '.uptime https://google.com',
    cooldown: 5,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: [
        "uptime",
        "cekweb",
        "isdown",
        "checksite",
        "pingweb",
        "status",
        "tools"
    ],
    params: {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "Alamat URL website yang ingin diperiksa status online/offline-nya"
            }
        },
        "required": [
            "url"
        ]
    },

    async execute(ctx) {
        const { args, reply, react } = ctx
        if (!args.length) return reply('*Usage:* !uptime [url]\n\nContoh:\n!uptime https://google.com\n!uptime discord.com')

        let url = args[0]
        if (!url.startsWith('http')) url = 'https://' + url

        try { new URL(url) } catch {
            return reply('❌ URL tidak valid.')
        }

        await react('🔍')

        const start = Date.now()
        try {
            const res = await safeFetch(url, {
                method: 'HEAD',
                timeoutMs: 8000,
                userAgent: 'WA-Bot-UptimeCheck/2.0'
            })

            const latency = Date.now() - start
            const isUp = res.status < 500

            const statusEmoji = isUp ? '✅' : '❌'
            const latencyEmoji = latency < 500 ? '🟢' : latency < 2000 ? '🟡' : '🔴'

            await reply(
                `${statusEmoji} *Website Status*\n\n` +
                `🌐 URL: ${url}\n` +
                `📊 Status: ${res.status} ${res.statusText}\n` +
                `${latencyEmoji} Latency: ${latency}ms\n` +
                `📋 Kondisi: ${isUp ? '*UP* — Website bisa diakses' : '*DOWN* — Website bermasalah'}`
            )
            await react(isUp ? '✅' : '⚠️')

        } catch (err) {
            const latency = Date.now() - start
            const isTimeout = err.name === 'AbortError' || err.message?.includes('timed out')
            const isSsrfBlocked = err.message?.includes('private or reserved') ||
                err.message?.includes('Forbidden host') ||
                err.message?.includes('Forbidden protocol') ||
                err.message?.includes('resolves to local')

            await reply(
                `❌ *Website Status*\n\n` +
                `🌐 URL: ${url}\n` +
                `📋 Kondisi: *DOWN / BLOCKED*\n` +
                `💬 Keterangan: ${isSsrfBlocked ? '⚠️ Akses ke IP/host internal diblokir (SSRF Protection).' : isTimeout ? 'Request timeout (>8s)' : err.message}`
            )
            await react('❌')
        }
    }
}
