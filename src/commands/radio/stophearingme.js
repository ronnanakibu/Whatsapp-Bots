import { radioService } from '../../services/radio.js'

export default {
    name: 'stophearingme',
    aliases: ['stopsync', 'unsyncowner'],
    category: 'radio',
    description: 'Matikan sinkronisasi Spotify Owner dan buka kembali antrean radio.',
    usage: '.stophearingme',
    cooldown: 5,
    permissions: ['owner'], // Hanya owner yang bisa menjalankan

    async execute(ctx) {
        const { reply, react } = ctx

        if (!radioService.spotifySyncActive) {
            return reply('⚠️ Sinkronisasi Spotify Owner memang sedang tidak aktif, cuy.')
        }

        radioService.spotifySyncActive = false
        await react('✅')
        return reply('🔓 *Spotify Sync Dimatikan!* Antrean radio telah dibuka kembali untuk semua user.')
    }
}
