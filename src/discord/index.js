import { Client, GatewayIntentBits } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice'
import { radioService } from '../services/radio.js'
import { logger } from '../utils/logger.js'

let discordClient = null
let currentConnection = null
let audioPlayer = null

export function startDiscordBot() {
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

    discordClient.on('clientReady', () => {
        logger.info(`[Discord] Bot online sebagai ${discordClient.user.tag}`)
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
                })

                audioPlayer.on('error', error => {
                    logger.error(`[Discord] AudioPlayer Error: ${error.message}`)
                })

                const radioPort = process.env.RADIO_PORT || 8080
                const resource = createAudioResource(`http://127.0.0.1:${radioPort}/stream`)
                audioPlayer.play(resource)
                
                message.reply('Sudah mendarat di Voice Channel & standby muter siaran radio WA! 📻')
            } else {
                message.reply('Bot udah ada di Voice Channel kamu kok.')
            }
            return
        }

        if (command === 'play') {
            const query = args.join(' ')
            if (!query) return message.reply('Tulis lagu yang mau diputar. Contoh: `!play Nadin Amizah`')

            const voiceChannel = message.member?.voice?.channel
            if (!voiceChannel) return message.reply('Kamu harus masuk ke Voice Channel dulu!')

            // Join Voice Channel jika belum join atau di channel berbeda
            if (!currentConnection || currentConnection.joinConfig.channelId !== voiceChannel.id) {
                currentConnection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                })

                audioPlayer = createAudioPlayer()
                currentConnection.subscribe(audioPlayer)

                audioPlayer.on(AudioPlayerStatus.Idle, () => {
                    // Ketika stream berhenti, coba resubscribe jika radio masih main
                    logger.debug('[Discord] AudioPlayer Idle, tapi radioService jalan terus.')
                })

                audioPlayer.on('error', error => {
                    logger.error(`[Discord] AudioPlayer Error: ${error.message}`)
                })

                // Ambil stream HTTP dari radioService WA
                const radioPort = process.env.RADIO_PORT || 8080
                const resource = createAudioResource(`http://127.0.0.1:${radioPort}/stream`)
                audioPlayer.play(resource)

                message.reply('Masuk ke Voice Channel & menyambungkan siaran radio WA! 📻')
            }

            try {
                // Tambahkan lagu ke antrean global WA
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
            radioService.skipTrack()
            message.reply('⏭️ Lagu di-skip!')
        }

        if (command === 'queue') {
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
