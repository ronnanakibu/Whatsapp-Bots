// src/commands/utility/translate.js
// .tr [lang] [teks]  atau  reply pesan → .tr [lang]
// Translate gratis pakai Google Translate unofficial API (tidak butuh API key)

import axios from 'axios'
import { logger } from '../../utils/logger.js'

// Map alias bahasa pendek → kode Google Translate
const LANG_ALIASES = {
    // Indonesia
    'id': 'id', 'indo': 'id', 'indonesia': 'id',
    // English
    'en': 'en', 'eng': 'en', 'english': 'en', 'inggris': 'en',
    // Japanese
    'ja': 'ja', 'jp': 'ja', 'jepang': 'ja', 'japanese': 'ja',
    // Korean
    'ko': 'ko', 'kr': 'ko', 'korea': 'ko', 'korean': 'ko',
    // Chinese
    'zh': 'zh', 'cn': 'zh', 'china': 'zh', 'chinese': 'zh', 'mandarin': 'zh',
    // Arabic
    'ar': 'ar', 'arab': 'ar', 'arabic': 'ar',
    // Spanish
    'es': 'es', 'sp': 'es', 'spanish': 'es', 'spanyol': 'es',
    // French
    'fr': 'fr', 'french': 'fr', 'perancis': 'fr',
    // German
    'de': 'de', 'german': 'de', 'jerman': 'de',
    // Russian
    'ru': 'ru', 'rusia': 'ru', 'russian': 'ru',
    // Portuguese
    'pt': 'pt', 'portuguese': 'pt', 'portugis': 'pt',
    // Batak / tidak di Google Translate, fallback ke id
    'batak': 'id',
    // Auto detect (target)
    'auto': 'auto',
}

const LANG_NAMES = {
    'id': '🇮🇩 Indonesia',
    'en': '🇬🇧 English',
    'ja': '🇯🇵 Japanese',
    'ko': '🇰🇷 Korean',
    'zh': '🇨🇳 Chinese',
    'ar': '🇸🇦 Arabic',
    'es': '🇪🇸 Spanish',
    'fr': '🇫🇷 French',
    'de': '🇩🇪 German',
    'ru': '🇷🇺 Russian',
    'pt': '🇵🇹 Portuguese',
    'auto': '🔍 Auto-detect',
}

async function translateText(text, targetLang, sourceLang = 'auto') {
    const url = 'https://translate.googleapis.com/translate_a/single'
    const res = await axios.get(url, {
        params: {
            client: 'gtx',
            sl: sourceLang,
            tl: targetLang,
            dt: 't',
            q: text
        },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
    })

    // Response structure: [ [ ["translated", "original", ...], ...], null, "detected_lang", ...]
    const data = res.data
    const translated = data[0]?.map(chunk => chunk?.[0]).filter(Boolean).join('') ?? ''
    const detectedLang = data[2] ?? sourceLang

    return { translated, detectedLang }
}

export default {
    name: 'translate',
    aliases: ['tr', 'terjemah', 'terjemahkan'],
    category: 'utility',
    description: 'Terjemahkan teks ke bahasa lain.',
    usage: '.tr [bahasa] [teks] | .tr [bahasa] (reply pesan)',
    example: '.tr en Selamat pagi dunia | .tr japan (reply pesan)',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, messageContent } = ctx

        if (args.length === 0) {
            return reply(
                `🌐 *Translate*\n\n` +
                `*Cara pakai:*\n` +
                `- *.tr en* [teks] — terjemah ke Inggris\n` +
                `- *.tr id* [teks] — terjemah ke Indonesia\n` +
                `- *(reply pesan)* *.tr jp* — terjemah ke Jepang\n\n` +
                `*Bahasa tersedia:*\n` +
                `id, en, ja/jp, ko/kr, zh/cn, ar, es, fr, de, ru, pt\n\n` +
                `*Contoh:* _.tr en Aku suka makan nasi goreng_`
            )
        }

        // Parse lang dari arg pertama
        const rawLang = args[0].toLowerCase()
        const targetLang = LANG_ALIASES[rawLang]

        if (!targetLang) {
            return reply(`❌ Bahasa *"${args[0]}"* tidak dikenali.\n\nGunakan: id, en, jp, kr, cn, ar, es, fr, de, ru, pt`)
        }

        // Ambil teks: dari args sisanya, atau dari quoted message
        let textToTranslate = args.slice(1).join(' ').trim()

        if (!textToTranslate) {
            // Coba dari quoted message
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            let inner = quotedMsg
            if (quotedMsg) {
                const qType = Object.keys(quotedMsg)[0]
                if (WRAPPERS.includes(qType)) inner = quotedMsg[qType]?.message ?? quotedMsg
            }

            textToTranslate = inner?.conversation
                ?? inner?.extendedTextMessage?.text
                ?? inner?.imageMessage?.caption
                ?? ''
        }

        if (!textToTranslate) {
            return reply(`⚠️ Kasih teksnya atau reply ke pesan yang mau diterjemahkan.\n*Contoh:* _.tr en Selamat pagi_`)
        }

        if (textToTranslate.length > 3000) {
            return reply(`❌ Teks terlalu panjang! Maks 3000 karakter (sekarang ${textToTranslate.length}).`)
        }

        await react('🌐')
        try {
            const { translated, detectedLang } = await translateText(textToTranslate, targetLang)

            if (!translated || translated === textToTranslate) {
                await react('⚠️')
                return reply(`⚠️ Tidak ada perubahan setelah diterjemahkan. Mungkin teks sudah dalam bahasa ${LANG_NAMES[targetLang] ?? targetLang}.`)
            }

            const fromLabel = LANG_NAMES[detectedLang] ?? detectedLang.toUpperCase()
            const toLabel   = LANG_NAMES[targetLang]   ?? targetLang.toUpperCase()

            await react('✅')
            return reply(
                `🌐 *Terjemahan*\n` +
                `${fromLabel} → ${toLabel}\n\n` +
                `📝 *Asli:*\n${textToTranslate}\n\n` +
                `✨ *Hasil:*\n${translated}`
            )
        } catch (err) {
            logger.error('[Translate] Error:', err.message)
            await react('❌')
            return reply(`❌ Gagal menerjemahkan: ${err.message}`)
        }
    }
}
