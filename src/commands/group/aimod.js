// src/commands/group/aimod.js
import { moderatorService } from '../../services/moderator.js'

export default {
    name: 'aimod',
    aliases: ['moderation', 'ai-moderator'],
    category: 'admin',
    description: 'Mengaktifkan atau mengatur AI Moderator di grup.',
    usage: '.aimod [on/off/warnings/reset/max]',
    cooldown: 3,
    permissions: ['admin'],

    async execute(ctx) {
        const { args, reply, chatId, sender } = ctx
        const subCommand = args[0]?.toLowerCase()

        if (!subCommand) {
            const config = await moderatorService.getModerationConfig(chatId)
            return reply(
                `🛡️ *Status AI Moderator*\n\n` +
                `• *Status:* ${config.enabled ? '✅ Aktif' : '❌ Nonaktif'}\n` +
                `• *Batas Peringatan:* ${config.max_warnings}x\n\n` +
                `*Cara Mengatur:*\n` +
                `• \`!aimod on\` - Aktifkan moderator\n` +
                `• \`!aimod off\` - Matikan moderator\n` +
                `• \`!aimod max [angka]\` - Ubah batas peringatan\n` +
                `• \`!aimod warnings\` - Lihat daftar peringatan anggota\n` +
                `• \`!aimod reset @user\` - Reset peringatan pengguna`
            )
        }

        if (subCommand === 'on') {
            await moderatorService.setModerationEnabled(chatId, true)
            return reply('✅ *AI Moderator berhasil diaktifkan untuk grup ini.*')
        }

        if (subCommand === 'off') {
            await moderatorService.setModerationEnabled(chatId, false)
            return reply('❌ *AI Moderator berhasil dinonaktifkan.*')
        }

        if (subCommand === 'max') {
            const max = parseInt(args[1])
            if (isNaN(max) || max < 1 || max > 10) {
                return reply('⚠️ Batas peringatan harus berupa angka antara 1 sampai 10.')
            }
            await moderatorService.setMaxWarnings(chatId, max)
            return reply(`✅ Batas peringatan diatur menjadi *${max}x*.`)
        }

        if (subCommand === 'warnings') {
            const list = await moderatorService.getGroupWarnings(chatId)
            if (list.length === 0) {
                return reply('✅ Tidak ada anggota grup yang memiliki peringatan.')
            }
            const text = list.map((w, i) => `${i + 1}. @${w.user_id.split('@')[0]} - *${w.warning_count}* peringatan`).join('\n')
            return reply(`⚠️ *Daftar Peringatan Grup:*\n\n${text}`, { mentions: list.map(w => w.user_id) })
        }

        if (subCommand === 'reset') {
            const targetJid = ctx.messageContent?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                || (args[1] ? args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null)

            if (!targetJid) {
                return reply('⚠️ Tag pengguna atau berikan nomor telepon untuk di-reset.')
            }
            await moderatorService.resetWarnings(chatId, targetJid)
            return reply(`✅ Peringatan untuk *@${targetJid.split('@')[0]}* telah di-reset.`, { mentions: [targetJid] })
        }

        return reply('⚠️ Sub-command tidak dikenal. Ketik `!aimod` untuk melihat menu bantuan.')
    }
}
