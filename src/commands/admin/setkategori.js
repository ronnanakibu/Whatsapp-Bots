import { getAutoCategory, setAutoCategory } from '../../services/storySync.js'

export default {
    name: 'setkategori',
    aliases: ['setcategory', 'kategoriauto'],
    category: 'admin',
    description: 'Mengubah kategori default untuk story Instagram yang diarsipkan otomatis.',
    usage: '.setkategori [nama_kategori]',
    example: '.setkategori Praktikum',
    cooldown: 5,
    permissions: ['admin', 'owner'],

    async execute(ctx) {
        const { args, reply, react } = ctx

        if (args.length === 0) {
            const current = getAutoCategory()
            await reply('📁 Kategori otomatis saat ini: **' + current + '**\n\nKetik _.setkategori <nama>_ untuk mengubahnya.')
            return
        }

        const newCategory = args.join(' ').trim()
        
        await react('⏳')

        const success = setAutoCategory(newCategory)
        
        if (success) {
            await react('✅')
            await reply('✅ Berhasil! Kategori default untuk arsip story otomatis selanjutnya telah diubah menjadi: **' + newCategory + '**')
        } else {
            await react('❌')
            await reply('❌ Gagal mengubah kategori. Silakan periksa log sistem.')
        }
    }
}

