// src/commands/ai/cook.js
import { dynamicSkills } from '../../services/dynamicSkills.js'

export default {
    name: 'cook',
    aliases: ['skill', 'dynamicskill', 'bikinfitur', 'racik'],
    category: 'ai',
    description: 'Autonomous Agent: Meracik & menyimpan skrip fungsi baru secara dinamis menggunakan Chef (Qwen 3.8 / NVIDIA / DeepSeek).',
    usage: '.cook [instruksi atau query fitur]',
    example: '.cook tampilkan 5 member yang paling sering kirim pesan di grup',
    cooldown: 5,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['cook', 'skill', 'dynamicskill', 'chef', 'racik', 'autonomous', 'function'],
    params: {
        type: 'object',
        properties: {
            instruksi: {
                type: 'string',
                description: 'Instruksi atau query fitur yang ingin diracik (kosongkan untuk melihat daftar skill)'
            }
        },
        required: []
    },

    async execute(ctx) {
        const { args, reply, react } = ctx
        const query = args.join(' ').trim()

        if (!query) {
            const allSkills = dynamicSkills.getAllSkills()
            let listText = `🍳 *DAFTAR DYNAMIC SKILLS TERSIMPAN (${allSkills.length})*\n\n`
            if (allSkills.length === 0) {
                listText += `_Belum ada skill yang diracik._\n`
            } else {
                allSkills.forEach((s, idx) => {
                    listText += `${idx + 1}. *${s.name}*\n`
                    listText += `   📝 ${s.description}\n`
                    listText += `   🔑 Keywords: ${s.keywords.slice(0, 3).join(', ')}\n`
                    listText += `   📊 Dipakai: ${s.usageCount || 0}x ${s.createdByChef ? `| By: ${s.createdByChef}` : ''}\n\n`
                })
            }
            listText += `💡 *Cara Meracik Skill Baru:*\n*.cook [pertanyaan/fitur yang ingin diracik]*\n_Contoh: .cook berapa lama bot sudah aktif_`
            return reply(listText)
        }

        // 1. Cek apakah sudah ada skill yang cocok di cache
        const cached = dynamicSkills.findMatchingSkill(query)
        if (cached) {
            await react('⚡')
            try {
                const output = await dynamicSkills.executeSkill(cached, ctx)
                return reply(output)
            } catch (err) {
                return reply(`⚠️ Gagal menjalankan skill tersimpan: ${err.message}`)
            }
        }

        // 2. Jika belum ada, panggil Chef Engine (Qwen -> NVIDIA -> DeepSeek)
        await react('👨‍🍳')
        await reply(`🍳 *Chef sedang meracik skrip untuk:* "${query}"...\n_Menggunakan Qwen 3.8 LPU / NVIDIA / DeepSeek..._`)

        try {
            const newSkill = await dynamicSkills.synthesizeSkill(query)
            if (!newSkill) {
                await react('❌')
                return reply(`❌ Chef gagal meracik skrip untuk query tersebut. Coba dengan instruksi yang lebih jelas.`)
            }

            await react('✅')
            // Eksekusi langsung hasil racikan baru
            const output = await dynamicSkills.executeSkill(newSkill, ctx)
            return reply(
                `🎉 *Skill Baru Berhasil Dirancang & Disimpan!*\n` +
                `🏷️ *Nama:* ${newSkill.name}\n` +
                `👨‍🍳 *Chef:* ${newSkill.createdByChef || 'Autonomous AI'}\n` +
                `🔑 *Trigger:* ${newSkill.keywords.join(', ')}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `${output}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `_Skrip ini telah disimpan secara permanen di cache bot. Pertanyaan serupa berikutnya akan dieksekusi instan tanpa token!_`
            )
        } catch (err) {
            await react('❌')
            return reply(`❌ Terjadi error saat mengeksekusi skill baru: ${err.message}`)
        }
    }
}

