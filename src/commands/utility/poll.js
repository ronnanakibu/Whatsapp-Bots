// src/commands/utility/poll.js
// Official Native WhatsApp Interactive Poll & Voting Creator

import { getCleanQuoted } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

export default {
    name: 'poll',
    aliases: ['vote', 'polling', 'voting', 'votasi'],
    category: 'utility',
    description: 'Buat voting / polling resmi WhatsApp interaktif di grup atau chat',
    usage: '.poll Judul Pertanyaan | Opsi 1 | Opsi 2 | Opsi 3...',
    example: '.poll Mau nongkrong di mana? | Cafe A | Kopi Kenangan | Warkop',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, from, sock, msg, react } = ctx

        const fullText = args.join(' ').trim()
        if (!fullText || !fullText.includes('|')) {
            return reply(
                '📊 *PANDUAN MEMBUAT POLLING WHATSAPP*\n\n' +
                'Gunakan tanda garis tegak *( | )* sebagai pemisah antara judul dan pilihan jawaban.\n\n' +
                '📌 *Contoh Penggunaan:*\n' +
                '• `.poll Mau nongkrong di mana? | Kopi Kenangan | Mixue | Warkop`\n' +
                '• `.poll Jadwal Futsal | Sabtu Malam | Minggu Sore | Skip dulu`\n' +
                '• `.poll Menu Makan Siang | Nasi Padang | Ayam Geprek | Bakso`\n\n' +
                '_Minimal 2 pilihan opsi dan maksimal 12 pilihan._'
            )
        }

        const parts = fullText.split('|').map(p => p.trim()).filter(Boolean)

        if (parts.length < 3) {
            return reply('❌ Polling membutuhkan minimal **1 judul pertanyaan** dan **minimal 2 pilihan jawaban**.\n\n*Contoh:* `.poll Pilih Mana? | Opsi A | Opsi B`')
        }

        const question = parts[0]
        let choices = parts.slice(1)

        // WhatsApp Poll supports maximum 12 options
        if (choices.length > 12) {
            choices = choices.slice(0, 12)
        }

        // WhatsApp requires options to have distinct text
        const uniqueChoices = Array.from(new Set(choices))
        if (uniqueChoices.length < 2) {
            return reply('❌ Setiap pilihan jawaban dalam polling harus unik/berbeda satu sama lain.')
        }

        try {
            await react('📊')

            await sock.sendMessage(
                from,
                {
                    poll: {
                        name: question,
                        values: uniqueChoices,
                        selectableCount: 1
                    }
                },
                { quoted: getCleanQuoted(msg) }
            )
        } catch (err) {
            logger.error('[Poll] Error creating WhatsApp poll:', err.message)
            await react('❌')
            return reply(`❌ Gagal membuat polling: ${err.message}`)
        }
    }
}
