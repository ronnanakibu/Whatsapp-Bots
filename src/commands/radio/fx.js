// src/commands/radio/fx.js
import { radioService, AVAILABLE_FX } from '../../services/radio.js'

export default {
    name: 'fx',
    aliases: ['effect', 'efek'],
    category: 'radio',
    description: 'Ubah efek suara audio radio',
    usage: '.fx [nama_efek]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args } = ctx

        if (!args.length) {
            const current = radioService.activeFx
            const list = AVAILABLE_FX.map(f => f === current ? `*${f} (active)*` : `\`${f}\``).join(', ')
            return reply(`🎚️ *Radio Audio Effects*\n\nEfek saat ini: *${current}*\n\nDaftar efek tersedia:\n${list}\n\n_Contoh: .fx bass_`)
        }

        const effect = args[0].toLowerCase()
        if (!AVAILABLE_FX.includes(effect)) {
            return reply(`❌ Efek "${effect}" tidak ditemukan. Tersedia: ${AVAILABLE_FX.map(f => `\`${f}\``).join(', ')}`)
        }

        try {
            radioService.setFx(effect)

            // Restart current track agar efek langsung aktif
            let suffix = ''
            if (radioService.isPlaying) {
                await radioService.restartCurrent()
                suffix = '\n_(Melakukan restart stream agar efek langsung aktif)_'
            }

            await reply(`✅ Efek audio berhasil diubah ke: *${effect}*${suffix}`)
        } catch (err) {
            await reply(`❌ Gagal mengubah efek: ${err.message}`)
        }
    }
}
