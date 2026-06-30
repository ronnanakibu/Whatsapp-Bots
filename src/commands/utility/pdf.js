import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { exec } from 'child_process'
import util from 'util'
import { PDFDocument } from 'pdf-lib'
import mammoth from 'mammoth'
import { chromium } from '@playwright/test'
import { store } from '../../services/store.js'
import { unwrapMessage } from '../../utils/message.js'

const execPromise = util.promisify(exec)

export default {
    name: 'pdf',
    aliases: ['mergepdf', 'splitpdf', 'img2pdf', 'pdf2img', 'doc2pdf', 'compresspdf', 'pdfhelp'],
    category: 'utility',
    description: 'PDF Utility Suite (merge, split, image to pdf, pdf to image, doc to pdf, compress)',
    usage: '.pdf | .mergepdf | .splitpdf <halaman> | .img2pdf | .pdf2img | .doc2pdf | .compresspdf',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const cmdName = ctx.commandName ? ctx.commandName.toLowerCase() : 'pdf'

        try {
            if (cmdName === 'pdf' || cmdName === 'pdfhelp') {
                return await this.showHelp(ctx)
            }
            if (cmdName === 'mergepdf') {
                return await this.handleMerge(ctx)
            }
            if (cmdName === 'splitpdf') {
                return await this.handleSplit(ctx)
            }
            if (cmdName === 'img2pdf') {
                return await this.handleImg2Pdf(ctx)
            }
            if (cmdName === 'pdf2img') {
                return await this.handlePdf2Img(ctx)
            }
            if (cmdName === 'doc2pdf') {
                return await this.handleDoc2Pdf(ctx)
            }
            if (cmdName === 'compresspdf') {
                return await this.handleCompressPdf(ctx)
            }
        } catch (err) {
            console.error(`❌ [PDF Command Error] (${cmdName}):`, err.message)
            await ctx.react('❌')
            await ctx.reply(`❌ Gagal memproses perintah PDF: ${err.message}`)
        }
    },

    async showHelp(ctx) {
        const helpText = `📄 *PDF UTILITY SUITE* 📄

Berikut adalah sub-command PDF yang dapat kamu gunakan:

1. *Merge PDF*
   Format: *.mergepdf*
   Cara: Kirim minimal 2 file PDF, lalu ketik *.mergepdf*. Bot akan menggabungkannya secara urut.

2. *Split PDF*
   Format: *.splitpdf <halaman/range>*
   Cara: Reply file PDF dengan *.splitpdf 1-3* atau *.splitpdf 1,3,5* atau *.splitpdf 2*.

3. *Image to PDF*
   Format: *.img2pdf*
   Cara: Reply gambar atau kirim beberapa gambar, lalu ketik *.img2pdf* untuk menjadikannya satu PDF.

4. *PDF to Image*
   Format: *.pdf2img*
   Cara: Reply file PDF dengan *.pdf2img*. Bot akan mengirimkan semua halaman PDF tersebut sebagai gambar PNG.

5. *Doc to PDF*
   Format: *.doc2pdf*
   Cara: Reply file dokumen Word (.docx) dengan *.doc2pdf*. Bot akan mengonversinya menjadi PDF.

6. *Compress PDF*
   Format: *.compresspdf*
   Cara: Reply file PDF dengan *.compresspdf*. Bot akan mengoptimasi dan memperkecil ukuran file PDF tersebut.`
        return ctx.reply(helpText)
    },

    async handleMerge(ctx) {
        const chatMessages = store.messages[ctx.from] || []
        const pdfMessages = []

        // Scan chronological history for PDF document messages
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            const m = chatMessages[i]
            const unwrapped = unwrapMessage(m.message)
            if (!unwrapped) continue
            const mType = Object.keys(unwrapped)[0]
            if (mType === 'documentMessage') {
                const mime = unwrapped.documentMessage?.mimetype || ''
                if (mime.toLowerCase() === 'application/pdf') {
                    pdfMessages.push(m)
                }
            }
        }

        // Chronological order (oldest first)
        pdfMessages.reverse()

        if (pdfMessages.length < 2) {
            return ctx.reply('⚠️ Kirim minimal 2 dokumen PDF terlebih dahulu di chat ini, lalu ketik *.mergepdf* untuk menggabungkannya!')
        }

        await ctx.react('⏳')
        await ctx.reply(`⏳ Menemukan ${pdfMessages.length} PDF di riwayat chat. Sedang menggabungkan...`)

        const mergedPdf = await PDFDocument.create()
        for (const pdfMsg of pdfMessages) {
            const buf = await ctx.downloadMedia(pdfMsg)
            if (!buf) throw new Error('Gagal mendownload salah satu file PDF dari riwayat chat')
            const pdf = await PDFDocument.load(buf)
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
            copiedPages.forEach((page) => mergedPdf.addPage(page))
        }

        const mergedPdfBytes = await mergedPdf.save()
        await ctx.replyMedia(Buffer.from(mergedPdfBytes), 'document', {
            mimetype: 'application/pdf',
            fileName: 'merged.pdf'
        })
        await ctx.react('✅')
    },

    async handleSplit(ctx) {
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)
        
        let pdfMsg = null
        let quotedKey = null

        if (unwrappedQuoted && Object.keys(unwrappedQuoted)[0] === 'documentMessage') {
            const mime = unwrappedQuoted.documentMessage?.mimetype || ''
            if (mime.toLowerCase() === 'application/pdf') {
                pdfMsg = unwrappedQuoted
                quotedKey = {
                    key: {
                        remoteJid: ctx.from,
                        id: contextInfo.stanzaId,
                        fromMe: contextInfo.participant === ctx.sock.user?.id,
                        participant: contextInfo.participant
                    },
                    message: quotedMsg
                }
            }
        }

        if (!pdfMsg) {
            return ctx.reply('⚠️ Harap reply ke dokumen PDF yang ingin Anda pecah!\n*Contoh:* .splitpdf 1-3')
        }

        const rangeStr = ctx.args.join('').trim()
        if (!rangeStr) {
            return ctx.reply('⚠️ Tentukan halaman atau range yang ingin dipecah!\n*Contoh:* .splitpdf 1-3 atau .splitpdf 1,3,5')
        }

        await ctx.react('⏳')
        const buf = await ctx.downloadMedia(quotedKey)
        if (!buf) throw new Error('Gagal mengunduh file PDF')

        const pdf = await PDFDocument.load(buf)
        const totalPages = pdf.getPageCount()

        // Parse range string (e.g. 1-3, 5)
        const pagesToExtract = new Set()
        const parts = rangeStr.split(',')
        for (const part of parts) {
            if (part.includes('-')) {
                const [startStr, endStr] = part.split('-')
                const start = parseInt(startStr, 10)
                const end = parseInt(endStr, 10)
                if (!isNaN(start) && !isNaN(end)) {
                    const min = Math.min(start, end)
                    const max = Math.max(start, end)
                    for (let p = min; p <= max; p++) {
                        if (p >= 1 && p <= totalPages) pagesToExtract.add(p - 1)
                    }
                }
            } else {
                const p = parseInt(part, 10)
                if (!isNaN(p) && p >= 1 && p <= totalPages) {
                    pagesToExtract.add(p - 1)
                }
            }
        }

        const pageIndices = Array.from(pagesToExtract).sort((a, b) => a - b)
        if (pageIndices.length === 0) {
            return ctx.reply(`⚠️ Halaman tidak valid atau di luar jangkauan (Total halaman dokumen ini: ${totalPages})`)
        }

        const newPdf = await PDFDocument.create()
        const copiedPages = await newPdf.copyPages(pdf, pageIndices)
        copiedPages.forEach(page => newPdf.addPage(page))

        const newPdfBytes = await newPdf.save()
        await ctx.replyMedia(Buffer.from(newPdfBytes), 'document', {
            mimetype: 'application/pdf',
            fileName: `split_${rangeStr.replace(/[^0-9,-]/g, '_')}.pdf`
        })
        await ctx.react('✅')
    },

    async handleImg2Pdf(ctx) {
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        let imageMessages = []

        if (unwrappedQuoted && Object.keys(unwrappedQuoted)[0] === 'imageMessage') {
            imageMessages.push({
                key: {
                    remoteJid: ctx.from,
                    id: contextInfo.stanzaId,
                    fromMe: contextInfo.participant === ctx.sock.user?.id,
                    participant: contextInfo.participant
                },
                message: quotedMsg
            })
        } else {
            // Find images in recent chat history (last 20 messages)
            const chatMessages = store.messages[ctx.from] || []
            for (let i = chatMessages.length - 1; i >= 0; i--) {
                const m = chatMessages[i]
                const unwrapped = unwrapMessage(m.message)
                if (!unwrapped) continue
                const mType = Object.keys(unwrapped)[0]
                if (mType === 'imageMessage') {
                    imageMessages.push(m)
                }
            }
            // Reverse to process in chronological order (oldest first)
            imageMessages.reverse()
        }

        if (imageMessages.length === 0) {
            return ctx.reply('⚠️ Reply ke gambar atau kirim beberapa gambar terlebih dahulu di chat ini, lalu ketik *.img2pdf*!')
        }

        await ctx.react('⏳')
        await ctx.reply(`⏳ Menemukan ${imageMessages.length} gambar. Sedang mengonversi ke PDF...`)

        const pdfDoc = await PDFDocument.create()

        for (const imgMsg of imageMessages) {
            const buf = await ctx.downloadMedia(imgMsg)
            if (!buf) continue

            // Embed image based on signature
            let img
            try {
                if (buf[0] === 0xFF && buf[1] === 0xD8) {
                    img = await pdfDoc.embedJpg(buf)
                } else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
                    img = await pdfDoc.embedPng(buf)
                } else {
                    // Try PNG fallback or sharp conversion to JPG
                    const sharp = (await import('sharp')).default
                    const jpegBuf = await sharp(buf).jpeg().toBuffer()
                    img = await pdfDoc.embedJpg(jpegBuf)
                }

                const page = pdfDoc.addPage([img.width, img.height])
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
            } catch (err) {
                console.error('Failed to embed image:', err.message)
            }
        }

        const pdfBytes = await pdfDoc.save()
        await ctx.replyMedia(Buffer.from(pdfBytes), 'document', {
            mimetype: 'application/pdf',
            fileName: 'images.pdf'
        })
        await ctx.react('✅')
    },

    async handlePdf2Img(ctx) {
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        let pdfMsg = null
        let quotedKey = null

        if (unwrappedQuoted && Object.keys(unwrappedQuoted)[0] === 'documentMessage') {
            const mime = unwrappedQuoted.documentMessage?.mimetype || ''
            if (mime.toLowerCase() === 'application/pdf') {
                pdfMsg = unwrappedQuoted
                quotedKey = {
                    key: {
                        remoteJid: ctx.from,
                        id: contextInfo.stanzaId,
                        fromMe: contextInfo.participant === ctx.sock.user?.id,
                        participant: contextInfo.participant
                    },
                    message: quotedMsg
                }
            }
        }

        if (!pdfMsg) {
            return ctx.reply('⚠️ Harap reply ke dokumen PDF yang ingin Anda jadikan gambar!')
        }

        await ctx.react('⏳')
        const buf = await ctx.downloadMedia(quotedKey)
        if (!buf) throw new Error('Gagal mengunduh file PDF')

        const id = crypto.randomBytes(4).toString('hex')
        const tmpDir = path.resolve('./storage/media/tmp', id)
        fs.mkdirSync(tmpDir, { recursive: true })

        const pdfPath = path.join(tmpDir, 'input.pdf')
        fs.writeFileSync(pdfPath, buf)

        // Write python script to extract pages
        const pyScriptPath = path.join(tmpDir, 'extract.py')
        const pyCode = `
import fitz
import sys
import os

pdf_path = sys.argv[1]
output_dir = sys.argv[2]

doc = fitz.open(pdf_path)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=150)
    pix.save(os.path.join(output_dir, f"page_{i+1}.png"))
`
        fs.writeFileSync(pyScriptPath, pyCode.trim(), 'utf8')

        try {
            const pythonCmd = process.env.PYTHON_CMD || 'python'
            await execPromise(`"${pythonCmd}" "${pyScriptPath}" "${pdfPath}" "${tmpDir}"`)

            // Read the extracted pages
            const files = fs.readdirSync(tmpDir)
                .filter(f => f.startsWith('page_') && f.endsWith('.png'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/\d+/)[0], 10)
                    const numB = parseInt(b.match(/\d+/)[0], 10)
                    return numA - numB
                })

            if (files.length === 0) {
                throw new Error('Tidak ada halaman yang berhasil diekstrak')
            }

            await ctx.reply(`📸 Mengirimkan ${files.length} halaman PDF sebagai gambar...`)
            for (const file of files) {
                const imgPath = path.join(tmpDir, file)
                const imgBuf = fs.readFileSync(imgPath)
                await ctx.replyMedia(imgBuf, 'image', { caption: file })
            }
            await ctx.react('✅')
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    },

    async handleDoc2Pdf(ctx) {
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        let docMsg = null
        let quotedKey = null

        if (unwrappedQuoted && Object.keys(unwrappedQuoted)[0] === 'documentMessage') {
            const mime = unwrappedQuoted.documentMessage?.mimetype || ''
            const fileName = unwrappedQuoted.documentMessage?.fileName || ''
            if (
                mime.includes('word') || 
                mime.includes('officedocument.wordprocessingml') || 
                fileName.endsWith('.docx')
            ) {
                docMsg = unwrappedQuoted
                quotedKey = {
                    key: {
                        remoteJid: ctx.from,
                        id: contextInfo.stanzaId,
                        fromMe: contextInfo.participant === ctx.sock.user?.id,
                        participant: contextInfo.participant
                    },
                    message: quotedMsg
                }
            }
        }

        if (!docMsg) {
            return ctx.reply('⚠️ Harap reply ke dokumen Word (.docx) yang ingin dikonversi ke PDF!')
        }

        await ctx.react('⏳')
        const buf = await ctx.downloadMedia(quotedKey)
        if (!buf) throw new Error('Gagal mengunduh file dokumen')

        const result = await mammoth.convertToHtml({ buffer: buf })
        const html = result.value

        const browser = await chromium.launch({ headless: true })
        try {
            const page = await browser.newPage()
            await page.setContent(html)
            const pdfBuffer = await page.pdf({
                format: 'A4',
                margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
            })

            const cleanFileName = (docMsg.documentMessage?.fileName || 'document.docx')
                .replace(/\.[^/.]+$/, '')
            
            await ctx.replyMedia(Buffer.from(pdfBuffer), 'document', {
                mimetype: 'application/pdf',
                fileName: `${cleanFileName}.pdf`
            })
            await ctx.react('✅')
        } finally {
            await browser.close()
        }
    },

    async handleCompressPdf(ctx) {
        const contextInfo = ctx.messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        let pdfMsg = null
        let quotedKey = null

        if (unwrappedQuoted && Object.keys(unwrappedQuoted)[0] === 'documentMessage') {
            const mime = unwrappedQuoted.documentMessage?.mimetype || ''
            if (mime.toLowerCase() === 'application/pdf') {
                pdfMsg = unwrappedQuoted
                quotedKey = {
                    key: {
                        remoteJid: ctx.from,
                        id: contextInfo.stanzaId,
                        fromMe: contextInfo.participant === ctx.sock.user?.id,
                        participant: contextInfo.participant
                    },
                    message: quotedMsg
                }
            }
        }

        if (!pdfMsg) {
            return ctx.reply('⚠️ Harap reply ke dokumen PDF yang ingin Anda kompres!')
        }

        await ctx.react('⏳')
        const buf = await ctx.downloadMedia(quotedKey)
        if (!buf) throw new Error('Gagal mengunduh file PDF')

        const id = crypto.randomBytes(4).toString('hex')
        const tmpDir = path.resolve('./storage/media/tmp', id)
        fs.mkdirSync(tmpDir, { recursive: true })

        const inputPath = path.join(tmpDir, 'input.pdf')
        const outputPath = path.join(tmpDir, 'compressed.pdf')
        fs.writeFileSync(inputPath, buf)

        // Write python script to compress PDF
        const pyScriptPath = path.join(tmpDir, 'compress.py')
        const pyCode = `
import fitz
import sys

input_path = sys.argv[1]
output_path = sys.argv[2]

doc = fitz.open(input_path)
# Save optimized
doc.save(output_path, garbage=4, deflate=True, clean=True)
`
        fs.writeFileSync(pyScriptPath, pyCode.trim(), 'utf8')

        try {
            const pythonCmd = process.env.PYTHON_CMD || 'python'
            await execPromise(`"${pythonCmd}" "${pyScriptPath}" "${inputPath}" "${outputPath}"`)

            const compBuf = fs.readFileSync(outputPath)
            
            const origSize = (buf.length / 1024 / 1024).toFixed(2)
            const compSize = (compBuf.length / 1024 / 1024).toFixed(2)
            const pct = Math.round((1 - compBuf.length / buf.length) * 100)

            const cleanFileName = (pdfMsg.documentMessage?.fileName || 'document.pdf')
                .replace(/\.[^/.]+$/, '')

            await ctx.replyMedia(compBuf, 'document', {
                mimetype: 'application/pdf',
                fileName: `${cleanFileName}_compressed.pdf`
            })
            await ctx.reply(`📉 *Kompresi Selesai!*\nUkuran Asli: *${origSize} MB*\nUkuran Kompresi: *${compSize} MB*\nHemat: *${pct}%*`)
            await ctx.react('✅')
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    }
}
