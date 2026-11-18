// src/commands/media/batchsticker.js
import { batchStickerService } from '../../services/batchSticker.js'

export default {
    name: 'batchsticker',
    aliases: ['stikerbatch', 'batchs', 'sbatch'],
    category: 'media',
    description: 'Toggle batch media processing for stickers without spam handler',
    usage: '.batchsticker [on/off]',
    example: '.batchsticker on | .batchsticker off | .batchsticker',
    cooldown: 3,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['sticker', 'batch', 'media', 'settings'],

    async execute(ctx) {
        const { args, reply, from, isGroup } = ctx
        const action = args[0]?.toLowerCase()

        const currentStatus = batchStickerService.isEnabled(from)

        if (!action) {
            const statusText = currentStatus ? '🟢 *AKTIF (ON)*' : '🔴 *NONAKTIF (OFF)*'
            return reply(
                `📦 *Batch Sticker Processing Settings*\n\n` +
                `Status saat ini: ${statusText}\n\n` +
                `*Cara Mengubah:* \n` +
                `• \`.batchsticker on\` — Mengaktifkan mode batch stiker\n` +
                `• \`.batchsticker off\` — Menonaktifkan mode batch stiker\n\n` +
                `_Fitur ini otomatis mendeteksi album/burst media dan memprosesnya secara berurutan dengan jeda aman 3 detik per stiker tanpa terblokir anti-spam._`
            )
        }

        if (['on', 'enable', 'aktif', '1', 'true'].includes(action)) {
            batchStickerService.setEnabled(from, true)
            return reply(`✅ *Batch Sticker Mode Berhasil Diaktifkan!* (🟢 ON)\n\nSekarang jika ada album atau banyak foto dikirim bersamaan dengan caption *.s*, bot akan memproses semuanya secara batch dengan jeda aman 3 detik.`)
        }

        if (['off', 'disable', 'mati', '0', 'false'].includes(action)) {
            batchStickerService.setEnabled(from, false)
            return reply(`🔴 *Batch Sticker Mode Dinonaktifkan.* (OFF)\n\nBot hanya akan memproses satu media per pesan.`)
        }

        return reply(`⚠️ Pilihan tidak valid. Gunakan \`.batchsticker on\` atau \`.batchsticker off\`.`)
    }
}
