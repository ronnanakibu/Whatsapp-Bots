import { Client, GatewayIntentBits, ActivityType } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice'
import { 
    radioService, 
    AVAILABLE_FX, 
    AVAILABLE_EQ,
    Track, 
    dbAddFavorite, 
    dbRemoveFavorite, 
    dbGetFavorites, 
    dbIsFavorite,
    dbCreatePlaylist,
    dbAddSongToPlaylist,
    dbRemoveSongFromPlaylist,
    dbGetPlaylists,
    dbGetPlaylistSongs,
    dbDeletePlaylist
} from '../services/radio.js'
import { logger } from '../utils/logger.js'
import { db } from '../services/db.js'
import { lyricsService } from '../services/lyrics.js'

let discordClient = null
let currentConnection = null
let audioPlayer = null

function setBotPresence(trackName = null) {
    if (!discordClient || !discordClient.user) return

    if (trackName) {
        discordClient.user.setActivity(trackName, { type: ActivityType.Listening })
    } else {
        const prefix = process.env.BOT_PREFIX || '!'
        discordClient.user.setActivity(`${prefix}help | Standby 📻`, { type: ActivityType.Listening })
    }
}

function playStream() {
    if (!currentConnection || !audioPlayer) return
    const radioPort = process.env.RADIO_PORT || 8080
    logger.info(`[Discord] Memutar/menghubungkan kembali stream dari port ${radioPort}`)
    try {
        const resource = createAudioResource(`http://127.0.0.1:${radioPort}/stream`)
        audioPlayer.play(resource)
    } catch (err) {
        logger.error(`[Discord] Gagal memutar stream: ${err.message}`)
    }
}

export function startDiscordBot() {
    // 🔥 1. ANTI-SPAM GUARD: Jika bot sudah diinisialisasi, jangan bind ulang listener-nya!
    if (discordClient) {
        logger.warn('[Discord] Bot Discord sudah berjalan sebelumnya. Mengabaikan inisialisasi ganda.')
        return
    }

    const token = process.env.DISCORD_TOKEN
    if (!token) {
        logger.info('[Discord] DISCORD_TOKEN tidak ditemukan di .env, Discord bot dinonaktifkan.')
        return
    }

    discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildMembers,
        ]
    })

    radioService.on('track:start', (track) => {
        if (currentConnection && audioPlayer) {
            logger.info(`[Discord] Radio started track: "${track.title}". Refreshing audio resource.`)
            playStream()
        }
        setBotPresence(track.title)
    })

    radioService.on('radio:idle', () => setBotPresence())
    radioService.on('radio:stop', () => setBotPresence())

    discordClient.once('clientReady', () => {
        logger.info(`[Discord] Bot online sebagai ${discordClient.user.tag}`)
        setBotPresence()
    })

    discordClient.on('presenceUpdate', async (oldPresence, newPresence) => {
        if (!radioService.spotifySyncActive) return

        const ownerId = process.env.DISCORD_OWNER_ID
        if (!ownerId || newPresence?.userId !== ownerId) return

        // Cari aktivitas Spotify di presence baru
        const newSpotify = newPresence.activities?.find(
            act => act.name === 'Spotify' && act.type === ActivityType.Listening
        )
        // Cari aktivitas Spotify di presence lama
        const oldSpotify = oldPresence?.activities?.find(
            act => act.name === 'Spotify' && act.type === ActivityType.Listening
        )

        if (newSpotify) {
            const newTrack = newSpotify.details
            const newArtist = newSpotify.state
            const oldTrack = oldSpotify?.details
            const oldArtist = oldSpotify?.state

            // Jika lagu berubah atau baru mulai diputar
            if (newTrack !== oldTrack || newArtist !== oldArtist) {
                logger.info(`[Spotify Sync] Owner mengganti lagu: ${newArtist} - ${newTrack}`)
                try {
                    const query = `${newArtist} - ${newTrack}`
                    // bypassSyncActive = true (argumen ketiga) untuk menembus lock di addToQueue
                    const track = await radioService.search(query, ownerId + '@discord', 'Spotify Sync')
                    
                    radioService.clearQueue()
                    radioService.addToQueue(track, null, true)

                    if (radioService.isPlaying) {
                        await radioService.skip()
                    } else {
                        await radioService.start()
                    }
                } catch (err) {
                    logger.error(`[Spotify Sync] Gagal sinkronisasi lagu otomatis: ${err.message}`)
                }
            }
        }
    })

    discordClient.on('messageCreate', async (message) => {
        if (message.author.bot) return

        const prefix = process.env.BOT_PREFIX || '!'
        if (!message.content.startsWith(prefix)) return

        const args = message.content.slice(prefix.length).trim().split(/ +/)
        const command = args.shift().toLowerCase()

        if (command === 'join') {
            const voiceChannel = message.member?.voice?.channel
            if (!voiceChannel) return message.reply('Kamu harus masuk ke Voice Channel dulu biar bot tau mau nyusul ke mana!')

            if (!currentConnection || currentConnection.joinConfig.channelId !== voiceChannel.id) {
                currentConnection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                })

                audioPlayer = createAudioPlayer()
                currentConnection.subscribe(audioPlayer)

                audioPlayer.on(AudioPlayerStatus.Idle, () => {
                    logger.debug('[Discord] AudioPlayer Idle.')
                    if (currentConnection && radioService.isPlaying) {
                        logger.info('[Discord] AudioPlayer Idle while radio is playing. Reconnecting stream in 1s...')
                        setTimeout(() => {
                            if (currentConnection && audioPlayer && audioPlayer.state.status === AudioPlayerStatus.Idle && radioService.isPlaying) {
                                playStream()
                            }
                        }, 1000)
                    }
                })

                audioPlayer.on('error', error => {
                    logger.error(`[Discord] AudioPlayer Error: ${error.message}`)
                    if (currentConnection && radioService.isPlaying) {
                        logger.info('[Discord] Recovering from AudioPlayer error in 2s...')
                        setTimeout(() => {
                            if (currentConnection && audioPlayer && radioService.isPlaying) {
                                playStream()
                            }
                        }, 2000)
                    }
                })

                playStream()
                message.reply('Sudah mendarat di Voice Channel & standby muter siaran radio WA! 📻')
            } else {
                if (audioPlayer && audioPlayer.state.status === AudioPlayerStatus.Idle) {
                    playStream()
                    message.reply('Bot diaktifkan kembali dan memutar stream radio! 📻')
                } else {
                    message.reply('Bot udah ada di Voice Channel kamu kok.')
                }
            }
            return
        }

        if (command === 'play') {
            const query = args.join(' ')
            if (!query) return message.reply('Tulis lagu yang mau diputar. Contoh: `!play Nadin Amizah`')

            const voiceChannel = message.member?.voice?.channel
            if (!voiceChannel) return message.reply('Kamu harus masuk ke Voice Channel dulu!')

            if (!currentConnection || currentConnection.joinConfig.channelId !== voiceChannel.id) {
                currentConnection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                })

                audioPlayer = createAudioPlayer()
                currentConnection.subscribe(audioPlayer)

                audioPlayer.on(AudioPlayerStatus.Idle, () => {
                    logger.debug('[Discord] AudioPlayer Idle, tapi radioService jalan terus.')
                    if (currentConnection && radioService.isPlaying) {
                        logger.info('[Discord] AudioPlayer Idle while radio is playing. Reconnecting stream in 1s...')
                        setTimeout(() => {
                            if (currentConnection && audioPlayer && audioPlayer.state.status === AudioPlayerStatus.Idle && radioService.isPlaying) {
                                playStream()
                            }
                        }, 1000)
                    }
                })

                audioPlayer.on('error', error => {
                    logger.error(`[Discord] AudioPlayer Error: ${error.message}`)
                    if (currentConnection && radioService.isPlaying) {
                        logger.info('[Discord] Recovering from AudioPlayer error in 2s...')
                        setTimeout(() => {
                            if (currentConnection && audioPlayer && radioService.isPlaying) {
                                playStream()
                            }
                        }, 2000)
                    }
                })

                playStream()
                message.reply('Masuk ke Voice Channel & menyambungkan siaran radio WA! 📻')
            } else if (audioPlayer && audioPlayer.state.status === AudioPlayerStatus.Idle) {
                playStream()
            }

            try {
                const msg = await message.reply(`🔍 Mencari \`${query}\`...`)
                const userJid = message.author.id + '@discord'
                const track = await radioService.search(query, userJid, message.author.username)
                radioService.addToQueue(track)

                if (!radioService.isPlaying) {
                    radioService.start().catch(e => logger.error('[Radio] Start error: ' + e.message))
                }

                msg.edit(`✅ **Ditambahkan ke antrean:** ${track.title}\nRequested by: ${track.requestedBy}`)
            } catch (err) {
                message.reply(`❌ Gagal menambahkan lagu: ${err.message}`)
            }
        }

        if (command === 'skip') {
            if (!radioService.isPlaying) {
                return message.reply('📻 Radio tidak sedang memutar lagu.')
            }
            const skipped = radioService.currentTrack
            const nextTrack = radioService.queue[0]
            const ok = await radioService.skip()
            if (ok) {
                let text = `⏭️ **Diskip:** ${skipped.title}\n`
                if (nextTrack) {
                    text += `▶️ **Sekarang:** ${nextTrack.title}`
                } else {
                    text += `📋 Queue habis.`
                }
                message.reply(text)
            } else {
                message.reply('❌ Gagal skip.')
            }
        }

        // 🛠️ 2. FITUR BARU: Hapus lagu dari Antrean (Sub-command queue)
        if (command === 'queue') {
            const subCommand = args[0]?.toLowerCase()

            if (['remove', 'hapus', 'r'].includes(subCommand)) {
                const indexToRemove = parseInt(args[1])
                if (isNaN(indexToRemove)) {
                    return message.reply(`⚠️ Masukkan angka urutan playlist yang mau dihapus, cuy. Contoh: \`${prefix}queue r 2\``)
                }

                const queue = radioService.queue
                if (!queue || queue.length === 0) {
                    return message.reply('📭 Antrean playlist lagi kosong, nih.')
                }

                if (indexToRemove < 1 || indexToRemove > queue.length) {
                    return message.reply(`❌ Urutan gak valid. Total antrean saat ini cuma ada ${queue.length} lagu.`)
                }

                // Hapus item dari array antrean berdasarkan index (dikurang 1 karena array mulai dari 0)
                const removedTrack = radioService.removeFromQueue(indexToRemove - 1)
                if (removedTrack) {
                    return message.reply(`🗑️ Berhasil menghapus **${removedTrack.title}** dari antrean playlist.`)
                } else {
                    return message.reply(`❌ Gagal menghapus lagu dari antrean playlist.`)
                }
            }

            // Logic menampilkan antrean normal
            const current = radioService.currentTrack
            const queue = radioService.queue

            if (!current && queue.length === 0) {
                return message.reply('Antrean kosong.')
            }

            let text = `**📻 Sedang Diputar:**\n🎶 ${current?.title || 'Unknown'} (${current?.durationFormatted || '?'})\n`
            if (queue.length > 0) {
                text += `\n**📋 Antrean Berikutnya:**\n`
                queue.forEach((t, i) => {
                    text += `${i + 1}. ${t.title} (${t.durationFormatted})\n`
                })
            }
            message.reply(text)
        }

        if (command === 'np' || command === 'nowplaying') {
            const info = radioService.getNowPlayingInfo()
            if (!info) return message.reply('📻 Radio tidak sedang memutar lagu. Ketik `!play [judul]` untuk mulai.')

            const { track, queue, listeners, fx, eq } = info
            const text = `**📻 Now Playing**\n\n` +
                `📀 **${track.title}**\n` +
                `⏱️ Durasi: \`${track.durationFormatted}\`\n` +
                `👥 Pendengar aktif: \`${listeners}\`\n` +
                `📋 Antrean: \`${queue} lagu\`\n` +
                `🎚️ FX: \`${fx}\` | EQ: \`${eq}\`\n\n` +
                `_Ketik \`!queue\` untuk antrean · \`!skip\` untuk skip_`

            if (track.thumbnail) {
                message.reply({
                    content: text,
                    embeds: [{ image: { url: track.thumbnail } }]
                })
            } else {
                message.reply(text)
            }
        }

        if (command === 'listener' || command === 'listeners') {
            const count = radioService.listenerCount
            const isPlaying = radioService.isPlaying
            const port = process.env.RADIO_PORT ?? '8080'

            message.reply(
                `**📻 Radio Status**\n\n` +
                `👥 Pendengar aktif: **${count}**\n` +
                `▶️ Status: ${isPlaying ? '**ON AIR** 🔴' : '**OFF** ⚫'}\n` +
                `🔗 Stream: \`http://ap2.nzb.zelpstore.id:${port}/stream\`\n\n` +
                `_Gunakan URL stream di media player favoritmu!_`
            )
        }

        if (command === 'fx' || command === 'effect') {
            if (!args.length) {
                const current = radioService.activeFx
                const list = AVAILABLE_FX.map(f => f === current ? `**${f} (active)**` : `\`${f}\``).join(', ')
                return message.reply(`🎚️ **Radio Audio Effects**\n\nEfek saat ini: **${current}**\n\nEfek tersedia: ${list}\n\n_Contoh: \`!fx bass\`_`)
            }

            const effect = args[0].toLowerCase()
            if (!AVAILABLE_FX.includes(effect)) {
                return message.reply(`❌ Efek "${effect}" tidak ditemukan. Tersedia: ${AVAILABLE_FX.map(f => `\`${f}\``).join(', ')}`)
            }

            try {
                radioService.setFx(effect)
                let suffix = ''
                if (radioService.isPlaying) {
                    await radioService.restartCurrent()
                    suffix = '\n_(Melakukan restart stream agar efek langsung aktif)_'
                }
                message.reply(`✅ Efek audio berhasil diubah ke: **${effect}**${suffix}`)
            } catch (err) {
                message.reply(`❌ Gagal mengubah efek: ${err.message}`)
            }
        }

        if (command === 'eq' || command === 'equalizer') {
            if (!args.length) {
                const current = radioService.activeEq
                const list = AVAILABLE_EQ.map(e => e === current ? `**${e} (active)**` : `\`${e}\``).join(', ')
                return message.reply(`🛛️ **Radio Equalizer Presets**\n\nPreset saat ini: **${current}**\n\nPreset tersedia: ${list}\n\n_Contoh: \`!eq rock\`_`)
            }

            const preset = args[0].toLowerCase()
            if (!AVAILABLE_EQ.includes(preset)) {
                return message.reply(`❌ Preset "${preset}" tidak ditemukan. Tersedia: ${AVAILABLE_EQ.map(e => `\`${e}\``).join(', ')}`)
            }

            try {
                radioService.setEq(preset)
                let suffix = ''
                if (radioService.isPlaying) {
                    await radioService.restartCurrent()
                    suffix = '\n_(Melakukan restart stream agar equalizer langsung aktif)_'
                }
                message.reply(`✅ Equalizer berhasil diubah ke: **${preset}**${suffix}`)
            } catch (err) {
                message.reply(`❌ Gagal mengubah equalizer: ${err.message}`)
            }
        }

        if (command === 'stop') {
            if (currentConnection) {
                currentConnection.destroy()
                currentConnection = null
                audioPlayer = null
                message.reply('Bot keluar dari Voice Channel. Siaran radio tetap berjalan di web.')
            } else {
                message.reply('Bot sedang tidak ada di Voice Channel.')
            }
        }

        if (command === 'fav' || command === 'myfav' || command === 'favlist' || command === 'playfav' || command === 'unfav') {
            const userJid = message.author.id + '@discord'
            const pushName = message.author.username

            // myfav / favlist lookup
            if (['myfav', 'favlist'].includes(command) || (command === 'fav' && args[0]?.toLowerCase() === 'list')) {
                const targetUser = message.mentions.users.first()
                const targetJid = targetUser ? (targetUser.id + '@discord') : userJid
                const isSelf = targetJid === userJid

                const list = dbGetFavorites(targetJid)
                if (!list || list.length === 0) {
                    return message.reply(isSelf 
                        ? '📭 **Daftar lagu favoritmu masih kosong.**\nPutar lagu yang kamu suka di radio, lalu ketik `!fav` untuk menambahkannya ke list ini!'
                        : `📭 **Daftar lagu favorit @${targetUser.username} masih kosong.**`
                    )
                }

                let text = isSelf 
                    ? `❤️ **Daftar Lagu Favoritmu (${list.length} lagu):**\n\n`
                    : `❤️ **Daftar Lagu Favorit ${targetUser.username} (${list.length} lagu):**\n\n`

                list.forEach((song, i) => {
                    const min = Math.floor(song.duration / 60)
                    const sec = song.duration % 60
                    const durStr = `${min}:${sec.toString().padStart(2, '0')}`
                    text += `${i + 1}. **${song.title}** - _${song.artist}_ (${durStr})\n`
                })

                if (isSelf) {
                    text += `\n💡 **Tips:**\n` +
                            `• Putar lagu favorit: \`!playfav <nomor/random/all>\`\n` +
                            `• Hapus dari favorit: \`!unfav <nomor>\``
                }

                return message.reply(text)
            }

            // unfav
            if (command === 'unfav' || (command === 'fav' && ['remove', 'hapus', 'r', 'delete'].includes(args[0]?.toLowerCase()))) {
                const list = dbGetFavorites(userJid)
                if (!list || list.length === 0) {
                    return message.reply('📭 Daftar lagu favoritmu kosong, tidak ada yang bisa dihapus.')
                }

                const rawIdx = command === 'fav' ? args[1] : args[0]
                const index = parseInt(rawIdx) - 1

                if (isNaN(index) || index < 0 || index >= list.length) {
                    return message.reply(`⚠️ Masukkan nomor lagu favorit yang ingin dihapus.\nContoh: \`!unfav 2\` (lihat nomor lagu di \`!myfav\`)`)
                }

                const targetSong = list[index]
                const success = dbRemoveFavorite(userJid, targetSong.song_id)

                if (success) {
                    return message.reply(`🗑️ **Berhasil menghapus lagu dari favorit:** \n_${targetSong.title}_ - ${targetSong.artist}`)
                } else {
                    return message.reply('❌ Gagal menghapus lagu dari favorit. Terjadi kesalahan internal.')
                }
            }

            // playfav
            if (command === 'playfav' || (command === 'fav' && args[0]?.toLowerCase() === 'play')) {
                const list = dbGetFavorites(userJid)
                if (!list || list.length === 0) {
                    return message.reply('📭 **Daftar lagu favoritmu masih kosong.** Ketik `!fav` saat lagu diputar untuk menyimpannya.')
                }

                const option = (command === 'fav' ? args[1] : args[0])?.toLowerCase()

                if (!option || option === 'random' || option === 'acak') {
                    const song = list[Math.floor(Math.random() * list.length)]
                    try {
                        const track = new Track({
                            title: song.title,
                            url: song.stream_url,
                            duration: song.duration,
                            thumbnail: song.thumbnail_url || null,
                            requestedBy: pushName,
                            requestedByJid: userJid,
                            source: song.source,
                            songId: song.song_id,
                            artist: song.artist
                        })
                        radioService.addToQueue(track)

                        await message.reply(
                            `` +
                            `✅ **Memutar Acak Favorit!**\n\n` +
                            `🎵 **${track.title}**\n` +
                            `⏱️ Durasi: ${track.durationFormatted}\n` +
                            `📋 Posisi: #${radioService.queue.length + (radioService.currentTrack ? 1 : 0)}`
                        )

                        if (!radioService.isPlaying) {
                            radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                        }
                    } catch (err) {
                        message.reply(`❌ Gagal memutar lagu: ${err.message}`)
                    }
                    return
                }

                if (option === 'all' || option === 'semua') {
                    let successCount = 0
                    for (const song of list) {
                        try {
                            const track = new Track({
                                title: song.title,
                                url: song.stream_url,
                                duration: song.duration,
                                thumbnail: song.thumbnail_url || null,
                                requestedBy: pushName,
                                requestedByJid: userJid,
                                source: song.source,
                                songId: song.song_id,
                                artist: song.artist
                            })
                            radioService.addToQueue(track)
                            successCount++
                        } catch (e) {
                            if (e.message.includes('Queue penuh')) break
                        }
                    }

                    await message.reply(`✅ Berhasil menambahkan **${successCount}** lagu favorit ke antrean. (Antrean saat ini: ${radioService.queue.length} lagu)`)
                    if (successCount > 0 && !radioService.isPlaying) {
                        radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                    }
                    return
                }

                const index = parseInt(option) - 1
                if (isNaN(index) || index < 0 || index >= list.length) {
                    return message.reply(`⚠️ Masukkan nomor lagu favorit yang valid atau ketik acak/all.\nContoh: \`!playfav 3\` (lihat nomor lagu di \`!myfav\`)`)
                }

                const song = list[index]
                try {
                    const track = new Track({
                        title: song.title,
                        url: song.stream_url,
                        duration: song.duration,
                        thumbnail: song.thumbnail_url || null,
                        requestedBy: pushName,
                        requestedByJid: userJid,
                        source: song.source,
                        songId: song.song_id,
                        artist: song.artist
                    })
                    radioService.addToQueue(track)

                    await message.reply(
                        `✅ **Ditambahkan ke queue!**\n\n` +
                        `🎵 **${track.title}**\n` +
                        `⏱️ Durasi: ${track.durationFormatted}\n` +
                        `📋 Posisi: #${radioService.queue.length + (radioService.currentTrack ? 1 : 0)}`
                    )

                    if (!radioService.isPlaying) {
                        radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                    }
                } catch (err) {
                    message.reply(`❌ Gagal memutar lagu: ${err.message}`)
                }
                return
            }

            const targetUser = message.mentions.users.first()
            if (targetUser) {
                const targetJid = targetUser.id + '@discord'
                const list = dbGetFavorites(targetJid)
                if (!list || list.length === 0) {
                    return message.reply(`📭 **Daftar lagu favorit @${targetUser.username} masih kosong.**`)
                }

                let text = `❤️ **Daftar Lagu Favorit ${targetUser.username} (${list.length} lagu):**\n\n`
                list.forEach((song, i) => {
                    const min = Math.floor(song.duration / 60)
                    const sec = song.duration % 60
                    const durStr = `${min}:${sec.toString().padStart(2, '0')}`
                    text += `${i + 1}. **${song.title}** - _${song.artist}_ (${durStr})\n`
                })
                return message.reply(text)
            }

            const info = radioService.getNowPlayingInfo()
            if (!info || !info.track) {
                return message.reply('📻 Radio sedang tidak memutar lagu.\nPutar lagu dulu dengan command `!play`, baru sukai lagunya menggunakan `!fav`.')
            }

            const currentTrack = info.track
            const alreadyFav = dbIsFavorite(userJid, currentTrack.songId)

            if (alreadyFav) {
                return message.reply(`⚠️ Lagu **${currentTrack.title}** sudah ada di daftar lagu favoritmu.`)
            }

            const success = dbAddFavorite(userJid, currentTrack.songId)
            if (success) {
                return message.reply(`❤️ **Berhasil menyukai lagu!**\n\n🎵 **${currentTrack.title}**\n_Lagu telah dimasukkan ke daftar favoritmu._\nKetik \`!myfav\` untuk melihat list.`)
            } else {
                return message.reply('❌ Gagal menambahkan lagu ke favorit. Silakan coba lagi.')
            }
        }

        if (command === 'recap' || command === 'wrapped' || command === 'rekap') {
            const userJid = message.author.id + '@discord'
            const pushName = message.author.username

            let isMe = false
            let offset = 0
            let targetMonthNum = null

            for (const arg of args.map(a => a.toLowerCase())) {
                if (['me', 'saya', 'aku'].includes(arg)) {
                    isMe = true
                } else if (['last', 'lalu', 'kemarin'].includes(arg)) {
                    offset = -1
                } else {
                    const num = parseInt(arg)
                    if (!isNaN(num) && num >= 1 && num <= 12) {
                        targetMonthNum = num
                    }
                }
            }

            function getMonthRange(monthOffset = 0, targetYear = null, targetMonth = null) {
                const now = new Date();
                const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
                let year = targetYear !== null ? targetYear : jakartaTime.getFullYear();
                let month = targetMonth !== null ? targetMonth - 1 : jakartaTime.getMonth() + monthOffset;
                const dateObj = new Date(year, month, 1);
                year = dateObj.getFullYear();
                month = dateObj.getMonth();
                const monthNames = [
                    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
                ];
                const startEpoch = Math.floor(Date.UTC(year, month, 1, 0, 0, 0, 0) / 1000) - (7 * 3600);
                const endEpoch = Math.floor(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) / 1000) - (7 * 3600) - 1;
                return { startEpoch, endEpoch, monthName: monthNames[month], year };
            }

            function formatDuration(seconds) {
                if (!seconds) return '0 menit'
                const hours = Math.floor(seconds / 3600)
                const minutes = Math.floor((seconds % 3600) / 60)
                if (hours > 0) return `${hours} jam ${minutes} menit`
                return `${minutes} menit`
            }

            const { startEpoch, endEpoch, monthName, year } = getMonthRange(offset, null, targetMonthNum)

            if (isMe) {
                try {
                    const userProfile = db.prepare('SELECT level, experience_points FROM users WHERE jid = ?').get(userJid)
                    const level = userProfile?.level || 1
                    const xp = userProfile?.experience_points || 0

                    const reqCount = db.prepare(`
                        SELECT COUNT(*) as count 
                        FROM requests 
                        WHERE user_jid = ? AND created_at >= ? AND created_at <= ? AND status = 'played'
                    `).get(userJid, startEpoch, endEpoch)?.count || 0

                    const listenTime = db.prepare(`
                        SELECT SUM(duration_seconds) as total 
                        FROM listening_sessions 
                        WHERE user_jid = ? AND joined_at >= ? AND joined_at <= ?
                    `).get(userJid, startEpoch, endEpoch)?.total || 0

                    const topSongs = db.prepare(`
                        SELECT s.title, s.artist, COUNT(*) as count
                        FROM play_history ph
                        JOIN songs s ON ph.song_id = s.song_id
                        WHERE ph.requested_by_jid = ? AND ph.played_at >= ? AND ph.played_at <= ?
                        GROUP BY ph.song_id
                        ORDER BY count DESC
                        LIMIT 3
                    `).all(userJid, startEpoch, endEpoch)

                    let text = `🎧 **YOUR RADIO WRAPPED - ${monthName.toUpperCase()} ${year}** 🎧\n` +
                               `Halo, **${pushName}**! Ini rangkuman perjalanan musikmu bulan ini:\n\n` +
                               `⭐ **Level Anda:** ${level} (${xp} XP)\n` +
                               `🎵 **Total Request:** ${reqCount} lagu diputar\n` +
                               `⏱️ **Waktu Mendengar:** ${formatDuration(listenTime)}\n\n`

                    if (topSongs && topSongs.length > 0) {
                        text += `🏆 **3 Lagu Favoritmu Bulan Ini:**\n`
                        topSongs.forEach((song, i) => {
                            text += `  ${i + 1}. **${song.title}** - _${song.artist}_ (${song.count}x request)\n`
                        })
                    } else {
                        text += `🏆 **Lagu teratas:** Kamu belum banyak memutar musik bulan ini. Yuk request lebih banyak lagu!`
                    }

                    text += `\n_Ketik \`!recap\` untuk melihat statistik global radio bulan ini._`
                    return message.reply(text)
                } catch (err) {
                    return message.reply(`❌ Gagal menyusun rekap personal: ${err.message}`)
                }
            }

            try {
                const totalPlayed = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM play_history 
                    WHERE played_at >= ? AND played_at <= ?
                `).get(startEpoch, endEpoch)?.count || 0

                const topSongs = db.prepare(`
                    SELECT s.title, s.artist, COUNT(*) as count
                    FROM play_history ph
                    JOIN songs s ON ph.song_id = s.song_id
                    WHERE ph.played_at >= ? AND ph.played_at <= ?
                    GROUP BY ph.song_id
                    ORDER BY count DESC
                    LIMIT 5
                `).all(startEpoch, endEpoch)

                const topRequesters = db.prepare(`
                    SELECT u.name, COUNT(*) as count
                    FROM requests r
                    JOIN users u ON r.user_jid = u.jid
                    WHERE r.created_at >= ? AND r.created_at <= ? AND r.status = 'played'
                    GROUP BY r.user_jid
                    ORDER BY count DESC
                    LIMIT 3
                `).all(startEpoch, endEpoch)

                const topListeners = db.prepare(`
                    SELECT u.name, SUM(ls.duration_seconds) as total_duration
                    FROM listening_sessions ls
                    JOIN users u ON ls.user_jid = u.jid
                    WHERE ls.joined_at >= ? AND ls.joined_at <= ?
                    GROUP BY ls.user_jid
                    ORDER BY total_duration DESC
                    LIMIT 3
                `).all(startEpoch, endEpoch)

                let text = `📻 **RADIO RECAP & WRAPPED - ${monthName.toUpperCase()} ${year}** 📻\n` +
                           `Statistik siaran dan pendengar radio global:\n\n` +
                           `📊 **Total Lagu Diputar:** ${totalPlayed} kali\n\n`

                if (topSongs && topSongs.length > 0) {
                    text += `🔥 **5 Lagu Paling Banyak Diputar:**\n`
                    topSongs.forEach((song, i) => {
                        text += `  ${i + 1}. **${song.title}** - _${song.artist}_ (${song.count}x diputar)\n`
                    })
                    text += `\n`
                }

                if (topRequesters && topRequesters.length > 0) {
                    text += `👑 **Top Requester Teraktif:**\n`
                    topRequesters.forEach((req, i) => {
                        text += `  ${i + 1}. **${req.name}** (${req.count} lagu)\n`
                    })
                    text += `\n`
                }

                if (topListeners && topListeners.length > 0) {
                    text += `🎧 **Pendengar Paling Setia:**\n`
                    topListeners.forEach((lis, i) => {
                        text += `  ${i + 1}. **${lis.name}** (${formatDuration(lis.total_duration)})\n`
                    })
                    text += `\n`
                }

                text += `_Ketik \`!recap me\` untuk melihat rangkuman musikmu sendiri bulan ini!_`
                return message.reply(text)
            } catch (err) {
                return message.reply(`❌ Gagal menyusun rekap global: ${err.message}`)
            }
        }

        if (command === 'lyrics' || command === 'lirik' || command === 'ly') {
            let query = args.join(' ').trim()

            if (!query) {
                const info = radioService.getNowPlayingInfo()
                if (info && info.track) {
                    const artist = info.track.artist && info.track.artist !== 'Unknown' ? info.track.artist : ''
                    query = artist ? `${artist} - ${info.track.title}` : info.track.title
                }
            }

            if (!query) {
                return message.reply('📻 **Radio sedang tidak memutar lagu.**\nTulis judul lagu yang ingin dicari.\nContoh: `!lyrics Remember Me`')
            }

            try {
                const msg = await message.reply(`🔍 Mencari lirik untuk: \`${query}\`...`)
                const result = await lyricsService.fetchLyrics(query)
                if (!result || !result.plainLyrics) {
                    return msg.edit(`❌ **Lirik tidak ditemukan** untuk pencarian: "${query}"`)
                }

                let text = `🎤 **Lirik Lagu:** **${result.title}** - _${result.artist}_\n\n`
                text += result.plainLyrics

                if (text.length <= 1900) {
                    await msg.edit(text)
                } else {
                    await msg.edit(text.substring(0, 1900) + '\n\n...(Lirik terlalu panjang, bersambung)')
                }
            } catch (err) {
                message.reply(`❌ Gagal mencari lirik: ${err.message}`)
            }
        }

        if (command === 'playlist' || command === 'pl') {
            const userJid = message.author.id + '@discord'
            const pushName = message.author.username

            if (!args.length) {
                return message.reply(
                    `🎶 **Panduan Command Playlist (!pl):**\n\n` +
                    `• \`!pl create [nama]\` : Buat playlist baru\n` +
                    `• \`!pl list\` : Lihat daftar playlist kamu\n` +
                    `• \`!pl add [nama]\` : Tambahkan lagu aktif ke playlist\n` +
                    `• \`!pl show [nama]\` : Lihat isi lagu di playlist\n` +
                    `• \`!pl remove [nama] [no]\` : Hapus lagu di playlist\n` +
                    `• \`!pl play [nama]\` : Putar antrean dari playlist\n` +
                    `• \`!pl play [nama] random\` : Putar acak playlist\n` +
                    `• \`!pl delete [nama]\` : Hapus playlist`
                )
            }

            const action = args[0].toLowerCase()

            if (action === 'create') {
                const name = args.slice(1).join(' ').trim()
                if (!name) return message.reply('⚠️ Masukkan nama playlist yang ingin dibuat. Contoh: `!pl create Rock`')
                try {
                    dbCreatePlaylist(userJid, name)
                    return message.reply(`✅ **Playlist "${name}" berhasil dibuat!**`)
                } catch (err) {
                    return message.reply(`❌ Gagal membuat playlist: ${err.message}`)
                }
            }

            if (action === 'list') {
                const list = dbGetPlaylists(userJid)
                if (!list || list.length === 0) {
                    return message.reply('📭 Kamu belum memiliki playlist. Buat dengan: `!pl create [nama]`')
                }
                let text = `🎶 **Daftar Playlist Kamu (${list.length}):**\n\n`
                list.forEach((pl, i) => {
                    text += `${i + 1}. **${pl.name}**\n`
                })
                return message.reply(text)
            }

            if (action === 'add') {
                const name = args.slice(1).join(' ').trim()
                if (!name) return message.reply('⚠️ Masukkan nama playlist target. Contoh: `!pl add Rock`')

                const info = radioService.getNowPlayingInfo()
                if (!info || !info.track) {
                    return message.reply('📻 Radio sedang tidak memutar lagu untuk ditambahkan.')
                }

                try {
                    dbAddSongToPlaylist(userJid, name, info.track.songId)
                    return message.reply(`✅ Berhasil menambahkan **${info.track.title}** ke playlist **"${name}"**..`)
                } catch (err) {
                    return message.reply(`❌ Gagal: ${err.message}`)
                }
            }

            if (action === 'show') {
                const name = args.slice(1).join(' ').trim()
                if (!name) return message.reply('⚠️ Masukkan nama playlist yang ingin dilihat. Contoh: `!pl show Rock`')

                const songs = dbGetPlaylistSongs(userJid, name)
                if (songs === null) {
                    return message.reply(`❌ Playlist "${name}" tidak ditemukan.`)
                }

                if (songs.length === 0) {
                    return message.reply(`📭 Playlist **"${name}"** masih kosong. Putar lagu lalu tambahkan dengan: \`!pl add ${name}\``)
                }

                let text = `📂 **Isi Playlist "${name}" (${songs.length} lagu):**\n\n`
                songs.forEach((song, i) => {
                    const min = Math.floor(song.duration / 60)
                    const sec = song.duration % 60
                    const durStr = `${min}:${sec.toString().padStart(2, '0')}`
                    text += `${i + 1}. **${song.title}** - _${song.artist}_ (${durStr})\n`
                })
                return message.reply(text)
            }

            if (action === 'remove') {
                if (args.length < 3) {
                    return message.reply('⚠️ Format salah. Contoh: `!pl remove Rock 2` (hapus lagu nomor 2 di playlist Rock)')
                }
                const songIndexStr = args[args.length - 1]
                const playlistName = args.slice(1, -1).join(' ').trim()
                const songIndex = parseInt(songIndexStr) - 1

                if (isNaN(songIndex)) {
                    return message.reply('⚠️ Nomor urutan lagu harus berupa angka.')
                }

                try {
                    dbRemoveSongFromPlaylist(userJid, playlistName, songIndex)
                    return message.reply(`🗑️ Berhasil menghapus lagu dari playlist **"${playlistName}"**.`)
                } catch (err) {
                    return message.reply(`❌ Gagal: ${err.message}`)
                }
            }

            if (action === 'play') {
                const isRandom = args[args.length - 1]?.toLowerCase() === 'random'
                const playlistName = (isRandom ? args.slice(1, -1) : args.slice(1)).join(' ').trim()

                if (!playlistName) {
                    return message.reply('⚠️ Masukkan nama playlist yang ingin diputar. Contoh: `!pl play Rock`')
                }

                const songs = dbGetPlaylistSongs(userJid, playlistName)
                if (songs === null) {
                    return message.reply(`❌ Playlist "${playlistName}" tidak ditemukan.`)
                }

                if (songs.length === 0) {
                    return message.reply(`📭 Playlist **"${playlistName}"** masih kosong.`)
                }

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
                            requestedByJid: userJid,
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

                await message.reply(`✅ Memutar playlist **"${playlistName}"** (${isRandom ? 'acak' : 'urut'}). Menambahkan **${addedCount}** lagu ke antrean.`)

                if (addedCount > 0 && !radioService.isPlaying) {
                    radioService.start().catch(e => console.error('[Radio] Start error:', e.message))
                }
                return
            }

            if (action === 'delete') {
                const name = args.slice(1).join(' ').trim()
                if (!name) return message.reply('⚠️ Masukkan nama playlist yang ingin dihapus. Contoh: `!pl delete Rock`')

                try {
                    dbDeletePlaylist(userJid, name)
                    return message.reply(`🗑️ **Playlist "${name}" berhasil dihapus.**`)
                } catch (err) {
                    return message.reply(`❌ Gagal menghapus: ${err.message}`)
                }
            }

            return message.reply('❓ Subcommand tidak dikenali. Ketik `!pl` untuk melihat panduan lengkap.')
        }
    })

    discordClient.login(token).catch(err => {
        logger.error(`[Discord] Gagal login: ${err.message}`)
    })
}

/**
 * Mengambil informasi lagu Spotify aktif saat ini dari presence Owner Discord
 */
export async function getOwnerSpotifyTrack() {
    if (!discordClient) {
        throw new Error('Discord bot belum diinisialisasi atau dinonaktifkan.')
    }
    const ownerId = process.env.DISCORD_OWNER_ID
    if (!ownerId) {
        throw new Error('DISCORD_OWNER_ID belum dikonfigurasi di file .env.')
    }

    // Cari member owner di seluruh guild yang diikuti bot
    let member = null
    for (const guild of discordClient.guilds.cache.values()) {
        try {
            member = await guild.members.fetch(ownerId)
            if (member) break
        } catch (e) {
            // Lanjut cari di guild lain
        }
    }

    if (!member) {
        throw new Error('Owner tidak ditemukan di server Discord mana pun yang diikuti bot.')
    }

    const presence = member.presence
    if (!presence) {
        throw new Error('Presence owner tidak terdeteksi. Pastikan status owner aktif di Discord (tidak Invisible) dan bot memiliki Presence Intent.')
    }

    const spotify = presence.activities.find(
        act => act.name === 'Spotify' && act.type === ActivityType.Listening
    )

    if (!spotify) {
        throw new Error('Owner sedang tidak memutar lagu di Spotify.')
    }

    const songTitle = spotify.details
    const artist = spotify.state
    return {
        songTitle,
        artist,
        query: artist ? `${artist} - ${songTitle}` : songTitle
    }
}