// src/commands/entertainments/bikinlagu.js
// !bikinlagu [genre/vibe] — Automate generating suno music, loops video, and uploads to YouTube
// Alias: !bikinlagu, !musicgen

import { startSunoPipeline } from '../../services/suno.js'

export default {
    name: 'bikinlagu',
    aliases: ['musicgen', 'suno'],
    category: 'entertainments',
    description: 'Bikin lagu instrumental otomatis via Suno & upload ke YouTube.',
    usage: '!bikinlagu [genre atau vibe lagu]',
    example: '!bikinlagu lofi chillhop sore hari santai',
    cooldown: 30,
    permissions: ['owner'], // Hanya owner yang boleh agar tidak menghabiskan kuota YouTube/Suno

    async execute(ctx) {
        const { args, reply, react, chatId } = ctx

        if (!args.length) {
            return reply(
                `*Cara pakai:*\n!bikinlagu [genre atau vibe lagu]\n\n` +
                `Contoh:\n` +
                `!bikinlagu lofi chillhop sore hari santai\n` +
                `!bikinlagu metal rock heroik instrumental\n` +
                `!bikinlagu cinematic piano sedih menyentuh hati`
            )
        }

        const prompt = args.join(' ')
        await react('🎵')
        await reply(`🎵 *Proses dimulai, tunggu bentar ya...*\n\nBot akan membuatkan musik instrumen, mendesain thumbnail AI, merender video looping, dan mengunggahnya langsung ke YouTube. Kamu akan dikirimi link jika sudah selesai!`)

        try {
            await startSunoPipeline({
                prompt,
                title: null, // Gemini will generate it
                enhance: true, // Sempurnakan dengan Gemini
                source: 'whatsapp',
                chatId
            })
        } catch (err) {
            await react('❌')
            await reply(`Gagal memulai proses automasi musik:\n${err.message}`)
        }
    }
}
