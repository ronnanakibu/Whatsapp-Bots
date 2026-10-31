// src/commands/group/groups.js
// Melihat daftar dan jumlah grup WhatsApp yang diikuti bot secara real-time
import { botIntrospection } from '../../services/botIntrospection.js'

export default {
    name: 'groups',
    aliases: ['listgroups', 'listgrup', 'grupbot', 'mygroups', 'botgroups'],
    category: 'group',
    description: 'Melihat daftar dan total grup WhatsApp yang diikuti oleh bot secara real-time.',
    usage: '.groups atau .listgrup [pencarian opsional]',
    example: '.groups atau .listgrup learning',
    permissions: ['user'],
    cooldown: 5,
    requireBotAdmin: false,
    tags: ['groups', 'listgroups', 'listgrup', 'grup', 'botgroups', 'introspection'],
    params: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Filter pencarian nama grup tertentu (opsional)'
            }
        },
        required: []
    },

    execute: async (ctx) => {
        const { sock, reply, react, args } = ctx
        await react('👥')

        try {
            const rawGroups = await botIntrospection.getParticipatingGroups(sock)
            const groupList = Object.values(rawGroups || {})

            if (!groupList.length) {
                return reply('⚠️ Saat ini bot belum mendeteksi keikutsertaan di grup WhatsApp mana pun, atau sesi WhatsApp sedang memuat cache.')
            }

            const searchQuery = args.join(' ').trim().toLowerCase()
            let filtered = groupList

            if (searchQuery) {
                filtered = groupList.filter(g => (g.subject || '').toLowerCase().includes(searchQuery))
            }

            if (!filtered.length) {
                return reply(`⚠️ Tidak ditemukan grup dengan kata kunci *"${searchQuery}"*. Total grup yang diikuti bot: *${groupList.length}* grup.`)
            }

            // Urutkan berdasarkan jumlah member terbanyak
            filtered.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0))

            // Ambil JID bot untuk cek status admin
            const rawUser = sock?.user?.id || ''
            const botNum = rawUser.split(':')[0].replace(/[^0-9]/g, '')
            const botJid = botNum ? `${botNum}@s.whatsapp.net` : ''

            let text = `🌐 *DAFTAR GRUP WHATSAPP RONNBOT*\n`
            text += `📊 Total Grup Diikuti: *${groupList.length}* grup\n`
            if (searchQuery) {
                text += `🔍 Hasil Pencarian: *${filtered.length}* grup cocok\n`
            }
            text += `──────────────────────\n\n`

            const maxDisplay = 30
            const displayList = filtered.slice(0, maxDisplay)

            displayList.forEach((g, idx) => {
                const subject = g.subject || 'Tanpa Judul'
                const memberCount = g.participants?.length || 0
                const isBotAdmin = g.participants?.some(p => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin'))
                const adminBadge = isBotAdmin ? ' 👑 [Admin]' : ''

                text += `${idx + 1}. *${subject}*${adminBadge}\n`
                text += `   👥 Member: ${memberCount} | 🆔: \`${g.id.split('@')[0]}\`\n`
            })

            if (filtered.length > maxDisplay) {
                text += `\n_...dan ${filtered.length - maxDisplay} grup lainnya._`
            }

            text += `\n──────────────────────\n`
            text += `💡 _Ketik \`.rangkum 100 [nama grup]\` untuk merangkum obrolan grup tertentu._`

            await reply(text)
            await react('✅')
        } catch (err) {
            await react('❌')
            return reply(`❌ Gagal mengambil daftar grup: ${err.message}`)
        }
    }
}
