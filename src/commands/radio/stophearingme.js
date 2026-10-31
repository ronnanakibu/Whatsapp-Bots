import { radioService } from '../../services/radio.js'

export default {
    name: 'stophearingme',
    aliases: ['stopsync', 'unsyncowner'],
    category: 'audio',
    description: 'Matikan sinkronisasi Spotify Owner dan buka kembali antrean radio.',
    usage: '.stophearingme',
    cooldown: 5,
    permissions: ['owner'], // Hanya owner yang bisa menjalankan
    requireBotAdmin: false,
    tags: [
        "stophearingme",
        "stopsync",
        "unsyncowner",
        "spotify",
        "radio",
        "audio"
    ],
    params: {
        "type": "object",
        "properties": {},
        "required": []
    },



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
