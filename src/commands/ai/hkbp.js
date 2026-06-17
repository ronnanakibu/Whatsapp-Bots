// src/commands/ai/hkbp.js
// .hkbp [pertanyaan] — Teologi Kristen Protestan, khususnya HKBP
// Menggunakan konteks terisolasi agar tidak tercampur dengan AI umum

import { logger } from '../../utils/logger.js'

const HKBP_SYSTEM_PROMPT = `Kamu adalah seorang ahli teologi Kristen Protestan, khususnya dalam tradisi dan ajaran Huria Kristen Batak Protestan (HKBP).

Latar belakangmu:
- Doktor Teologi dengan spesialisasi teologi Reformed/Lutheran Batak
- Fasih dengan Alkitab Terjemahan Baru (TB) dan Terjemahan Sederhana Indonesia (TSI)
- Menguasai liturgi, tata ibadah, dan kalender gerejawi HKBP
- Memahami sejarah HKBP sejak 1861 (misionaris Jerman RMG – Ludwig Ingwer Nommensen)
- Paham dengan Konfesi HKBP, Buku Ende (nyanyian gerejawi Batak), dan Evangelium
- Tahu struktur organisasi HKBP: Ephorus, Sekretaris Jenderal, Distrik, Ressort, Jemaat
- Mengerti budaya Batak Toba dalam konteks iman Kristen (hasipelebeguon, adat, dll)

Topik yang kamu kuasai:
- Ajaran Tritunggal, Kristologi, Soteriologi, Pneumatologi menurut perspektif Reformed-Lutheran
- Katekismus Kecil Martin Luther dalam konteks HKBP
- Pengakuan Iman Nicea, Rasuli, Athanasian
- Tafsiran Alkitab (eksegesis) teks Perjanjian Lama dan Baru
- Sakramen HKBP: Baptisan Kudus dan Perjamuan Kudus (Ekaristi)
- Sidi (Konfirmasi) dalam tradisi HKBP
- Hukum gereja dan konstitusi HKBP
- Pelayanan diakonia dan misi HKBP
- Lagu-lagu pujian dalam Buku Ende dan BE
- Doa dan devosi dalam tradisi HKBP
- Perbandingan dengan denominasi Kristen lain (Katolik, Pentakosta, dll)
- Etika Kristen dan relevansinya dalam kehidupan sehari-hari

Aturan menjawab:
- Jawab dengan penuh kasih, hormat, dan berdasarkan firman Tuhan
- Kutip ayat Alkitab yang relevan (sertakan referensi: misal Yohanes 3:16)
- Jika ada perbedaan pandangan teologis, jelaskan dengan seimbang
- Untuk pertanyaan yang sangat teknis, sarankan untuk berkonsultasi dengan pendeta/pelayan jemaat
- Gunakan bahasa Indonesia yang baik; jika ada istilah Batak yang relevan, jelaskan artinya
- Selalu arahkan ke pertumbuhan iman dan pengenalan akan Yesus Kristus
- Mulai jawaban dengan doa singkat atau salam Kristen jika pertanyaan bersifat spiritual mendalam
- Jangan membuat pernyataan yang kontroversial atau menyinggung denominasi lain secara negatif`

export default {
    name: 'hkbp',
    aliases: ['teologi', 'alkitab', 'firman', 'tanya-hkbp'],
    category: 'ai',
    description: 'Tanya tentang teologi Kristen Protestan & HKBP — Alkitab, liturgi, sejarah gereja, doktrin.',
    usage: '.hkbp [pertanyaan]',
    example: '.hkbp Apa itu baptisan kudus menurut HKBP?',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, chatId, msg, sender, messageContent } = ctx

        // Ambil teks dari args atau dari quoted message
        let question = args.join(' ').trim()

        if (!question) {
            // Coba dari quoted message
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const WRAPPERS  = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            let inner = quotedMsg
            if (quotedMsg) {
                const qType = Object.keys(quotedMsg)[0]
                if (WRAPPERS.includes(qType)) inner = quotedMsg[qType]?.message ?? quotedMsg
            }
            question = inner?.conversation ?? inner?.extendedTextMessage?.text ?? ''
        }

        if (!question) {
            return reply(
                `✝️ *Bot Teologi HKBP*\n\n` +
                `Saya siap membantu menjawab pertanyaan seputar:\n` +
                `• 📖 Alkitab & Tafsiran Firman Tuhan\n` +
                `• ⛪ Doktrin & Teologi HKBP\n` +
                `• 🎵 Liturgi, Buku Ende, Tata Ibadah\n` +
                `• 📜 Sejarah HKBP & Nommensen\n` +
                `• 🙏 Sakramen, Sidi, Doa\n` +
                `• 🌍 Etika Kristen & Kehidupan Sehari-hari\n\n` +
                `*Cara pakai:* _.hkbp [pertanyaanmu]_\n\n` +
                `_Contoh:_\n` +
                `_.hkbp Apa makna baptisan kudus menurut HKBP?_\n` +
                `_.hkbp Siapa Ludwig Ingwer Nommensen?_\n` +
                `_.hkbp Jelaskan Yohanes 3:16_\n\n` +
                `_Syaloom! 🙏_`
            )
        }

        await react('✝️')

        try {
            // Lazy imports (avoid module-load errors when API keys not set)
            const { memoryService } = await import('../../services/memory.js')

            // Gunakan topic isolated agar tidak campur dengan chat umum
            memoryService.setActiveTopic(chatId, 'hkbp')

            // Build messages dengan system prompt HKBP khusus
            const history = memoryService.getHistory(chatId, 'hkbp')

            // Gunakan Gemini untuk kualitas jawaban teologis terbaik
            const { GoogleGenerativeAI } = await import('@google/generative-ai')
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

            const geminiHistory = history.map(h => ({
                role: h.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: h.content }]
            }))

            const now = new Date()
            const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' })

            const chat = model.startChat({
                history: [
                    { role: 'user',  parts: [{ text: HKBP_SYSTEM_PROMPT + `\n\nHari ini: ${dateStr}` }] },
                    { role: 'model', parts: [{ text: 'Syaloom! Saya siap membantu menjawab pertanyaan Anda seputar teologi Kristen Protestan dan HKBP. Semoga jawaban saya dapat memperkaya iman dan pengetahuan Anda. Silakan bertanya!' }] },
                    ...geminiHistory
                ],
                generationConfig: { maxOutputTokens: 1500, temperature: 0.6 }
            })

            const result    = await chat.sendMessage(question)
            const answerRaw = result.response.text()?.trim()
            if (!answerRaw) throw new Error('Empty response from AI')

            // Simpan ke memory dengan topic 'hkbp'
            memoryService.addMessage(chatId, 'user',      question,   'hkbp')
            memoryService.addMessage(chatId, 'assistant', answerRaw,  'hkbp')

            await react('✅')
            return reply(answerRaw)

        } catch (err) {
            logger.error('[HKBP] Error:', err.message)
            await react('❌')
            return reply(`❌ Maaf, terjadi kesalahan saat memproses pertanyaan: ${err.message}\n\n_Coba lagi sebentar ya, Syaloom! 🙏_`)
        }
    }
}
