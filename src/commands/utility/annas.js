// src/commands/utility/annas.js
// .annas — Search & Download Books from Anna's Archive (Loaded)

import { annasService, extractMd5 } from '../../services/annas.js'

const MIMETYPE_MAP = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    cbr: 'application/x-cbr',
    cbz: 'application/x-cbz',
    azw3: 'application/x-mobipocket-ebook',
    djvu: 'image/vnd.djvu',
    zip: 'application/zip'
}

export default {
    name: 'annas',
    aliases: ['annasarchive', 'annasdl', 'anna', 'book'],
    category: 'utility',
    description: 'Cari dan unduh buku/dokumen dari Anna\'s Archive (PDF/EPUB/MOBI).',
    usage: '.annas <judul_buku / penulis / link_annas / MD5_hash>',
    example: '.annas Clean Code\n.annas https://annas-archive.pm/md5/c20f18c6d46797f7401f7069c9bcf076',
    cooldown: 10,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react } = ctx
        const input = args.join(' ').trim()

        if (!input) {
            return reply(
                `📚 *ANNA'S ARCHIVE DOWNLOADER* 📚\n\n` +
                `Perintah ini memungkinkan kamu mencari & mengunduh buku/literatur dari Anna's Archive.\n\n` +
                `*Cara Pakai:*\n` +
                `• *Pencarian Buku:* .annas <judul / penulis>\n` +
                `• *Unduh Langsung:* .annas <link_annas / md5_hash>\n\n` +
                `*Contoh:*\n` +
                `• .annas Harry Potter\n` +
                `• .annas https://annas-archive.pm/md5/c20f18c6d46797f7401f7069c9bcf076`
            )
        }

        const md5 = extractMd5(input)
        const isUrlOrMd5 = Boolean(md5) || input.toLowerCase().includes('annas-archive')

        if (isUrlOrMd5) {
            // ── DIRECT DOWNLOAD MODE ─────────────────────────
            await react('⏳')
            await reply(`⏳ *[Anna's Archive]* Memproses metadata & link unduhan buku...`)

            try {
                const bookDetails = await annasService.getBookDetails(input)
                const title = bookDetails.title || 'Book'
                const author = bookDetails.author || 'Unknown'
                const format = (bookDetails.format || 'pdf').toLowerCase().trim()
                const sizeStr = bookDetails.size || 'Unknown size'

                if (bookDetails.directUrl) {
                    await reply(`📥 Sedang mengunduh file *${title}* (${format.toUpperCase()} · ${sizeStr})...`)
                    
                    try {
                        const fileData = await annasService.downloadFileBuffer(bookDetails.directUrl)

                        // Max 100MB limit for WhatsApp documents
                        if (fileData.size > 100 * 1024 * 1024) {
                            await react('⚠️')
                            return reply(
                                `⚠️ Ukuran file terlalu besar untuk WhatsApp (*${(fileData.size / (1024 * 1024)).toFixed(1)} MB*).\n\n` +
                                `Silakan unduh secara manual melalui link mirror berikut:\n` +
                                `🔗 ${bookDetails.directUrl}`
                            )
                        }

                        const mime = MIMETYPE_MAP[format] || fileData.contentType || 'application/octet-stream'
                        const safeFileName = `${title.replace(/[/\\?%*:|"<>]/g, '')}.${format || 'pdf'}`

                        await ctx.replyMedia(fileData.buffer, 'document', {
                            mimetype: mime,
                            fileName: safeFileName,
                            caption: `📚 *${title}*\n👤 Penulis: ${author}\n📁 Format: ${format.toUpperCase()}\n⚖️ Ukuran: ${(fileData.size / (1024 * 1024)).toFixed(2)} MB`
                        })

                        return await react('✅')
                    } catch (dlErr) {
                        console.warn(`[AnnasCommand] Stream download failed: ${dlErr.message}`)
                    }
                }

                // Fallback: Show mirror links if direct file stream failed or no direct link
                let mirrorMsg = `📚 *${title}*\n👤 *Penulis:* ${author}\n\n`
                mirrorMsg += `⚠️ *File tidak dapat diunduh otomatis oleh bot.* Silakan unduh melalui link mirror di bawah ini:\n\n`

                if (bookDetails.mirrors && bookDetails.mirrors.length > 0) {
                    bookDetails.mirrors.slice(0, 6).forEach((m, idx) => {
                        mirrorMsg += `• *${m.label}*:\n${m.url}\n\n`
                    })
                } else {
                    mirrorMsg += `🔗 *Detail Page:* ${bookDetails.detailUrl}\n`
                }

                await reply(mirrorMsg)
                await react('ℹ️')
            } catch (err) {
                console.error('[AnnasCommand Error]:', err)
                await react('❌')
                await reply(`❌ *Gagal mengambil detail buku:* ${err.message}`)
            }
        } else {
            // ── SEARCH MODE ──────────────────────────────────
            await react('🔍')

            try {
                const books = await annasService.searchBooks(input, 5)

                if (!books || books.length === 0) {
                    await react('❌')
                    return reply(`❌ Tidak ditemukan buku dengan kata kunci "*${input}*" di Anna's Archive.`)
                }

                let text = `📚 *ANNA'S ARCHIVE SEARCH* 📚\n`
                text += `Hasil pencarian untuk: "*${input}*"\n\n`

                books.forEach((book, index) => {
                    text += `*${index + 1}. ${book.title}*\n`
                    text += `   👤 Penulis: ${book.author}\n`
                    text += `   🌐 Bahasa: ${book.language || '-'}\n`
                    text += `   📁 Format: ${book.format.toUpperCase()} (${book.size || 'N/A'})\n`
                    text += `   📥 *Unduh:* \`.annas ${book.md5}\`\n\n`
                })

                text += `_Ketik \`.annas <MD5_hash>\` atau klik command di atas untuk mengunduh buku._`

                await reply(text)
                await react('✅')
            } catch (err) {
                console.error('[AnnasSearch Error]:', err)
                await react('❌')
                await reply(`❌ *Gagal mencari buku:* ${err.message}`)
            }
        }
    }
}
