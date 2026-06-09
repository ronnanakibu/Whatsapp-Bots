import { Client, GatewayIntentBits, ActivityType } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice'
import { radioService, AVAILABLE_FX, AVAILABLE_EQ } from '../services/radio.js'
import { logger } from '../utils/logger.js'

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
                const track = await radioService.search(query, message.author.username)
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
                const removedTrack = queue.splice(indexToRemove - 1, 1)[0]
                return message.reply(`🗑️ Berhasil menghapus **${removedTrack.title}** dari antrean playlist.`)
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
                `🔗 Stream: \`http://[host]:${port}/stream\`\n\n` +
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
    })

    discordClient.login(token).catch(err => {
        logger.error(`[Discord] Gagal login: ${err.message}`)
    })
}