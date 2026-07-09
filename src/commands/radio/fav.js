// src/commands/radio/fav.js
// Command set for managing favorite songs

import { 
    radioService, 
    Track, 
    dbAddFavorite, 
    dbRemoveFavorite, 
    dbGetFavorites, 
    dbIsFavorite 
} from '../../services/radio.js'
import { parseTargetJid } from '../../utils/group.js'

export default {
    name: 'fav',
    aliases: ['myfav', 'favlist', 'playfav', 'unfav', 'unlike', 'like', 'likes'],
    category: 'radio',
    description: 'Kelola daftar lagu favorit Anda (.fav / .myfav / .playfav / .unfav)',
    usage: '.fav (sukai lagu sekarang) | .myfav (daftar lagu) | .playfav <nomor/random/all> | .unfav <nomor>',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args, sender, commandName, pushName, react, mentionedJids } = ctx
        const cmd = commandName.toLowerCase()

        const targetJid = parseTargetJid(args, mentionedJids)
        const isListCmd = ['myfav', 'favlist', 'likes'].includes(cmd) || (cmd === 'fav' && args[0]?.toLowerCase() === 'list')
        const isLookup = (cmd === 'fav' && targetJid) || (isListCmd && targetJid)

        // ─────────────────────────────────────────────
        // CASE 1: LIHAT DAFTAR FAVORIT (punya sendiri / orang lain)
        // ─────────────────────────────────────────────
        if (isListCmd || isLookup) {
            const lookupJid = isLookup ? targetJid : sender
            const isSelf = lookupJid === sender

            const list = dbGetFavorites(lookupJid)
            if (!list || list.length === 0) {
                if (isSelf) {
                    return reply('📭 *Daftar lagu favoritmu masih kosong.*\nPutar lagu yang kamu suka di radio, lalu ketik `.fav` untuk menambahkannya ke list ini!')
                } else {
                    return reply(`📭 *Daftar lagu favorit @${lookupJid.split('@')[0]} masih kosong.*`, { mentions: [lookupJid] })
                }
            }

            let text = isSelf 
                ? `❤️ *Daftar Lagu Favoritmu (${list.length} lagu):*\n\n` 
                : `❤️ *Daftar Lagu Favorit @${lookupJid.split('@')[0]} (${list.length} lagu):*\n\n`

            list.forEach((song, i) => {
                const min = Math.floor(song.duration / 60)
                const sec = song.duration % 60
                const durStr = `${min}:${sec.toString().padStart(2, '0')}`
                text += `${i + 1}. *${song.title}* - _${song.artist}_ (${durStr})\n`
            })

            if (isSelf) {
                text += `\n💡 *Tips:*\n` +
                        `• Putar lagu favorit: \`.playfav <nomor/random/all>\`\n` +
                        `• Hapus dari favorit: \`.unfav <nomor>\``
            }

            return reply(text, { mentions: [lookupJid] })
        }

        // ─────────────────────────────────────────────
        // CASE 2: HAPUS DARI DAFTAR FAVORIT (.unfav / .unlike)
        // ─────────────────────────────────────────────
        if (['unfav', 'unlike'].includes(cmd) || (cmd === 'fav' && ['remove', 'hapus', 'r', 'delete'].includes(args[0]?.toLowerCase()))) {
            const list = dbGetFavorites(sender)
            if (!list || list.length === 0) {
                return reply('📭 Daftar lagu favoritmu kosong, tidak ada yang bisa dihapus.')
            }

            const rawIdx = cmd === 'fav' ? args[1] : args[0]
            const index = parseInt(rawIdx) - 1

            if (isNaN(index) || index < 0 || index >= list.length) {
                return reply(`⚠️ Masukkan nomor lagu favorit yang ingin dihapus.\nContoh: \`.unfav 2\` (lihat nomor lagu di \`.myfav\`)`)
            }

            const targetSong = list[index]
            const success = dbRemoveFavorite(sender, targetSong.song_id)

            if (success) {
                await react('🗑️')
                return reply(`🗑️ *Berhasil menghapus lagu dari favorit:* \n_${targetSong.title}_ - ${targetSong.artist}`)
            } else {
                return reply('❌ Gagal menghapus lagu dari favorit. Terjadi kesalahan internal.')
            }
        }

        // ─────────────────────────────────────────────
        // CASE 3: PUTAR LAGU FAVORIT (.playfav)
        // ─────────────────────────────────────────────
        if (cmd === 'playfav' || (cmd === 'fav' && args[0]?.toLowerCase() === 'play')) {
            const list = dbGetFavorites(sender)
            if (!list || list.length === 0) {
                return reply('📭 *Daftar lagu favoritmu masih kosong.* Ketik `.fav` saat lagu diputar untuk menyimpannya.')
            }

            const option = (cmd === 'fav' ? args[1] : args[0])?.toLowerCase()

            // Subcase A: Putar acak / random (jika ketik ".playfav random" atau ".playfav" tanpa argumen)
            if (!option || option === 'random' || option === 'acak') {
                const song = list[Math.floor(Math.random() * list.length)]
                try {
                    await react('🎵')
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
                    
                    let linkMsg = ''
                    const host = process.env.RADIO_HOST || 'ap1.nzb.zelpstore.id'
                    const port = process.env.RADIO_PORT || '25637'
                    linkMsg = `\n\n🎧 *Dengarkan radio di sini:*\n${host}:${port}/radio`

                    await reply(
                        `✅ *Memutar Acak Favorit!*\n\n` +
                        `🎵 *${track.title}*\n` +
                        `⏱️ Durasi: ${track.durationFormatted}\n` +
                        `📋 Posisi: #${radioService.queue.length + (radioService.currentTrack ? 1 : 0)}${linkMsg}`
                    )

                    if (!radioService.isPlaying) {
                        radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                    }
                } catch (err) {
                    await reply(`❌ Gagal memutar lagu: ${err.message}`)
                }
                return
            }

            // Subcase B: Putar SEMUA lagu favorit (.playfav all)
            if (option === 'all' || option === 'semua') {
                await react('🎵')
                let successCount = 0
                let failCount = 0
                
                for (const song of list) {
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
                        successCount++
                    } catch (e) {
                        failCount++
                        if (e.message.includes('Queue penuh')) break
                    }
                }

                await reply(`✅ Berhasil menambahkan *${successCount}* lagu favorit ke antrean. (Antrean saat ini: ${radioService.queue.length} lagu)`)
                
                if (successCount > 0 && !radioService.isPlaying) {
                    radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                }
                return
            }

            // Subcase C: Putar nomor tertentu (.playfav 3)
            const index = parseInt(option) - 1
            if (isNaN(index) || index < 0 || index >= list.length) {
                return reply(`⚠️ Masukkan nomor lagu favorit yang valid atau ketik acak/all.\nContoh: \`.playfav 3\` (lihat nomor lagu di \`.myfav\`)`)
            }

            const song = list[index]
            try {
                await react('🎵')
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

                await reply(
                    `✅ *Ditambahkan ke queue!*\n\n` +
                    `🎵 *${track.title}*\n` +
                    `⏱️ Durasi: ${track.durationFormatted}\n` +
                    `📋 Posisi: #${radioService.queue.length + (radioService.currentTrack ? 1 : 0)}`
                )

                if (!radioService.isPlaying) {
                    radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                }
            } catch (err) {
                await reply(`❌ Gagal memutar lagu: ${err.message}`)
            }
            return
        }

        // ─────────────────────────────────────────────
        // CASE 4: TAMBAH LAGU SEKARANG KE FAVORIT (.fav)
        // ─────────────────────────────────────────────
        const info = radioService.getNowPlayingInfo()
        if (!info || !info.track) {
            return reply('📻 Radio sedang tidak memutar lagu.\nPutar lagu dulu dengan command `!play [judul]`, baru sukai lagunya menggunakan `.fav`.')
        }

        const currentTrack = info.track
        const alreadyFav = dbIsFavorite(sender, currentTrack.songId)

        if (alreadyFav) {
            return reply(`⚠️ Lagu *${currentTrack.title}* sudah ada di daftar lagu favoritmu.`)
        }

        const success = dbAddFavorite(sender, currentTrack.songId)
        if (success) {
            await react('❤️')
            return reply(`❤️ *Berhasil menyukai lagu!*\n\n🎵 *${currentTrack.title}*\n_Lagu telah dimasukkan ke daftar favoritmu._\nKetik \`.myfav\` untuk melihat list.`)
        } else {
            return reply('❌ Gagal menambahkan lagu ke favorit. Silakan coba lagi.')
        }
    }
}
