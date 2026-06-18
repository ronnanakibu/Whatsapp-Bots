// src/commands/ai/nyanyian.js
// .nyanyian [buku] [nomor] — Lirik & info nyanyian rohani
//
// Buku yang didukung:
//   kj  / kidung-jemaat     → Kidung Jemaat (1-478)         via alkitab.mobi
//   pkj / pelengkap         → Pelengkap Kidung Jemaat (1-434) via alkitab.mobi
//   nkb / nyanyikanlah      → Nyanyikanlah Kidung Baru (1-222) via alkitab.mobi
//   be  / buku-ende         → Buku Ende HKBP (1-864)         via Gemini AI
//   kkj / kidung-keesaan    → Kidung Keesaan               via alkitab.mobi

import axios from 'axios'
import * as cheerio from 'cheerio'
import { logger } from '../../utils/logger.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Book config ─────────────────────────────────────────────────────────────
const BOOKS = {
    'kj':  { label: 'Kidung Jemaat',           abbr: 'KJ',  max: 478,  path: 'kj',  source: 'web' },
    'pkj': { label: 'Pelengkap Kidung Jemaat', abbr: 'PKJ', max: 434,  path: 'pkj', source: 'web' },
    'nkb': { label: 'Nyanyikanlah Kidung Baru',abbr: 'NKB', max: 222,  path: 'nkb', source: 'web' },
    'kkj': { label: 'Kidung Keesaan',          abbr: 'KKJ', max: 321,  path: 'kkj', source: 'web' },
    'be':  { label: 'Buku Ende HKBP',          abbr: 'BE',  max: 864,  path: null,  source: 'ai'  },
}

// Aliases
const ALIASES = {
    'kidung-jemaat': 'kj', 'kidungjemaat': 'kj',
    'pelengkap': 'pkj', 'pkjemaat': 'pkj',
    'nkb': 'nkb', 'nyanyikanlah': 'nkb', 'kidung-baru': 'nkb',
    'keesaan': 'kkj', 'kidung-keesaan': 'kkj',
    'buku-ende': 'be', 'bukuende': 'be', 'ende': 'be',
}

// ─── Scrape alkitab.mobi ─────────────────────────────────────────────────────
async function fetchHymnFromWeb(bookPath, number) {
    const url = `https://alkitab.mobi/kidung/${bookPath}/${number}/`
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html' },
            timeout: 10000
        })
        const $ = cheerio.load(res.data)

        // Extract title from page title (format: "KJ 1 - Haleluya, Pujilah")
        const pageTitle = $('title').text().trim()
        const titleMatch = pageTitle.match(/^[A-Z]+\s+\d+\s*[-–]\s*(.+)$/)
        const title = titleMatch ? titleMatch[1].trim() : pageTitle

        // Extract lyrics — all <p> tags that are lyrics content
        const lyricsLines = []
        $('p').each((i, el) => {
            const text = $(el).text().trim()
            // Skip nav/footer/metadata text
            if (
                text.length > 3 &&
                !text.includes('Copyright') &&
                !text.includes('Alkitab') &&
                !text.includes('SABDA') &&
                !text.includes('©') &&
                !text.startsWith('KJ ') &&
                !text.startsWith('PKJ ') &&
                !text.startsWith('NKB ') &&
                !text.startsWith('BE ')
            ) {
                lyricsLines.push(text)
            }
        })

        // Also capture italic text (refrains, etc.)
        $('i, em').each((i, el) => {
            const text = $(el).text().trim()
            if (text.length > 5 && text !== 'Kembali ke Reff.') {
                // Already included via p tag traversal, skip duplicates
            }
        })

        if (!title && lyricsLines.length === 0) {
            return null
        }

        return { title, lyrics: lyricsLines.join('\n'), url }
    } catch (err) {
        logger.warn(`[Nyanyian] Web fetch error for ${bookPath}/${number}:`, err.message)
        return null
    }
}

// ─── Buku Ende via Gemini AI ─────────────────────────────────────────────────
async function fetchBukuEnde(number) {
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: `Kamu adalah ensiklopedia Buku Ende HKBP (Buku Nyanyian Gereja Batak Protestan).
Kamu mengetahui judul dan lirik lagu-lagu dalam Buku Ende.
Ketika diminta nomor lagu, berikan:
1. Judul lagu dalam bahasa Batak Toba
2. Lirik per bait (sebanyak yang kamu ketahui)
3. Terjemahan/arti dalam bahasa Indonesia jika tersedia

Format respons:
🎵 *BE [nomor] — [Judul]*
━━━━━━━━━━━━━━━━━━━━

[Bait 1]
[Refr.: ...]

[Bait 2]
...

📖 *Terjemahan:*
[Arti judul dan ringkasan makna lagu]

Jika tidak yakin dengan lirik spesifik suatu nomor, katakan jujur dan berikan informasi yang kamu ketahui.`
        })

        const result = await model.generateContent(`Berikan lirik Buku Ende nomor ${number}.`)
        const text = result.response.text()?.trim()
        return text ? { lyrics: text, fromAI: true } : null
    } catch (err) {
        logger.error('[Nyanyian] Gemini BE error:', err.message)
        return null
    }
}

// ─── Search hymn by title ─────────────────────────────────────────────────────
async function searchHymnAI(query, bookLabel) {
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

        const result = await model.generateContent(
            `Cari lagu "${query}" dalam buku nyanyian gereja Indonesia (${bookLabel || 'KJ, PKJ, NKB, atau Buku Ende HKBP'}). 
Jika ditemukan, berikan:
- Nomor lagu dan nama buku (contoh: KJ 1, atau BE 100)
- Judul lengkap
- Beberapa baris lirik pertama

Jika tidak yakin, katakan jujur.`
        )
        return result.response.text()?.trim()
    } catch (err) {
        logger.error('[Nyanyian] Search AI error:', err.message)
        return null
    }
}

export default {
    name: 'nyanyian',
    aliases: ['ende', 'kj', 'pkj', 'nkb', 'hymn', 'lagu-gereja', 'lagurohani'],
    category: 'ai',
    description: 'Lirik nyanyian rohani — KJ, PKJ, NKB, Buku Ende HKBP',
    usage: '.nyanyian [buku] [nomor] | .nyanyian cari [judul]',
    example: '.nyanyian kj 1 | .nyanyian be 100 | .nyanyian cari haleluya',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, commandName } = ctx

        // Auto-detect buku dari command alias (e.g. .kj 1 → kj 1)
        let autoBook = null
        if (['kj', 'pkj', 'nkb', 'ende'].includes(commandName)) {
            autoBook = commandName === 'ende' ? 'be' : commandName
        }

        if (args.length === 0) {
            return reply(
                `🎵 *Nyanyian Rohani*\n\n` +
                `*Buku yang tersedia:*\n` +
                `• *KJ* — Kidung Jemaat (1–478)\n` +
                `• *PKJ* — Pelengkap Kidung Jemaat (1–434)\n` +
                `• *NKB* — Nyanyikanlah Kidung Baru (1–222)\n` +
                `• *BE* — Buku Ende HKBP (1–864)\n\n` +
                `*Cara pakai:*\n` +
                `- *.nyanyian kj 1* — lirik KJ nomor 1\n` +
                `- *.nyanyian be 100* — lirik Buku Ende 100\n` +
                `- *.nyanyian cari haleluya* — cari lagu\n` +
                `- *.kj 23* — shortcut langsung\n\n` +
                `_Syaloom! 🙏_`
            )
        }

        // ── Mode: cari ──────────────────────────────────────────────────────
        if (args[0]?.toLowerCase() === 'cari' || args[0]?.toLowerCase() === 'search') {
            const query = args.slice(1).join(' ').trim()
            if (!query) return reply('❌ Sebutkan judul atau kata kunci lagu yang dicari.\n*Contoh:* .nyanyian cari haleluya')

            await react('🔍')
            const result = await searchHymnAI(query, null)
            if (!result) {
                await react('❌')
                return reply(`❌ Gagal mencari lagu "${query}".`)
            }
            await react('✅')
            return reply(`🔍 *Hasil Pencarian: "${query}"*\n\n${result}`)
        }

        // ── Parse: [buku] [nomor] ───────────────────────────────────────────
        let bookKey = autoBook
        let number  = null

        if (autoBook) {
            // .kj 1 → args = ['1']
            number = parseInt(args[0], 10)
        } else {
            // .nyanyian kj 1 → args = ['kj', '1']
            const rawBook = args[0]?.toLowerCase()
            bookKey = ALIASES[rawBook] ?? rawBook
            number  = parseInt(args[1], 10)
        }

        if (!bookKey || !BOOKS[bookKey]) {
            return reply(
                `❌ Buku tidak dikenali: *"${args[0]}"*\n\n` +
                `Gunakan: *kj*, *pkj*, *nkb*, *be*\n` +
                `*Contoh:* _.nyanyian kj 1_`
            )
        }

        const book = BOOKS[bookKey]

        if (!number || isNaN(number) || number < 1) {
            return reply(`❌ Nomor lagu tidak valid.\n*Contoh:* _.nyanyian ${bookKey} 1_`)
        }

        if (number > book.max) {
            return reply(`❌ Nomor ${number} melebihi batas. *${book.abbr}* tersedia nomor 1–${book.max}.`)
        }

        await react('🎵')

        // ── Fetch ───────────────────────────────────────────────────────────
        try {
            if (book.source === 'web') {
                const data = await fetchHymnFromWeb(book.path, number)

                if (!data || (!data.title && !data.lyrics)) {
                    await react('❌')
                    return reply(`❌ Lirik *${book.abbr} ${number}* tidak ditemukan.\nCoba nomor lain atau gunakan *.nyanyian cari [judul]*.`)
                }

                const maxLen = 3500
                let lyricsText = data.lyrics || '_(Lirik tidak tersedia)_'
                if (lyricsText.length > maxLen) {
                    lyricsText = lyricsText.slice(0, maxLen) + '\n\n_...(terpotong)_'
                }

                await react('✅')
                return reply(
                    `🎵 *${book.abbr} ${number} — ${data.title}*\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `${lyricsText}\n\n` +
                    `🔗 _Sumber: ${data.url}_`
                )

            } else {
                // Buku Ende via AI
                const data = await fetchBukuEnde(number)
                if (!data) {
                    await react('❌')
                    return reply(`❌ Gagal mengambil lirik BE ${number}.`)
                }
                await react('✅')
                return reply(data.lyrics)
            }
        } catch (err) {
            logger.error('[Nyanyian] Error:', err.message)
            await react('❌')
            return reply(`❌ Terjadi kesalahan: ${err.message}`)
        }
    }
}
