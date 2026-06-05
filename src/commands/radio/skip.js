// src/commands/radio/skip.js
import { radioService } from '../../services/radio.js'

export default {
    name: 'skip',
    aliases: ['sk', 'next'],
    category: 'radio',
    description: 'Skip lagu yang sedang diputar',
    usage: '.skip',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, react } = ctx
        if (!radioService.isPlaying) return reply('📻 Radio tidak sedang memutar lagu.')

        const skipped = radioService.currentTrack
        const nextTrack = radioService.queue[0] // Look ahead in queue
        await react('⏭️')
        const ok = await radioService.skip()

        if (ok) {
            let text = `⏭️ *Diskip:* ${skipped.title}\n`
            if (nextTrack) {
                text += `▶️ *Sekarang:* ${nextTrack.title}`
            } else {
                text += `📋 Queue habis.`
            }
            await reply(text)
        } else {
            await reply('❌ Gagal skip.')
        }
    }
}