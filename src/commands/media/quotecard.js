// src/commands/media/quotecard.js
// .quote  — Generate gambar quote aesthetic dari teks yang di-reply
// Pakai Sharp + SVG template (zero extra dependencies)

import sharp from 'sharp'
import { logger } from '../../utils/logger.js'

// ── Palettes ─────────────────────────────────────────────────────────────────
const PALETTES = [
    { bg: '#0f0c29', bg2: '#302b63', text: '#ffffff', accent: '#a78bfa', sub: '#c4b5fd' },  // violet dark
    { bg: '#0d1117', bg2: '#161b22', text: '#e6edf3', accent: '#58a6ff', sub: '#8b949e' },  // github dark
    { bg: '#1a1a2e', bg2: '#16213e', text: '#e0e0e0', accent: '#e94560', sub: '#a0a0b0' },  // navy red
    { bg: '#013220', bg2: '#022c1c', text: '#d4edda', accent: '#28a745', sub: '#8fcca0' },  // forest green
    { bg: '#2d1b69', bg2: '#1a0f3d', text: '#f8f0ff', accent: '#c084fc', sub: '#a78bfa' },  // deep purple
    { bg: '#1c1c1c', bg2: '#2d2d2d', text: '#f5f5f5', accent: '#fbbf24', sub: '#fcd34d' },  // charcoal gold
    { bg: '#0c1445', bg2: '#102060', text: '#e8f4fd', accent: '#60a5fa', sub: '#93c5fd' },  // ocean blue
    { bg: '#2d0a0a', bg2: '#1a0505', text: '#fde8e8', accent: '#f87171', sub: '#fca5a5' },  // crimson dark
]

// ── Text wrapping ─────────────────────────────────────────────────────────────
function wrapText(text, maxCharsPerLine) {
    const words = text.split(' ')
    const lines = []
    let current = ''

    for (const word of words) {
        if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
            current = (current + ' ' + word).trim()
        } else {
            if (current) lines.push(current)
            // Handle very long single words
            if (word.length > maxCharsPerLine) {
                let remaining = word
                while (remaining.length > maxCharsPerLine) {
                    lines.push(remaining.slice(0, maxCharsPerLine - 1) + '-')
                    remaining = remaining.slice(maxCharsPerLine - 1)
                }
                current = remaining
            } else {
                current = word
            }
        }
    }
    if (current) lines.push(current)
    return lines
}

// ── Escape SVG special chars ──────────────────────────────────────────────────
function escSvg(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

// ── Generate SVG ──────────────────────────────────────────────────────────────
function buildSvg(quoteText, senderName, palette, width = 800) {
    const maxChars   = Math.floor(width / 16)   // ~50 chars for 800px
    const lines      = wrapText(quoteText, maxChars)
    const lineHeight = 46
    const fontSize   = 28
    const nameFontSz = 22
    const padding    = 60
    const topExtra   = 80   // space for opening quote mark
    const botExtra   = 80   // space for author + decoration

    const textBlockH = lines.length * lineHeight
    const height     = topExtra + textBlockH + botExtra + padding * 2

    // Build text line elements
    const textLines = lines.map((line, i) => {
        const y = topExtra + padding + i * lineHeight + fontSize
        return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" fill="${palette.text}" opacity="0.95">${escSvg(line)}</text>`
    }).join('\n    ')

    const authorY = topExtra + padding + textBlockH + 40

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${palette.bg};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${palette.bg2};stop-opacity:1" />
    </linearGradient>
    <linearGradient id="acc" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${palette.accent};stop-opacity:0" />
      <stop offset="50%" style="stop-color:${palette.accent};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${palette.accent};stop-opacity:0" />
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bg)" rx="20"/>

  <!-- Corner accents -->
  <rect x="0" y="0" width="4" height="${height}" fill="${palette.accent}" rx="2" opacity="0.6"/>
  <rect x="${width - 4}" y="0" width="4" height="${height}" fill="${palette.accent}" rx="2" opacity="0.6"/>

  <!-- Opening quote mark -->
  <text x="${padding - 10}" y="${topExtra + 10}" font-family="Georgia, serif" font-size="100" fill="${palette.accent}" opacity="0.25" filter="url(#glow)">\u201C</text>

  <!-- Closing quote mark -->
  <text x="${width - padding - 20}" y="${topExtra + padding + textBlockH + 10}" font-family="Georgia, serif" font-size="100" fill="${palette.accent}" opacity="0.25" filter="url(#glow)">\u201D</text>

  <!-- Quote text -->
  ${textLines}

  <!-- Divider line -->
  <rect x="${width / 2 - 80}" y="${authorY - 20}" width="160" height="2" fill="url(#acc)" rx="1"/>

  <!-- Author name -->
  <text x="${width / 2}" y="${authorY + nameFontSz}" text-anchor="middle" font-family="'Helvetica Neue', Arial, sans-serif" font-size="${nameFontSz}" fill="${palette.accent}" font-weight="500" letter-spacing="1">— ${escSvg(senderName)}</text>

  <!-- Subtle top glow -->
  <ellipse cx="${width / 2}" cy="0" rx="${width * 0.4}" ry="60" fill="${palette.accent}" opacity="0.04"/>
</svg>`
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default {
    name: 'quotecard',
    aliases: ['quote', 'qcard', 'kartuquote'],
    category: 'media',
    description: 'Generate gambar quote aesthetic dari teks atau pesan yang di-reply.',
    usage: '.quote [teks] | .quote (reply pesan)',
    example: '.quote Hidup adalah perjalanan | (reply pesan) .quote',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, pushName, messageContent } = ctx

        // ── Ambil teks quote ────────────────────────────────────────────────
        let quoteText = args.join(' ').trim()
        let senderName = pushName || sender.split('@')[0]

        if (!quoteText) {
            // Coba dari quoted message
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const quotedParticipant = messageContent?.extendedTextMessage?.contextInfo?.participant

            const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
            let inner = quotedMsg
            if (quotedMsg) {
                const qType = Object.keys(quotedMsg)[0]
                if (WRAPPERS.includes(qType)) inner = quotedMsg[qType]?.message ?? quotedMsg
            }

            quoteText = inner?.conversation
                ?? inner?.extendedTextMessage?.text
                ?? inner?.imageMessage?.caption
                ?? ''

            // Nama pengirim dari quoted participant
            if (quotedParticipant) {
                const num = quotedParticipant.replace(/:\d+@.*$/, '').replace(/@.*$/, '')
                senderName = `+${num}`
            }
        }

        if (!quoteText) {
            return reply(
                `🖼️ *Quote Card*\n\n` +
                `Buat kartu quote aesthetic dari teks:\n` +
                `- *.quote [teks]* — buat dari teks langsung\n` +
                `- *(reply pesan)* *.quote* — buat dari pesan yang di-reply\n\n` +
                `_Contoh:_ .quote Hidup itu indah kalau kita mau melihatnya`
            )
        }

        // Batas teks
        if (quoteText.length > 400) {
            return reply(`❌ Teks terlalu panjang! Maks 400 karakter (sekarang ${quoteText.length}).`)
        }

        await react('🎨')
        try {
            // Pilih palette acak
            const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)]
            const svg     = buildSvg(quoteText, senderName, palette)
            const buffer  = await sharp(Buffer.from(svg)).png().toBuffer()

            await sock.sendMessage(from, {
                image: buffer,
                caption: `✨ _"${quoteText.slice(0, 80)}${quoteText.length > 80 ? '...' : ''}"_\n— ${senderName}`,
                mimetype: 'image/png'
            }, { quoted: msg })

            await react('✅')
        } catch (err) {
            logger.error('[QuoteCard] Error:', err.message)
            await react('❌')
            await reply(`❌ Gagal membuat quote card: ${err.message}`)
        }
    }
}
