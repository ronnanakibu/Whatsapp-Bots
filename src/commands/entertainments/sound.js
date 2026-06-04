import { logger } from '../../utils/logger.js'

const MEME_SOUNDS = {
    'vineboom': 'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh': 'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'crickets': 'https://www.myinstants.com/media/sounds/crickets.mp3',
    'fart': 'https://www.myinstants.com/media/sounds/fart-with-reverb.mp3',
    'sadviolin': 'https://www.myinstants.com/media/sounds/sad-violin.mp3',
    'laugh': 'https://www.myinstants.com/media/sounds/laugh-track.mp3',
    'wow': 'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'spongebob': 'https://www.myinstants.com/media/sounds/spongebob-fail.mp3',
    'nani': 'https://www.myinstants.com/media/sounds/nani_1.mp3',
    'run': 'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
    'bonk': 'https://www.myinstants.com/media/sounds/bonk_XjB1kwG.mp3',
    'emotional': 'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
    'illuminati': 'https://www.myinstants.com/media/sounds/illuminati-confirmed.mp3',
    'windows': 'https://www.myinstants.com/media/sounds/windows-xp-startup.mp3',
    'boom': 'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3'
}

export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme (vineboom, bruh, dll)',
    usage: '.sound <nama_sound>',
    example: '.sound vineboom',
    cooldown: 3,
    permissions: ['user'],
    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        if (args.length === 0) {
            const available = Object.keys(MEME_SOUNDS).map(s => `- ${s}`).join('\n')
            return reply(`⚠️ Sebutkan nama sound-nya!\n\n*Sound Tersedia:*\n${available}\n\n*Contoh:* !sound bruh`)
        }

        const query = args[0].toLowerCase()
        const soundUrl = MEME_SOUNDS[query]

        if (!soundUrl) {
            await react('❌')
            return reply(`❌ Sound "${query}" tidak ditemukan.\n\nKetik *!sound* untuk melihat daftar.`)
        }

        await react('⏳')

        try {
            await sock.sendMessage(from, {
                audio: { url: soundUrl },
                mimetype: 'audio/mpeg',
                ptt: false // Nonaktifkan PTT agar MP3 bisa diputar di WA Mobile tanpa error
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('❌ [Sound] Error:', err.message)
            await react('❌')
            await reply('❌ Gagal mengirim sound, mungkin link-nya mati.')
        }
    }
}
