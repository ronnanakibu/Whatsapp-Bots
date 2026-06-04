import axios from 'axios'
import { botLogger } from '../../utils/logger.js'

export default {
    name: 'cekhoax',
    aliases: ['turnbackhoax', 'hoax', 'fitnah', 'cekfakta'],
    category: 'utility',
    desc: 'Mencari kebenaran suatu berita di database TurnBackHoax (MAFINDO).',
    use: '<kata kunci berita>',
    
    async execute(ctx) {
        const { sock, msg: m, args, reply } = ctx

        if (!args[0]) {
            return reply('❌ Masukkan kata kunci berita yang ingin dicek!\n\nContoh: *.cekhoax vaksin covid*')
        }

        const query = args.join(' ')
        await reply(`🔍 Sedang mencari fakta tentang *"${query}"* di database TurnBackHoax...`)

        try {
            const apiUrl = `https://turnbackhoax.id/search?q=${encodeURIComponent(query)}`
            const { data } = await axios.get(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WABOT2.0'
                }
            })

            const articles = data?.data || []
            
            if (!articles || articles.length === 0) {
                return reply(`🕵️‍♂️ Tidak ditemukan artikel hoax/fakta dengan kata kunci *"${query}"*.`)
            }

            // Ambil maksimal 3 hasil teratas
            const topResults = articles.slice(0, 3)
            let replyText = `📰 *HASIL CEK FAKTA (TurnBackHoax)* 📰\n\n`

            topResults.forEach((article, i) => {
                const statusIkon = article.status?.toLowerCase().includes('salah') ? '❌' 
                    : article.status?.toLowerCase().includes('benar') ? '✅' 
                    : '⚠️'

                replyText += `${i + 1}. *${article.title || 'Tanpa Judul'}*\n`
                replyText += `   Status: ${statusIkon} *${article.status || 'Tidak diketahui'}*\n`
                replyText += `   Kategori: ${article.classification || article.category || '-'}\n`
                if (article.conclusion) {
                    replyText += `   Kesimpulan: ${article.conclusion}\n`
                }
                
                // Parse dan sertakan sumber verifikasi jika ada
                if (Array.isArray(article.references) && article.references.length > 0) {
                    // Beberapa data API dipisah dengan newline dalam satu string
                    const rawRefs = article.references.flatMap(ref => typeof ref === 'string' ? ref.split(/[\r\n]+/) : ref)
                    const cleanRefs = rawRefs.map(r => r.trim()).filter(Boolean)
                    if (cleanRefs.length > 0) {
                        replyText += `   Referensi Riset:\n`
                        // Tampilkan maksimal 3 sumber agar pesan tidak terlalu panjang
                        cleanRefs.slice(0, 3).forEach(r => replyText += `   - ${r}\n`)
                        if (cleanRefs.length > 3) replyText += `   - _(+${cleanRefs.length - 3} sumber lainnya)_\n`
                    }
                }
                
                replyText += `   Tautan Resmi: https://turnbackhoax.id/artikel/${article.slug}\n\n`
            })

            replyText += `_Sumber: API TurnBackHoax.id / MAFINDO_`
            
            // Coba kirim dengan thumbnail gambar pertama (jika ada)
            if (topResults[0].image) {
                await sock.sendMessage(m.key.remoteJid, {
                    image: { url: topResults[0].image },
                    caption: replyText.trim()
                }, { quoted: m })
            } else {
                await reply(replyText.trim())
            }
            
            botLogger.commandDone('cekhoax', 0)
        } catch (err) {
            botLogger.err('command', err, 'cekhoax')
            reply('❌ Terjadi kesalahan saat menghubungi server TurnBackHoax. Coba lagi nanti.')
        }
    }
}
