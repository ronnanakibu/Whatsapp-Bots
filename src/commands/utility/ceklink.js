// src/commands/utility/ceklink.js
// !ceklink [url] — Cek apakah URL aman atau phishing via Google Safe Browsing

export default {
    name: 'ceklink',
    aliases: ['safebrowse', 'phishing', 'cekurl'],
    category: 'utility',
    description: 'Cek apakah sebuah URL aman atau berbahaya (phishing/malware)',
    usage: '.ceklink [URL]',
    example: '.ceklink https://suspicious-site.com',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react } = ctx
        if (!args.length) return reply('*Usage:* !ceklink [URL]\n\nContoh:\n!ceklink https://example.com')

        let url = args[0]
        if (!url.startsWith('http')) url = 'https://' + url
        try { new URL(url) } catch {
            return reply('❌ URL tidak valid.')
        }

        await react('🔍')

        const apiKey = process.env.SAFE_BROWSING_API_KEY

        if (!apiKey) {
            // Fallback: cek tanpa API key via urlscan.io public API
            return this.fallbackCheck(url, reply, react)
        }

        try {
            const res = await fetch(
                `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client: { clientId: 'wa-bot', clientVersion: '2.0' },
                        threatInfo: {
                            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                            platformTypes: ['ANY_PLATFORM'],
                            threatEntryTypes: ['URL'],
                            threatEntries: [{ url }]
                        }
                    })
                }
            )
            const data = await res.json()
            const threats = data.matches ?? []

            if (!threats.length) {
                await reply(`✅ *URL Aman*\n\n🔗 ${url}\n\n📋 Tidak ditemukan ancaman di database Google Safe Browsing.`)
                await react('✅')
            } else {
                const types = threats.map(t => t.threatType).join(', ')
                await reply(
                    `⛔ *URL BERBAHAYA!*\n\n` +
                    `🔗 ${url}\n\n` +
                    `⚠️ Ancaman terdeteksi: *${types}*\n\n` +
                    `_Jangan kunjungi URL ini!_`
                )
                await react('⛔')
            }
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal cek URL: ${err.message}`)
        }
    },

    async fallbackCheck(url, reply, react) {
        try {
            const prompt = `Analisa URL berikut ini apakah berpotensi sebagai link phishing, malware, scam, atau link aman.
URL: ${url}

Berikan analisa singkat dan padat (maksimal 3-4 kalimat).
Format balasan (gunakan emoji):
✅ *Aman* atau ⚠️ *Mencurigakan* atau ⛔ *Berbahaya*
[Analisa kamu]

Jangan berikan pengingat tentang API key.`

            // Gunakan isolated ID agar tidak bercampur dengan history chat user
            const { aiService } = await import('../../services/ai.js')
            const isolatedId = `__ceklink__${Date.now()}`
            
            const result = await aiService.geminiChat(isolatedId, prompt)
            
            await reply(`🔍 *Analisa AI (Gemini)*\n\n🔗 ${url}\n\n${result.text}`)
            await react('✅')
        } catch (err) {
            await reply(`❌ Gagal cek URL via AI: ${err.message}`)
            await react('❌')
        }
    }
}