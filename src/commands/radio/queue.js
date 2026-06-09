// src/commands/radio/queue.js
import { radioService } from '../../services/radio.js'

export default {
    name: 'queue',
    aliases: ['rq', 'antrian', 'daftar'],
    category: 'radio',
    description: 'Lihat atau hapus antrian lagu radio',
    usage: '.queue [remove/hapus/r <angka/batch>]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args } = ctx
        const current = radioService.currentTrack
        const queue = radioService.queue

        // 🛠️ Pembaruan Fitur: Batch Remove Queue
        const subCommand = args?.[0]?.toLowerCase()
        if (['remove', 'hapus', 'r'].includes(subCommand)) {
            if (!args[1]) {
                return reply('⚠️ Masukkan angka urutan playlist yang mau dihapus.\nContoh:\n• Tunggal: `.queue r 3`\n• Banyak (koma): `.queue r 1,2,4`\n• Banyak (spasi): `.queue r 1 2 4`')
            }

            if (!queue || queue.length === 0) {
                return reply('📭 Antrean playlist lagi kosong, nih.')
            }

            // 1. Gabungkan argumen lalu split berdasarkan koma atau spasi
            const rawInputs = args.slice(1).join(',').split(/[\s,]+/).filter(x => x.trim() !== '')

            // 2. Parsing jadi angka valid dan bersihkan dari duplikat (biar gak ngehapus indeks sama)
            const parsedIndices = rawInputs.map(x => parseInt(x)).filter(x => !isNaN(x))
            const uniqueIndices = [...new Set(parsedIndices)]

            if (uniqueIndices.length === 0) {
                return reply('⚠️ Angka urutan tidak valid, cuy. Contoh: `.queue r 1,2,4`')
            }

            // 3. Validasi: Pastikan gak ada angka yang ngaco (minus atau melebihi total antrean)
            const invalidIndices = uniqueIndices.filter(idx => idx < 1 || idx > queue.length)
            if (invalidIndices.length > 0) {
                return reply(`❌ Urutan tidak valid: *${invalidIndices.join(', ')}*.\nTotal antrean saat ini cuma ada ${queue.length} lagu.`)
            }

            // 4. WAJIB: Urutkan indeks dari BESAR ke KECIL (descending)
            // Biar pas array dipotong pake .splice(), indeks lagu di depannya gak ikut bergeser!
            uniqueIndices.sort((a, b) => b - a)

            const removedTracks = []
            for (const index of uniqueIndices) {
                // index - 1 karena urutan user mulai dari 1, sedangkan array JS mulai dari 0
                const removed = queue.splice(index - 1, 1)[0]
                if (removed) {
                    removedTracks.push(removed.title)
                }
            }

            // Balik kembali urutan teksnya biar rapi pas dibaca user (dari indeks terkecil)
            removedTracks.reverse()

            let textResponse = `🗑️ *Berhasil menghapus ${removedTracks.length} lagu dari antrean:*\n`
            removedTracks.forEach((title, i) => {
                textResponse += `${i + 1}. _${title}_\n`
            })

            return reply(textResponse)
        }

        // 📋 Logic Bawaan: Menampilkan list antrean saat ini
        if (!current && queue.length === 0) {
            return reply('📻 Queue kosong. Tambahkan lagu dengan !play [judul]')
        }

        let text = `📻 *Radio Queue* (${radioService.listenerCount} listener)\n\n`

        if (current) {
            text += `▶️ *Now Playing:*\n`
            text += `   ${current.title} _(${current.durationFormatted})_\n\n`
        }

        if (queue.length) {
            text += `📋 *Up Next (${queue.length} lagu):*\n`
            queue.slice(0, 10).forEach((track, i) => {
                text += `${i + 1}. ${track.title} _(${track.durationFormatted})_\n`
            })
            if (queue.length > 10) text += `_...dan ${queue.length - 10} lagu lagi_\n`
        } else {
            text += `📋 Queue kosong setelah lagu ini.`
        }

        await reply(text)
    }
}