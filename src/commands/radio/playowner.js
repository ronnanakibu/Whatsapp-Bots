import { getOwnerSpotifyTrack } from '../../discord/index.js'
import { radioService } from '../../services/radio.js'

export default {
    name: 'playowner',
    aliases: ['listensync', 'syncowner'],
    category: 'radio',
    description: 'Sinkronisasikan radio dengan Spotify Owner secara realtime.',
    usage: '.playowner',
    cooldown: 5,
    permissions: ['owner'], // Hanya owner yang bisa menjalankan

    async execute(ctx) {
        const { reply, react, sender } = ctx

        if (radioService.spotifySyncActive) {
            return reply('⚠️ Sinkronisasi Radio Owner sudah aktif cuy!')
        }

        await react('🔄')

        let currentTrackMsg = 'Belum ada lagu yang diputar di Spotify.'
        let initialTrack = null

        try {
            const spotifyInfo = await getOwnerSpotifyTrack()
            currentTrackMsg = `Lagu saat ini: *${spotifyInfo.artist} - ${spotifyInfo.songTitle}*`
            initialTrack = spotifyInfo.query
        } catch (err) {
            // Jika error karena sedang tidak memutar Spotify atau presence belum terdeteksi, abaikan dan tetap nyalakan sync
            if (!err.message.includes('tidak memutar lagu di Spotify') && !err.message.includes('Presence owner tidak terdeteksi')) {
                await react('❌')
                return reply(`❌ Gagal mengaktifkan sinkronisasi: ${err.message}`)
            }
            currentTrackMsg = `⚠️ *Note:* ${err.message}\nSinkronisasi tetap diaktifkan. Bot akan otomatis menyetel lagu ketika kamu mulai memutar Spotify.`
        }

        // Aktifkan flag sinkronisasi di engine radio
        radioService.spotifySyncActive = true

        await reply(
            `🔄 *Spotify Sync Aktif!*\n` +
            `Radio sekarang tersambung dengan Spotify Owner.\n` +
            `${currentTrackMsg}\n\n` +
            `🔒 *Play Lock:* Command \`.play\` dikunci untuk user lain.\n` +
            `Gunakan \`.stophearingme\` untuk mematikan sinkronisasi.`
        )

        if (initialTrack) {
            try {
                // bypassSyncActive = true (argumen ketiga) untuk menembus lock
                const track = await radioService.search(initialTrack, sender, 'Spotify Sync')
                track.startSeek = spotifyInfo.startSeek || 0
                radioService.clearQueue()
                radioService.addToQueue(track, null, true)

                if (!radioService.isPlaying) {
                    radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                } else {
                    await radioService.skip()
                }
            } catch (searchErr) {
                await reply(`⚠️ Gagal memutar lagu awal: ${searchErr.message}`)
            }
        }

        await react('✅')
    }
}
