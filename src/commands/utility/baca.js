// src/commands/utility/baca.js
// AI Web & Document Reader / Executive Summarizer (TL;DR)

import axios from 'axios'
import * as cheerio from 'cheerio'
import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

/**
 * Extract clean text and title from a web URL
 */
async function fetchCleanWebContent(targetUrl) {
    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024
        })

        const html = response.data
        if (typeof html !== 'string') return null

        const $ = cheerio.load(html)

        // Remove junk elements
        $('script, style, nav, header, footer, aside, noscript, iframe, svg, .ads, .ad, .advertisement, .share, .social-share, .comments, .related-articles, #disqus_thread').remove()

        const title = $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text().trim() ||
            'Artikel Web'

        // Extract paragraphs and main article text
        let articleText = ''
        $('article, main, .article-body, .post-content, .entry-content, .content, p').each((_, el) => {
            const text = $(el).text().trim()
            if (text && text.length > 20) {
                articleText += text + '\n\n'
            }
        })

        if (!articleText.trim()) {
            articleText = $('body').text().replace(/\s+/g, ' ').trim()
        }

        // Limit character length to ~12,000 chars for AI token efficiency
        return {
            title: title.replace(/\s+/g, ' ').trim(),
            content: articleText.slice(0, 12000).trim(),
            url: targetUrl
        }
    } catch (err) {
        logger.warn('[Baca] Error fetching web content:', err.message)
        return null
    }
}

/**
 * Extract document or quoted text
 */
async function extractDocumentData(ctx) {
    const { msg, messageContent, from, sock } = ctx
    const contextInfo = messageContent?.extendedTextMessage?.contextInfo
    const quotedMsg = contextInfo?.quotedMessage
    const unwrappedQuoted = unwrapMessage(quotedMsg)

    if (!unwrappedQuoted) return null

    const t = Object.keys(unwrappedQuoted)[0]
    if (t === 'documentMessage') {
        const mime = unwrappedQuoted.documentMessage?.mimetype || ''
        const fileName = unwrappedQuoted.documentMessage?.fileName || 'Dokumen'
        const stanzaId = contextInfo?.stanzaId
        const participant = contextInfo?.participant

        const targetMsg = {
            key: {
                remoteJid: from,
                id: stanzaId ?? msg.key.id,
                fromMe: participant ? (participant === sock.user?.id || participant === sock.user?.lid) : false,
                participant: participant || undefined
            },
            message: unwrappedQuoted
        }

        const buffer = await downloadMediaMessage(
            targetMsg,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
        )

        return buffer ? { buffer, mime, fileName } : null
    }

    return null
}

export default {
    name: 'baca',
    aliases: ['tldr', 'bacaweb', 'readweb', 'ringkasweb', 'summaryweb'],
    category: 'utility',
    description: 'Baca isi web artikel/berita atau dokumen PDF dan buat ringkasan eksekutif AI',
    usage: '.baca <link web> atau balas dokumen dengan .baca',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, messageContent } = ctx

        // 1. Detect target URL from args or quoted text
        const urlRegex = /(https?:\/\/[^\s]+)/gi
        let rawText = args.join(' ')
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedText = contextInfo?.quotedMessage?.conversation ||
            contextInfo?.quotedMessage?.extendedTextMessage?.text ||
            ''

        const combinedText = `${rawText} ${quotedText}`.trim()
        const urlMatches = combinedText.match(urlRegex)
        const targetUrl = urlMatches ? urlMatches[0] : null

        // 2. Check if quoting a Document (e.g. PDF)
        const docData = await extractDocumentData(ctx)

        if (!targetUrl && !docData && !quotedText) {
            return reply(
                '📄 *PANDUAN AI WEB & DOCUMENT READER*\n\n' +
                'Gunakan perintah ini untuk membaca dan merangkum isi artikel web atau dokumen secara otomatis:\n' +
                '• *Ketik:* `.baca https://news.detik.com/...`\n' +
                '• *Atau balas link / dokumen PDF* dengan `.baca`\n\n' +
                '_Bot akan menganalisis isi konten dan menyajikan ringkasan eksekutif secara rapi._'
            )
        }

        await react('⏳')
        const startTime = Date.now()

        let documentTitle = 'Dokumen'
        let contentToSummarize = ''
        let sourceUrl = targetUrl || ''

        // Process Web URL
        if (targetUrl) {
            const webData = await fetchCleanWebContent(targetUrl)
            if (!webData || !webData.content) {
                await react('❌')
                return reply('❌ Gagal membaca konten web dari URL tersebut. Pastikan tautan dapat diakses publik tanpa login/captcha.')
            }
            documentTitle = webData.title
            contentToSummarize = webData.content
        } else if (docData && genAI) {
            // Process PDF with Gemini
            documentTitle = docData.fileName
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
                const base64Doc = docData.buffer.toString('base64')
                const result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: docData.mime || 'application/pdf',
                            data: base64Doc
                        }
                    },
                    {
                        text: 'Bacalah dokumen ini secara lengkap dan buatlah ringkasan eksekutif terstruktur dalam bahasa Indonesia yang mencakup: 1. Topik Utama, 2. Poin-Poin Kunci & Data Penting, 3. Kesimpulan & Rekomendasi.'
                    }
                ])
                const docSummary = result.response?.text()?.trim()
                if (docSummary) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
                    await react('✅')
                    return reply(
                        `📑 *[EXECUTIVE SUMMARY: ${documentTitle.toUpperCase()}]*\n` +
                        `⚡ *Diproses dalam:* ${elapsed}s (Gemini Intelligence)\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `${docSummary}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `_Powered by Ronn Bot Document Intelligence_`
                    )
                }
            } catch (docErr) {
                logger.error('[Baca] Document processing error:', docErr.message)
            }
        } else if (quotedText) {
            contentToSummarize = quotedText
            documentTitle = 'Teks Kutipan'
        }

        if (!contentToSummarize) {
            await react('❌')
            return reply('❌ Tidak ada teks artikel yang berhasil diekstrak.')
        }

        // Generate AI Summary using Groq or Gemini
        let summaryResult = ''
        const promptInstruction =
            `Kamu adalah seorang analis eksekutif profesional. Bacalah teks artikel berikut dan buat ringkasan eksekutif dalam bahasa Indonesia yang rapi, padat, dan elegan.\n\n` +
            `Format output harus berupa:\n` +
            `📌 *Topik Utama:* (1-2 kalimat ringkas)\n` +
            `📋 *Poin-Poin Kunci:*\n` +
            `• (Poin 1 dengan detail penting)\n` +
            `• (Poin 2 dengan fakta/angka)\n` +
            `• (Poin 3...)\n\n` +
            `💡 *Kesimpulan & Insight:* (1-2 kalimat kesimpulan)\n\n` +
            `Teks Sumber:\n"""\n${contentToSummarize}\n"""`

        try {
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'Kamu adalah analis berita dan dokumen cerdas.' },
                        { role: 'user', content: promptInstruction }
                    ],
                    max_tokens: 800
                })
                summaryResult = response.choices[0]?.message?.content?.trim() || ''
            } else if (genAI) {
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
                const result = await model.generateContent(promptInstruction)
                summaryResult = result.response?.text()?.trim() || ''
            }

            if (!summaryResult) {
                await react('❌')
                return reply('❌ AI gagal menghasilkan ringkasan untuk konten tersebut.')
            }

            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1)

            let finalMessage = `📰 *[EXECUTIVE SUMMARY: ${documentTitle}]*\n`
            if (sourceUrl) {
                try {
                    const host = new URL(sourceUrl).hostname
                    finalMessage += `🌐 *Sumber:* ${host}\n`
                } catch (_) {}
            }
            finalMessage += `⚡ *Waktu Analisis:* ${elapsedSec}s\n`
            finalMessage += `━━━━━━━━━━━━━━━━━━━━\n\n`
            finalMessage += `${summaryResult}\n\n`
            finalMessage += `━━━━━━━━━━━━━━━━━━━━\n`
            finalMessage += `_Powered by Ronn Bot Smart Reader_`

            await react('✅')
            return reply(finalMessage.trim())
        } catch (err) {
            logger.error('[Baca] Error generating AI summary:', err.message)
            await react('❌')
            return reply(`❌ Terjadi kendala saat merangkum: ${err.message}`)
        }
    }
}
