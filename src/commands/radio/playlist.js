import { 
    radioService, 
    Track,
    dbCreatePlaylist, 
    dbAddSongToPlaylist, 
    dbRemoveSongFromPlaylist, 
    dbGetPlaylists, 
    dbGetPlaylistSongs, 
    dbDeletePlaylist 
} from '../../services/radio.js'

export default {
    name: 'playlist',
    aliases: ['pl'],
    category: 'radio',
    description: 'Kelola daftar putar musik pribadi Anda (.pl / .playlist)',
    usage: '.pl create <nama> | .pl add <nama> | .pl remove <nama> <no> | .pl list | .pl show <nama> | .pl play <nama> [random] | .pl delete <nama>',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args, sender, pushName, react } = ctx

        if (!args.length) {
            return reply(
                `🎶 *Panduan Command Playlist (.pl):*\n\n` +
                `• *.pl create [nama]* : Buat playlist baru\n` +
                `• *.pl list* : Lihat daftar playlist kamu\n` +
                `• *.pl add [nama]* : Tambahkan lagu aktif ke playlist\n` +
                `• *.pl show [nama]* : Lihat isi lagu di playlist\n` +
                `• *.pl remove [nama] [no]* : Hapus lagu di playlist\n` +
                `• *.pl play [nama]* : Putar antrean dari playlist\n` +
                `• *.pl play [nama] random* : Putar acak playlist\n` +
                `• *.pl delete [nama]* : Hapus playlist`
            )
        }

        const action = args[0].toLowerCase()

        // ─────────────────────────────────────────────
        // 1. CREATE PLAYLIST
        // ─────────────────────────────────────────────
        if (action === 'create') {
            const name = args.slice(1).join(' ').trim()
            if (!name) return reply('⚠️ Masukkan nama playlist yang ingin dibuat. Contoh: `.pl create Rock`')
            try {
                dbCreatePlaylist(sender, name)
                await react('✅')
                return reply(`✅ *Playlist "${name}" berhasil dibuat!*`)
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal membuat playlist: ${err.message}`)
            }
        }

        // ─────────────────────────────────────────────
        // 2. LIST PLAYLISTS
        // ─────────────────────────────────────────────
        if (action === 'list') {
            const list = dbGetPlaylists(sender)
            if (!list || list.length === 0) {
                return reply('📭 Kamu belum memiliki playlist. Buat dengan: `.pl create [nama]`')
            }
            let text = `🎶 *Daftar Playlist Kamu (${list.length}):*\n\n`
            list.forEach((pl, i) => {
                text += `${i + 1}. *${pl.name}*\n`
            })
            return reply(text)
        }

        // ─────────────────────────────────────────────
        // 3. ADD SONG TO PLAYLIST
        // ─────────────────────────────────────────────
        if (action === 'add') {
            const name = args.slice(1).join(' ').trim()
            if (!name) return reply('⚠️ Masukkan nama playlist target. Contoh: `.pl add Rock`')

            const info = radioService.getNowPlayingInfo()
            if (!info || !info.track) {
                return reply('📻 Radio sedang tidak memutar lagu untuk ditambahkan.')
            }

            try {
                dbAddSongToPlaylist(sender, name, info.track.songId)
                await react('❤️')
                return reply(`✅ Berhasil menambahkan *${info.track.title}* ke playlist *"${name}"*.`)
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal: ${err.message}`)
            }
        }

        // ─────────────────────────────────────────────
        // 4. SHOW PLAYLIST SONGS
        // ─────────────────────────────────────────────
        if (action === 'show') {
            const name = args.slice(1).join(' ').trim()
            if (!name) return reply('⚠️ Masukkan nama playlist yang ingin dilihat. Contoh: `.pl show Rock`')

            const songs = dbGetPlaylistSongs(sender, name)
            if (songs === null) {
                return reply(`❌ Playlist "${name}" tidak ditemukan.`)
            }

            if (songs.length === 0) {
                return reply(`📭 Playlist *"${name}"* masih kosong. Putar lagu lalu tambahkan dengan: \`.pl add ${name}\``)
            }

            let text = `📂 *Isi Playlist "${name}" (${songs.length} lagu):*\n\n`
            songs.forEach((song, i) => {
                const min = Math.floor(song.duration / 60)
                const sec = song.duration % 60
                const durStr = `${min}:${sec.toString().padStart(2, '0')}`
                text += `${i + 1}. *${song.title}* - _${song.artist}_ (${durStr})\n`
            })
            return reply(text)
        }

        // ─────────────────────────────────────────────
        // 5. REMOVE SONG FROM PLAYLIST
        // ─────────────────────────────────────────────
        if (action === 'remove') {
            if (args.length < 3) {
                return reply('⚠️ Format salah. Contoh: `.pl remove Rock 2` (hapus lagu nomor 2 di playlist Rock)')
            }
            const songIndexStr = args[args.length - 1]
            const playlistName = args.slice(1, -1).join(' ').trim()
            const songIndex = parseInt(songIndexStr) - 1

            if (isNaN(songIndex)) {
                return reply('⚠️ Nomor urutan lagu harus berupa angka.')
            }

            try {
                dbRemoveSongFromPlaylist(sender, playlistName, songIndex)
                await react('🗑️')
                return reply(`🗑️ Berhasil menghapus lagu dari playlist *"${playlistName}"*.`)
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal: ${err.message}`)
            }
        }

        // ─────────────────────────────────────────────
        // 6. PLAY PLAYLIST
        // ─────────────────────────────────────────────
        if (action === 'play') {
            const isRandom = args[args.length - 1]?.toLowerCase() === 'random'
            const playlistName = (isRandom ? args.slice(1, -1) : args.slice(1)).join(' ').trim()

            if (!playlistName) {
                return reply('⚠️ Masukkan nama playlist yang ingin diputar. Contoh: `.pl play Rock`')
            }

            const songs = dbGetPlaylistSongs(sender, playlistName)
            if (songs === null) {
                return reply(`❌ Playlist "${playlistName}" tidak ditemukan.`)
            }

            if (songs.length === 0) {
                return reply(`📭 Playlist *"${playlistName}"* masih kosong.`)
            }

            await react('🎵')

            let playlistQueue = [...songs]
            if (isRandom) {
                playlistQueue.sort(() => Math.random() - 0.5)
            }

            let addedCount = 0
            for (const song of playlistQueue) {
                try {
                    const track = new Track({
                        title: song.title,
                        url: song.stream_url,
                        duration: song.duration,
                        thumbnail: song.thumbnail_url || null,
                        requestedBy: pushName,
                        requestedByJid: sender,
                        source: song.source,
                        songId: song.song_id,
                        artist: song.artist
                    })
                    radioService.addToQueue(track)
                    addedCount++
                } catch (e) {
                    if (e.message.includes('Queue penuh')) break
                }
            }

            await reply(`✅ Memutar playlist *"${playlistName}"* (${isRandom ? 'acak' : 'urut'}). Menambahkan *${addedCount}* lagu ke antrean.`)

            if (addedCount > 0 && !radioService.isPlaying) {
                radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
            }
            return
        }

        // ─────────────────────────────────────────────
        // 7. DELETE PLAYLIST
        // ─────────────────────────────────────────────
        if (action === 'delete') {
            const name = args.slice(1).join(' ').trim()
            if (!name) return reply('⚠️ Masukkan nama playlist yang ingin dihapus. Contoh: `.pl delete Rock`')

            try {
                dbDeletePlaylist(sender, name)
                await react('🗑️')
                return reply(`🗑️ *Playlist "${name}" berhasil dihapus.*`)
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal menghapus: ${err.message}`)
            }
        }

        return reply('❓ Subcommand tidak dikenali. Ketik `.pl` untuk melihat panduan lengkap.')
    }
}
