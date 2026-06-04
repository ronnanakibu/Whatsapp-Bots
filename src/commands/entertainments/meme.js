import axios from 'axios'

export default {
    name: 'meme',
    aliases: ['randomeme', 'memes'],
    category: 'entertainment',
    description: 'Random meme dari Reddit',
    usage: '.meme [subreddit]',
    example: '.meme programmerhumor',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        const subreddits = ['memes', 'dankmemes', 'me_irl', 'ProgrammerHumor', 'indonesia']
        const sub = args[0] ? args[0].toLowerCase().trim() : subreddits[Math.floor(Math.random() * subreddits.length)]

        await react('⏳')

        try {
            const apiUrl = `https://meme-api.com/gimme/${sub}`
            const response = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WABOT2.0'
                }
            })

            const data = response.data
            if (!data || !data.url) {
                throw new Error('Gagal mendapatkan gambar meme dari API.')
            }

            // Kirim gambar meme ke WhatsApp
            await sock.sendMessage(from, {
                image: { url: data.url },
                caption: `😂 *${data.title || 'Meme'}*\n\nr/${data.subreddit || sub} • ⬆️ ${data.ups?.toLocaleString() ?? 0}`
            }, { quoted: msg })

            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal ambil meme dari r/${sub}: ${err.message}`)
        }
    }
}