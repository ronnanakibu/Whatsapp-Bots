// src/commands/radio/eq.js
import { radioService, AVAILABLE_EQ } from '../../services/radio.js'

export default {
    name: 'eq',
    aliases: ['equalizer'],
    category: 'radio',
    description: 'Ubah preset equalizer audio radio',
    usage: '.eq [nama_preset]',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args } = ctx

        if (!args.length) {
            const current = radioService.activeEq
            const list = AVAILABLE_EQ.map(e => e === current ? `*${e} (active)*` : `\`${e}\``).join(', ')
            return reply(`🎛️ *Radio Equalizer Presets*\n\nPreset saat ini: *${current}*\n\nDaftar preset tersedia:\n${list}\n\n_Contoh: .eq rock_`)
        }

        const preset = args[0].toLowerCase()
        if (!AVAILABLE_EQ.includes(preset)) {
            return reply(`❌ Preset equalizer "${preset}" tidak ditemukan. Tersedia: ${AVAILABLE_EQ.map(e => `\`${e}\``).join(', ')}`)
        }

        try {
            radioService.setEq(preset)

            // Restart current track agar EQ langsung aktif
            let suffix = ''
            if (radioService.isPlaying) {
                await radioService.restartCurrent()
                suffix = '\n_(Melakukan restart stream agar equalizer langsung aktif)_'
            }

            await reply(`✅ Equalizer berhasil diubah ke: *${preset}*${suffix}`)
        } catch (err) {
            await reply(`❌ Gagal mengubah equalizer: ${err.message}`)
        }
    }
}
