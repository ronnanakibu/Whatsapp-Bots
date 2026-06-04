import { logger } from '../../utils/logger.js'

export default {
    name: 'template',
    aliases: ['meme-template', 'rawmeme'],
    category: 'entertainment',
    description: 'Ambil mentahan meme (template) dari Imgflip',
    usage: '.template [nama_meme]',
    example: '.template drake',
    cooldown: 5,
    permissions: ['user'],
    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx

        await react('⏳')

        try {
            const res = await fetch('https://api.imgflip.com/get_memes')
            const data = await res.json()

            if (!data.success) {
                throw new Error('Gagal menghubungi API Imgflip.')
            }

            const memes = data.data.memes
            let selectedMeme

            if (args.length > 0) {
                const query = args.join(' ').toLowerCase()
                // Cari berdasarkan query
                const matches = memes.filter(m => m.name.toLowerCase().includes(query))
                if (matches.length > 0) {
                    // Ambil hasil pertama yang cocok
                    selectedMeme = matches[0]
                } else {
                    await react('❌')
                    return reply(`❌ Template dengan nama "${query}" tidak ditemukan.`)
                }
            } else {
                // Random
                selectedMeme = memes[Math.floor(Math.random() * memes.length)]
            }

            await sock.sendMessage(from, {
                image: { url: selectedMeme.url },
                caption: `🖼️ *${selectedMeme.name}*\n\nUkuran: ${selectedMeme.width}x${selectedMeme.height}`
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('❌ [Template] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal mengambil template: ${err.message}`)
        }
    }
}
