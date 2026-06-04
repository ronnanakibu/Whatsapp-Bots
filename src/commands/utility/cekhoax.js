import axios from 'axios'
import { botLogger } from '../../utils/logger.js'
import { aiService } from '../../services/ai.js'

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

        let query = args.join(' ')

        // Cerdas: Jika input berupa URL, ekstrak keyword dari path URL-nya
        if (query.startsWith('http://') || query.startsWith('https://')) {
            try {
                const urlObj = new URL(query)
                // Ambil path terakhir atau gabungan path, hapus tanda hubung/slash menjadi spasi
                const pathParts = urlObj.pathname.split('/').filter(p => p.length > 3)
                if (pathParts.length > 0) {
                    let slug = pathParts[pathParts.length - 1]
                    // Bersihkan slug dari strip, garis bawah, dan ekstensi html/php
                    query = slug.replace(/[-_]/g, ' ').replace(/\.(html|php|aspx)$/, '')
                }
            } catch (e) {
                // Ignore jika bukan URL valid
            }
        }

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
            const isFallbackResult = data?.meta?.total_articles > 1000

            if (!articles || articles.length === 0 || isFallbackResult) {
                botLogger(`⚠️ Data spesifik tidak ditemukan di TurnBackHoax. Mengalihkan ke Gemini AI untuk menganalisa fakta dari internet... ⏳`)

                const originalQuery = args.join(' ')
                const prompt = `Sebagai asisten pemeriksa fakta, tolong verifikasi kebenaran informasi atau tautan berita berikut ini dengan mengambil dan menyimpulkan dari berbagai sumber terpercaya di internet:\n\n"${originalQuery}"\n\nBuatlah laporan ringkas dengan struktur:\n1. Status (Fakta / Hoax / Konteks Keliru)\n2. Kesimpulan Singkat\n3. Penjelasan Lengkap\n4. Referensi Web Terpercaya (wajib sertakan link jika ada).`

                try {
                    const aiResponse = await aiService.geminiChat(m.key.remoteJid, prompt)
                    return reply(`🤖 *AI FACT-CHECK (Gemini)* 🤖\n\n${aiResponse.text}\n\n_Catatan: Hasil analisis ini dibuat oleh AI (Google Gemini), tetap verifikasi secara mandiri._`)
                } catch (e) {
                    return reply(`🕵️‍♂️ Tidak ditemukan artikel hoax/fakta dengan kata kunci tersebut di database, dan sistem AI sedang sibuk.`)
                }
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
