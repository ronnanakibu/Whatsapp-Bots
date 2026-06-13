import { lyricsService } from '../../services/lyrics.js'
import { radioService } from '../../services/radio.js'

export default {
    name: 'lyrics',
    aliases: ['lirik', 'ly'],
    category: 'utility',
    description: 'Cari lirik lagu yang sedang diputar atau cari judul tertentu.',
    usage: '.lyrics [judul lagu] atau .lyrics',
    example: '.lyrics Miguel - Remember Me',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react } = ctx

        let query = args.join(' ').trim()

        if (!query) {
            const info = radioService.getNowPlayingInfo()
            if (info && info.track) {
                const artist = info.track.artist && info.track.artist !== 'Unknown' ? info.track.artist : ''
                query = artist ? `${artist} - ${info.track.title}` : info.track.title
            }
        }

        if (!query) {
            return reply('📻 *Radio sedang tidak memutar lagu.*\nTulis judul lagu yang ingin dicari.\nContoh: `.lyrics Remember Me`')
        }

        await react('🔍')

        try {
            const result = await lyricsService.fetchLyrics(query)
            if (!result || !result.plainLyrics) {
                await react('❌')
                return reply(`❌ *Lirik tidak ditemukan* untuk pencarian: "${query}"`)
            }

            let text = `🎤 *Lirik Lagu:* *${result.title}* - _${result.artist}_\n\n`
            text += result.plainLyrics

            await reply(text)
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal mencari lirik: ${err.message}`)
        }
    }
}
