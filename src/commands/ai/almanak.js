// src/commands/ai/almanak.js
// .almanak — Renungan & Almanak Harian HKBP
// Powered by Gemini dengan pengetahuan lectionary HKBP + tanggal real-time

import { logger } from '../../utils/logger.js'

// ─── Kalender Gerejawi HKBP ──────────────────────────────────────────────────
// HKBP mengikuti Revised Common Lectionary (RCL) yang disesuaikan dengan
// Kalender Gerejawi Kristen: Advent, Natal, Epifani, Pra-Paskah (Minggu Sengsara),
// Paskah, Pentakosta, Trinitas, dan Masa Biasa (Minggu Setelah Trinitas)
// Tahun gerejawi HKBP (Tahun A, B, C berputar tiap 3 tahun)

const ALMANAC_SYSTEM_PROMPT = `Kamu adalah panduan almanak harian HKBP (Huria Kristen Batak Protestan).

Tugasmu: Berikan informasi almanak harian yang mencakup:
1. **Posisi dalam Kalender Gerejawi** — Nama hari/minggu gerejawi (misal: Minggu ke-3 Setelah Trinitas, Rabu Abu, Kamis Putih, dsb)
2. **Tema Ibadah/Renungan Hari Ini** — Tema yang sesuai dengan kalender gerejawi
3. **Nas Bacaan Harian** — 3-4 bagian:
   - Bacaan Perjanjian Lama (PL)
   - Mazmur (Mzm)
   - Bacaan Surat (Epistola)
   - Bacaan Injil (Evangelium)
4. **Pokok Doa Hari Ini** — 2-3 pokok doa yang relevan dengan tema dan situasi gereja HKBP
5. **Renungan Singkat** — 2-3 kalimat refleksi berdasarkan nas utama

Format respons:
━━━━━━━━━━━━━━━━━━━━
✝️ *ALMANAK HARIAN HKBP*
📅 [Hari, Tanggal Lengkap]
━━━━━━━━━━━━━━━━━━━━

📖 *Kalender Gerejawi:*
[Posisi dalam kalender gerejawi]

🎯 *Tema:*
[Tema ibadah hari ini]

📚 *Nas Bacaan:*
• PL: [Kitab Pasal:Ayat]
• Mzm: [Mazmur Pasal:Ayat]
• Epistola: [Kitab Pasal:Ayat]
• Evangelium: [Kitab Pasal:Ayat]

🙏 *Pokok Doa:*
1. [Pokok doa 1]
2. [Pokok doa 2]
3. [Pokok doa 3]

💡 *Renungan Singkat:*
[Refleksi 2-3 kalimat]

_Selamat beribadah! Syaloom_ 🙏
━━━━━━━━━━━━━━━━━━━━

Gunakan pengetahuan Revised Common Lectionary (RCL) yang juga dipakai HKBP.
Untuk tahun 2025-2026 kita berada di Tahun C (Lukas dominan) untuk Tahun Gerejawi baru mulai Advent 2025.
Sebelum Advent 2025: Tahun B (Markus dominan).
Jika tidak yakin dengan lectionary spesifik, berikan nas yang relevan dan masuk akal secara teologis.
Gunakan referensi Alkitab TB (Terjemahan Baru) Indonesia.`

export default {
    name: 'almanak',
    aliases: ['almanakhkbp', 'renungan', 'hariini', 'ayathari', 'devotion'],
    category: 'ai',
    description: 'Almanak harian HKBP — kalender gerejawi, nas bacaan, pokok doa, dan renungan singkat.',
    usage: '.almanak | .almanak [tanggal]',
    example: '.almanak | .almanak 25 Desember',
    cooldown: 10,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, chatId } = ctx

        await react('📅')

        try {
            const { GoogleGenerativeAI } = await import('@google/generative-ai')
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                systemInstruction: ALMANAC_SYSTEM_PROMPT
            })

            // Tentukan tanggal
            const now = new Date()
            const targetDate = args.length > 0
                ? `${args.join(' ')} ${now.getFullYear()}`
                : null

            const dateStr = now.toLocaleDateString('id-ID', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'Asia/Jakarta'
            })
            const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

            const prompt = targetDate
                ? `Berikan almanak HKBP untuk tanggal: ${targetDate}`
                : `Berikan almanak HKBP untuk hari ini: ${dateStr}, pukul ${timeStr} WIB.`

            const result = await model.generateContent(prompt)
            const text = result.response.text()?.trim()

            if (!text) throw new Error('Respons kosong dari AI')

            await react('✅')
            return reply(text)

        } catch (err) {
            logger.error('[Almanak] Error:', err.message)
            await react('❌')
            return reply(`❌ Gagal mengambil almanak: ${err.message}\n\n_Coba lagi sebentar ya. Syaloom! 🙏_`)
        }
    }
}
