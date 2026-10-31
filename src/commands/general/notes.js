// src/commands/general/notes.js
// !notes — Simpan, kelola, & ambil catatan personal serta dokumen materi kuliah (PDF, DOCX, PPTX, gambar, teks)
// Dilengkapi AI Study Summarizer untuk persiapan UTS/UAS & integrasi Cloud Vault.

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'
import { tgStorage } from '../../services/tgStorage.js'
import { hermesService } from '../../services/hermes.js'
import { isOwner } from '../../utils/permissions.js'

let genAI = null
if (process.env.GEMINI_API_KEY) {
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    } catch (_) {}
}

// ─────────────────────────────────────────────
// DB SETUP & STORAGE DIRECTORY
// ─────────────────────────────────────────────

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const DOCS_DIR = path.resolve('./storage/documents')

if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true })
}

function getDb() {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')

    db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_jid    TEXT    NOT NULL,
            title       TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            file_path   TEXT,
            file_name   TEXT,
            file_size   INTEGER DEFAULT 0,
            mime_type   TEXT,
            tg_file_id  TEXT,
            tag         TEXT    DEFAULT 'general',
            is_public   INTEGER DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_jid, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_public ON notes(is_public, created_at DESC);
    `)

    // Safe migration
    const columns = db.pragma('table_info(notes)').map(col => col.name)
    if (!columns.includes('file_path')) db.exec('ALTER TABLE notes ADD COLUMN file_path TEXT;')
    if (!columns.includes('file_name')) db.exec('ALTER TABLE notes ADD COLUMN file_name TEXT;')
    if (!columns.includes('file_size')) db.exec('ALTER TABLE notes ADD COLUMN file_size INTEGER DEFAULT 0;')
    if (!columns.includes('mime_type')) db.exec('ALTER TABLE notes ADD COLUMN mime_type TEXT;')
    if (!columns.includes('tg_file_id')) db.exec('ALTER TABLE notes ADD COLUMN tg_file_id TEXT;')
    if (!columns.includes('tag')) db.exec("ALTER TABLE notes ADD COLUMN tag TEXT DEFAULT 'general';")
    if (!columns.includes('is_public')) db.exec('ALTER TABLE notes ADD COLUMN is_public INTEGER DEFAULT 0;')

    return db
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function formatDate(unixTs) {
    return new Date(unixTs * 1000).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    })
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = Number(bytes)
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/**
 * Detect MIME type from file buffer magic bytes (file signature).
 * Supports PDF, Office Open XML (DOCX/PPTX/XLSX), images, audio, video, and archives.
 */
function getMimeFromBuffer(buf) {
    if (!buf || buf.length < 8) return null
    const b = buf

    // PDF: %PDF
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'

    // PNG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png'

    // JPEG
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg'

    // GIF
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'

    // WEBP: RIFF....WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'

    // ZIP-based (Office Open XML: DOCX, PPTX, XLSX are all ZIP)
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) {
        // Try to peek content type from ZIP central directory header string
        const str = buf.slice(0, Math.min(buf.length, 512)).toString('latin1')
        if (str.includes('word/')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        if (str.includes('ppt/')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        if (str.includes('xl/')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        return 'application/zip'
    }

    // RAR: Rar!
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'application/x-rar-compressed'

    // 7z: 7z\xBC\xAF\x27\x1C
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return 'application/x-7z-compressed'

    // MP3: ID3 or sync frame
    if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio/mpeg'

    // OGG
    if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'

    // MP4/M4A: ftyp
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4'

    // EPUB: same as ZIP but with epub content
    // (already handled above via ZIP signature)

    return null
}

function getExtensionFromMime(mime = '', defaultExt = 'bin') {
    const m = (mime || '').toLowerCase()
    if (m.includes('pdf')) return 'pdf'
    if (m.includes('wordprocessingml') || m.includes('msword') || m.includes('document')) return 'docx'
    if (m.includes('presentationml') || m.includes('powerpoint')) return 'pptx'
    if (m.includes('spreadsheetml') || m.includes('excel')) return 'xlsx'
    if (m.includes('text/plain') || m.includes('markdown')) return 'txt'
    if (m.includes('text/csv') || m.includes('csv')) return 'csv'
    if (m.includes('json')) return 'json'
    if (m.includes('zip')) return 'zip'
    if (m.includes('rar')) return 'rar'
    if (m.includes('7z')) return '7z'
    if (m.includes('tar') || m.includes('gzip')) return 'tar.gz'
    if (m.includes('epub')) return 'epub'
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
    if (m.includes('png')) return 'png'
    if (m.includes('webp')) return 'webp'
    if (m.includes('mp4')) return 'mp4'
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
    if (m.includes('ogg')) return 'ogg'
    if (m.includes('audio')) return 'mp3'
    if (m.includes('video')) return 'mp4'
    return defaultExt
}

function ensureCorrectMimeType(fileName = '', mimeType = '') {
    const ext = path.extname(fileName || '').toLowerCase()
    let m = (mimeType || '').toLowerCase()

    if (ext === '.pdf' || m.includes('pdf')) return 'application/pdf'
    if (ext === '.docx' || ext === '.doc' || m.includes('word') || m.includes('officedocument.wordprocessingml')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (ext === '.pptx' || ext === '.ppt' || m.includes('powerpoint') || m.includes('presentationml')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    if (ext === '.xlsx' || ext === '.xls' || m.includes('excel') || m.includes('spreadsheetml')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    if (ext === '.txt' && (!m || m === 'application/octet-stream')) return 'text/plain'
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.png') return 'image/png'
    if (ext === '.webp') return 'image/webp'
    if (ext === '.mp3') return 'audio/mpeg'
    if (ext === '.mp4') return 'video/mp4'

    return mimeType || 'application/octet-stream'
}

function getDocBadge(fileName = '', mimeType = '') {
    const ext = path.extname(fileName || '').toLowerCase()
    const mime = (mimeType || '').toLowerCase()

    if (ext === '.pdf' || mime.includes('pdf')) return '📕 [PDF]'
    if (ext === '.doc' || ext === '.docx' || mime.includes('word') || mime.includes('officedocument.wordprocessingml')) return '📘 [DOCX]'
    if (ext === '.ppt' || ext === '.pptx' || mime.includes('powerpoint') || mime.includes('presentationml')) return '📙 [PPTX]'
    if (ext === '.xls' || ext === '.xlsx' || mime.includes('excel') || mime.includes('spreadsheetml')) return '📗 [XLSX]'
    if (ext === '.zip' || ext === '.rar' || ext === '.7z' || ext === '.tar' || ext === '.gz') return '🗜️ [ARCHIVE]'
    if (ext === '.txt' || ext === '.md' || mime.includes('text/plain') || mime.includes('markdown')) return '📝 [TXT]'
    if (ext === '.csv') return '📊 [CSV]'
    if (['.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.html', '.css', '.json', '.php'].includes(ext)) return '💻 [CODE]'
    if (mime.startsWith('image/')) return '🖼️ [IMG]'
    if (mime.startsWith('audio/')) return '🎵 [AUDIO]'
    if (mime.startsWith('video/')) return '🎬 [VIDEO]'
    return '📁 [DOC]'
}

function sanitizeFileName(name) {
    return (name || 'document')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
}

/**
 * Ekstrak lampiran dokumen/media atau teks dari pesan langsung atau pesan yang dibalas (quoted)
 */
async function extractAttachmentAndText(ctx) {
    const { msg, messageContent, from, sock } = ctx

    // 1. Cek lampiran pada pesan saat ini (misal file dikirim dengan caption command)
    const directUnwrapped = unwrapMessage(msg.message || messageContent)
    if (directUnwrapped) {
        for (const mType of ['documentMessage', 'imageMessage', 'videoMessage', 'audioMessage']) {
            if (directUnwrapped[mType]) {
                const info = directUnwrapped[mType]
                const mime = ensureCorrectMimeType(info.fileName || info.title || '', info.mimetype || '')
                const extFromMime = getExtensionFromMime(mime, mType === 'imageMessage' ? 'jpg' : mType === 'audioMessage' ? 'mp3' : mType === 'videoMessage' ? 'mp4' : 'bin')

                let fileName = info.fileName || info.title || null
                if (!fileName) {
                    fileName = `lampiran_${Date.now()}.${extFromMime}`
                } else {
                    const curExt = path.extname(fileName).toLowerCase()
                    if (!curExt || curExt === '.bin' || curExt === '.tmp') {
                        fileName = `${path.basename(fileName, curExt)}.${extFromMime}`
                    }
                }

                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger, reuploadRequest: sock?.updateMediaMessage }
                    )
                    if (buffer) {
                        const sniffedMime = getMimeFromBuffer(buffer)
                        if (sniffedMime) {
                            mime = sniffedMime
                            const properExt = '.' + getExtensionFromMime(sniffedMime)
                            const curExt = path.extname(fileName || '').toLowerCase()
                            if (!curExt || curExt === '.bin' || curExt === '.tmp' || curExt !== properExt) {
                                const base = (fileName && curExt) ? path.basename(fileName, curExt) : (fileName || `lampiran_${Date.now()}`)
                                fileName = `${base}${properExt}`
                            }
                        }
                        return {
                            attachment: { buffer, fileName, mime, size: buffer.length },
                            quotedText: null
                        }
                    }
                } catch (e) {
                    logger.warn('[Notes] Gagal download media langsung:', e.message)
                }
            }
        }
    }

    // 2. Cek pesan yang dibalas (quoted message)
    const firstKey = Object.keys(messageContent || {})[0]
    const contextInfo = messageContent?.[firstKey]?.contextInfo ||
                        messageContent?.extendedTextMessage?.contextInfo
    const quotedRaw = contextInfo?.quotedMessage

    if (quotedRaw) {
        const quotedUnwrapped = unwrapMessage(quotedRaw)
        if (quotedUnwrapped) {
            for (const mType of ['documentMessage', 'imageMessage', 'videoMessage', 'audioMessage']) {
                if (quotedUnwrapped[mType]) {
                    const info = quotedUnwrapped[mType]
                    const mime = ensureCorrectMimeType(info.fileName || info.title || '', info.mimetype || '')
                    const extFromMime = getExtensionFromMime(mime, mType === 'imageMessage' ? 'jpg' : mType === 'audioMessage' ? 'mp3' : mType === 'videoMessage' ? 'mp4' : 'bin')

                    let fileName = info.fileName || info.title || null
                    if (!fileName) {
                        fileName = `lampiran_${Date.now()}.${extFromMime}`
                    } else {
                        const curExt = path.extname(fileName).toLowerCase()
                        if (!curExt || curExt === '.bin' || curExt === '.tmp') {
                            fileName = `${path.basename(fileName, curExt)}.${extFromMime}`
                        }
                    }

                    const stanzaId = contextInfo.stanzaId
                    const participant = contextInfo.participant
                    const targetMsg = {
                        key: {
                            remoteJid: from,
                            id: stanzaId ?? msg.key.id,
                            fromMe: participant ? (participant === sock.user?.id || participant === sock.user?.lid) : false,
                            participant: participant || undefined
                        },
                        message: quotedUnwrapped
                    }

                    try {
                        const buffer = await downloadMediaMessage(
                            targetMsg,
                            'buffer',
                            {},
                            { logger, reuploadRequest: sock?.updateMediaMessage }
                        )
                        if (buffer) {
                            const sniffedMime = getMimeFromBuffer(buffer)
                            if (sniffedMime) {
                                mime = sniffedMime
                                const properExt = '.' + getExtensionFromMime(sniffedMime)
                                const curExt = path.extname(fileName || '').toLowerCase()
                                if (!curExt || curExt === '.bin' || curExt === '.tmp' || curExt !== properExt) {
                                    const base = (fileName && curExt) ? path.basename(fileName, curExt) : (fileName || `lampiran_${Date.now()}`)
                                    fileName = `${base}${properExt}`
                                }
                            }
                            return {
                                attachment: { buffer, fileName, mime, size: buffer.length },
                                quotedText: null
                            }
                        }
                    } catch (e) {
                        logger.warn('[Notes] Gagal download media quoted:', e.message)
                    }
                }
            }
        }

        // Jika tidak ada media, periksa teks kutipan
        const quotedText = quotedRaw?.conversation ||
            quotedRaw?.extendedTextMessage?.text ||
            quotedUnwrapped?.conversation ||
            quotedUnwrapped?.extendedTextMessage?.text ||
            null

        if (quotedText) {
            return { attachment: null, quotedText }
        }
    }

    return { attachment: null, quotedText: null }
}

/**
 * Mengambil buffer file catatan, baik dari disk lokal maupun Telegram Vault fallback
 */
async function getNoteFileBuffer(note) {
    if (note.file_path && fs.existsSync(note.file_path)) {
        try {
            return fs.readFileSync(note.file_path)
        } catch (e) {
            logger.warn(`[Notes] Gagal membaca file lokal ${note.file_path}:`, e.message)
        }
    }

    // Fallback: Restore dari Telegram Vault
    if (note.tg_file_id && tgStorage.isConfigured) {
        try {
            logger.info(`[Notes] Mengunduh ulang file dari Telegram Vault (fileId: ${note.tg_file_id})...`)
            const buf = await tgStorage.getFileBuffer(note.tg_file_id)
            if (buf) {
                try {
                    const targetPath = note.file_path || path.join(DOCS_DIR, `${Date.now()}_${sanitizeFileName(note.file_name)}`)
                    fs.writeFileSync(targetPath, buf)
                } catch (_) {}
                return buf
            }
        } catch (err) {
            logger.error(`[Notes] Gagal restore dari Telegram Vault:`, err.message)
        }
    }

    return null
}

// ─────────────────────────────────────────────
// COMMAND DEFINITION
// ─────────────────────────────────────────────

export default {
    name: 'notes',
    aliases: ['note', 'catatan', 'memo', 'materi', 'doc', 'dokumen', 'kuliah', 'n'],
    category: 'general',
    description: 'Simpan & ambil catatan personal serta dokumen materi kuliah (PDF/DOCX/PPTX) dengan AI Summarizer.',
    usage: '.notes add <judul> | <keterangan> (atau balas file/dokumen) | .notes list | .notes get <id> | .notes ringkas <id>',
    example: '.materi add Kalkulus 2 | Pertemuan Integral Lipat (sambil balas file PDF)',
    cooldown: 2,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['notes', 'catatan', 'memo', 'materi', 'dokumen', 'kuliah', 'pdf', 'summarizer', 'general'],
    params: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Aksi: "add", "list", "get", "ringkas", "search", "edit", "delete"'
            },
            query: {
                type: 'string',
                description: 'Argumen atau judul/keterangan catatan'
            }
        },
        required: []
    },

    async execute(ctx) {
        const { args, reply, react, sender, from, msg, sock, commandName } = ctx
        const db = getDb()
        const cmdAlias = (commandName || 'notes').toLowerCase()

        const sub = args[0]?.toLowerCase()

        // ─── 1. LIST NOTES & MATERI ───────────────────
        if (!sub || sub === 'list' || sub === 'ls') {
            const filter = args[1]?.toLowerCase()
            let query = `SELECT * FROM notes WHERE (user_jid = ? OR is_public = 1)`
            const params = [sender]

            if (filter === 'materi' || filter === 'kuliah') {
                query += ` AND (tag = 'materi' OR tag = 'kuliah')`
            } else if (filter === 'doc' || filter === 'dokumen') {
                query += ` AND file_name IS NOT NULL`
            } else if (filter === 'public' || filter === 'publik') {
                query += ` AND is_public = 1`
            } else if (filter === 'my' || filter === 'pribadi') {
                query += ` AND user_jid = ?`
                params.push(sender)
            }

            query += ` ORDER BY created_at DESC LIMIT 25`
            const notes = db.prepare(query).all(...params)

            if (!notes.length) {
                return reply(
                    `📚 *Belum ada catatan atau dokumen materi tersimpan.*\n\n` +
                    `*Cara Menyimpan:*\n` +
                    `• Balas file PDF/Word/PPT dengan:\n  *!notes add <Judul> | <Keterangan>*\n` +
                    `• Simpan materi kuliah bersama (publik):\n  *!materi add Struktur Data | Pertemuan 1*\n` +
                    `• Simpan catatan teks biasa:\n  *!notes add Ide Projek | Bikin bot cerdas*`
                )
            }

            const listText = notes.map((n, i) => {
                const isOwnerNote = n.user_jid === sender
                const badge = n.file_name ? getDocBadge(n.file_name, n.mime_type) : '📝 [TEXT]'
                const sizeInfo = n.file_size ? ` • ${formatFileSize(n.file_size)}` : ''
                const publicBadge = n.is_public ? ' 🌐' : ''
                const ownerLabel = isOwnerNote ? '' : ' _(Publik)_'
                return `${i + 1}. [#${n.id}] ${badge} *${n.title}*${publicBadge}${ownerLabel}\n   📦 ${n.file_name || 'Catatan Teks'}${sizeInfo} • _${formatDate(n.created_at)}_`
            }).join('\n\n')

            return reply(
                `📚 *DAFTAR CATATAN & DOKUMEN MATERI (${notes.length}):*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${listText}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💡 *Navigasi:*\n` +
                `• Unduh/Ambil: *!notes get <id>*\n` +
                `• Rangkum AI: *!notes ringkas <id>*\n` +
                `• Filter: *!notes list materi* | *!notes list doc*`
            )
        }

        // ─── 2. ADD / SAVE NOTE ATAU DOKUMEN ──────────
        if (['add', 'save', 'simpan', 'upload', 'baru'].includes(sub)) {
            let rawInput = args.slice(1).join(' ').trim()
            const isMateriCmd = ['materi', 'doc', 'dokumen', 'kuliah'].includes(cmdAlias)

            let isPublic = isMateriCmd ? 1 : 0
            let customTag = isMateriCmd ? 'materi' : 'general'

            if (rawInput.includes('--public') || rawInput.includes('#public') || rawInput.includes('--share')) {
                isPublic = 1
                rawInput = rawInput.replace(/--public|#public|--share/gi, '').trim()
            }
            if (rawInput.includes('--materi') || rawInput.includes('#materi')) {
                customTag = 'materi'
                rawInput = rawInput.replace(/--materi|#materi/gi, '').trim()
            }

            const { attachment, quotedText } = await extractAttachmentAndText(ctx)

            if (!rawInput && !attachment && !quotedText) {
                return reply(
                    `❌ *Format Penyimpanan Dokumen / Catatan:*\n\n` +
                    `• *Simpan Dokumen:* Balas/kirim file dengan caption:\n` +
                    `  *!notes add <Judul> | <Keterangan>*\n` +
                    `  _Contoh: !notes add Modul UTS Kimia | Rangkuman rumus bab 1-4_\n\n` +
                    `• *Simpan Materi Kuliah Bersama (Publik):*\n` +
                    `  *!materi add Kalkulus 2 | Pertemuan Integral Lipat*\n\n` +
                    `• *Simpan Catatan Teks Biasa:*\n` +
                    `  *!notes add Jadwal Ujian | Senin 10 Nov jam 08.00*`
                )
            }

            const sepIdx = rawInput.indexOf('|')
            let title = ''
            let content = ''

            if (sepIdx !== -1) {
                title = rawInput.slice(0, sepIdx).trim()
                content = rawInput.slice(sepIdx + 1).trim()
            } else {
                if (attachment) {
                    title = rawInput || attachment.fileName
                    content = quotedText || 'Dokumen materi/catatan tersimpan.'
                } else if (quotedText) {
                    title = rawInput || 'Catatan Kutipan'
                    content = quotedText
                } else {
                    const words = rawInput.split(' ')
                    title = words[0]
                    content = words.length > 1 ? words.slice(1).join(' ') : words[0]
                }
            }

            if (!title) {
                title = attachment?.fileName || 'Catatan Baru'
            }
            if (!content) {
                content = attachment ? `File lampiran: ${attachment.fileName}` : title
            }

            // Cek kuota penyimpanan per user (maks 100 catatan, owner unmetered)
            const isUserOwner = isOwner(sender)
            const count = db.prepare('SELECT COUNT(*) as n FROM notes WHERE user_jid = ?').get(sender)?.n ?? 0
            if (count >= 100 && !isUserOwner) {
                return reply(`⚠️ Catatan kamu sudah mencapai batas maksimal (100 catatan).\nHapus catatan lama dengan: *!notes delete <id>*`)
            }

            let savedFilePath = null
            let savedFileName = null
            let savedFileSize = 0
            let savedMimeType = null
            let tgFileId = null

            if (attachment) {
                if (attachment.size > 50 * 1024 * 1024) {
                    return reply(`❌ File terlalu besar (${formatFileSize(attachment.size)}). Batas maksimal unggahan adalah 50 MB.`)
                }

                await react('⏳')

                // Tentukan nama berkas yang rapi & ber-ekstensi valid
                const sniffedMime = getMimeFromBuffer(attachment.buffer)
                const effectiveMime = sniffedMime || ensureCorrectMimeType(attachment.fileName || '', attachment.mime)
                const extFromMime = getExtensionFromMime(effectiveMime, 'bin')
                let finalFileName = attachment.fileName || 'dokumen'

                if (!attachment.fileName || attachment.fileName.startsWith('lampiran_')) {
                    const cleanTitle = sanitizeFileName(title || 'dokumen')
                    finalFileName = `${cleanTitle}.${extFromMime}`
                } else {
                    const curExt = path.extname(attachment.fileName).toLowerCase()
                    if (!curExt || curExt === '.bin' || curExt === '.tmp' || (extFromMime !== 'bin' && curExt !== `.${extFromMime}`)) {
                        const base = curExt ? path.basename(attachment.fileName, curExt) : attachment.fileName
                        finalFileName = `${base}.${extFromMime}`
                    }
                }

                const safeName = sanitizeFileName(finalFileName)
                const diskName = `${Date.now()}_${safeName}`
                savedFilePath = path.join(DOCS_DIR, diskName)
                savedFileName = finalFileName
                savedFileSize = attachment.size
                savedMimeType = effectiveMime

                try {
                    fs.writeFileSync(savedFilePath, attachment.buffer)
                } catch (writeErr) {
                    logger.error('[Notes] Gagal menulis file ke disk lokal:', writeErr.message)
                    return reply(`❌ Gagal menyimpan berkas ke penyimpanan server: ${writeErr.message}`)
                }

                // Cloud backup ke Telegram Vault bila aktif
                if (tgStorage.isConfigured) {
                    try {
                        const tgRes = await tgStorage.uploadMedia(attachment.buffer, savedFileName, {
                            caption: `[VAULT-DOC] #${title} (${savedFileName})`,
                            mimetype: savedMimeType,
                            type: 'document'
                        })
                        if (tgRes?.fileId) {
                            tgFileId = tgRes.fileId
                        }
                    } catch (tgErr) {
                        logger.warn('[Notes] Telegram Vault backup error (non-fatal):', tgErr.message)
                    }
                }
            }

            const insertStmt = db.prepare(`
                INSERT INTO notes (
                    user_jid, title, content, file_path, file_name, file_size, mime_type, tg_file_id, tag, is_public
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)

            const result = insertStmt.run(
                sender,
                title,
                content,
                savedFilePath,
                savedFileName,
                savedFileSize,
                savedMimeType,
                tgFileId,
                customTag,
                isPublic
            )

            // Trigger background cloud sync ke Hugging Face Dataset
            try {
                const { sessionSync } = await import('../../services/sessionSync.js')
                sessionSync.triggerDebouncedBackup(20000)
            } catch (_) {}

            await react('✅')

            const newId = result.lastInsertRowid
            const badge = savedFileName ? getDocBadge(savedFileName, savedMimeType) : '📝 [TEXT]'
            const fileDetails = savedFileName
                ? `\n📎 *Berkas:* ${savedFileName} (${formatFileSize(savedFileSize)})\n` +
                  `☁️ *Penyimpanan:* Terenkripsi & Terarsip ${tgFileId ? 'di Cloud Vault' : 'di Sistem'}`
                : ''

            const publicNote = isPublic ? '\n🌐 *Status:* Terbuka untuk umum / grup' : ''

            return reply(
                `✅ *Catatan & Materi Berhasil Disimpan!*\n\n` +
                `📌 *[#${newId}] ${badge} ${title}*${publicNote}\n` +
                `📝 ${content}${fileDetails}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💡 *Aksi Cepat:*\n` +
                `• Ambil / Unduh: *!notes get ${newId}*\n` +
                `${savedFileName ? `• Ringkas AI: *!notes ringkas ${newId}*\n` : ''}` +
                `• Hapus: *!notes delete ${newId}*`
            )
        }

        // ─── 3. GET / UNDUH / AMBIL DOKUMEN / CATATAN ─
        if (['get', 'unduh', 'kirim', 'download'].includes(sub)) {
            const id = parseInt(args[1], 10)
            if (!id) return reply(`❌ Berikan ID catatan/materi.\nContoh: *!notes get 3*`)

            const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
            if (!note) return reply(`❌ Catatan/materi #${id} tidak ditemukan.`)

            const isUserOwner = isOwner(sender)
            const canAccess = note.user_jid === sender || note.is_public === 1 || isUserOwner

            if (!canAccess) {
                return reply(`🔒 Catatan #${id} bersifat pribadi milik pengguna lain.`)
            }

            // Jika memiliki lampiran berkas fisik
            if (note.file_name || note.file_path) {
                await react('⏳')
                const fileBuffer = await getNoteFileBuffer(note)

                if (!fileBuffer) {
                    return reply(
                        `⚠️ *Berkas fisik tidak ditemukan di server.*\n\n` +
                        `📌 *[#${note.id}] ${note.title}*\n` +
                        `📝 ${note.content}\n` +
                        `📎 *Nama Berkas:* ${note.file_name || 'Tidak diketahui'}\n\n` +
                        `_Berkas mungkin telah dibersihkan dari penyimpanan lokal dan Cloud Vault sedang tidak tersedia._`
                    )
                }

                let sendFileName = note.file_name || `${note.title || 'dokumen'}`
                let sendMime = ensureCorrectMimeType(sendFileName, note.mime_type || '')

                // Auto-sniff fileBuffer magic bytes to rescue older records stored with generic .bin/octet-stream
                const sniffedMime = getMimeFromBuffer(fileBuffer)
                if (sniffedMime) {
                    sendMime = sniffedMime
                }

                const curExt = path.extname(sendFileName).toLowerCase()
                const properExt = '.' + getExtensionFromMime(sendMime, 'bin')

                // Perbaiki jika nama file yang tersimpan berakhiran .bin, .tmp, tanpa ekstensi, atau tidak cocok dengan tipe aslinya
                if (!curExt || curExt === '.bin' || curExt === '.tmp' || (properExt !== '.bin' && curExt !== properExt)) {
                    const base = path.basename(sendFileName, curExt)
                    const cleanTitle = (note.title || (base.startsWith('lampiran_') ? 'dokumen' : base))
                        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
                        .trim()
                        .replace(/\s+/g, '_')
                    sendFileName = `${cleanTitle || 'dokumen'}${properExt}`

                    // Auto-heal database record jika nama sebelumnya .bin atau tipe MIME kadaluarsa
                    try {
                        db.prepare('UPDATE notes SET file_name = ?, mime_type = ? WHERE id = ?').run(sendFileName, sendMime, note.id)
                        logger.info(`[Notes] Auto-healed note #${note.id}: ${sendFileName} (${sendMime})`)
                    } catch (_) {}
                }

                if (sendFileName.endsWith('.pdf')) {
                    sendMime = 'application/pdf'
                }

                const badge = getDocBadge(sendFileName, sendMime)
                const caption =
                    `📁 ${badge} *${note.title}*\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `${note.content ? `📝 ${note.content}\n\n` : ''}` +
                    `📦 *Ukuran:* ${formatFileSize(note.file_size || fileBuffer.length)}\n` +
                    `📅 *Disimpan:* ${formatDate(note.created_at)}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `_Ketik !notes ringkas ${note.id} untuk rangkuman studi AI materi ini_`

                await sock.sendMessage(from, {
                    document: fileBuffer,
                    fileName: sendFileName,
                    mimetype: sendMime,
                    caption
                }, { quoted: msg })

                await react('✅')
                return
            }

            // Catatan teks biasa
            const publicLabel = note.is_public ? ' 🌐 (Publik)' : ''
            return reply(
                `📌 *[#${note.id}] ${note.title}*${publicLabel}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${note.content}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📅 *Dibuat:* ${formatDate(note.created_at)}\n` +
                `_Edit: !notes edit ${note.id} | konten baru_`
            )
        }

        // ─── 4. RINGKAS / BACA MATERI DENGAN AI ──────
        if (['ringkas', 'summary', 'baca', 'analisis', 'rekap'].includes(sub)) {
            const id = parseInt(args[1], 10)
            if (!id) return reply(`❌ Berikan ID catatan/materi.\nContoh: *!notes ringkas 3*`)

            const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
            if (!note) return reply(`❌ Catatan/materi #${id} tidak ditemukan.`)

            const isUserOwner = isOwner(sender)
            const canAccess = note.user_jid === sender || note.is_public === 1 || isUserOwner

            if (!canAccess) {
                return reply(`🔒 Catatan #${id} bersifat pribadi milik pengguna lain.`)
            }

            await react('⏳')
            const startTime = Date.now()

            let docBuffer = null
            if (note.file_name || note.file_path) {
                docBuffer = await getNoteFileBuffer(note)
            }

            const fileName = (note.file_name || '').toLowerCase()
            const mime = ensureCorrectMimeType(fileName, note.mime_type || '').toLowerCase()
            const ext = path.extname(fileName).toLowerCase()
            const isPdf = mime.includes('pdf') || ext === '.pdf'
            const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(fileName)
            const isTextDoc = mime.startsWith('text/') || /\.(txt|md|csv|json|js|py)$/i.test(fileName)

            let summaryResult = ''

            // Kasus 1: Dokumen PDF via Gemini Document API
            if (isPdf && docBuffer && genAI) {
                try {
                    let model
                    try {
                        model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
                    } catch (_) {
                        model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
                    }

                    const base64Doc = docBuffer.toString('base64')
                    const studyPrompt =
                        `Kamu adalah asisten dosen dan tutor akademik pintar untuk persiapan ujian UTS/UAS.\n` +
                        `Analisis isi dokumen materi kuliah/catatan "${note.title}" ini dan buat ringkasan komprehensif dalam bahasa Indonesia.\n\n` +
                        `Format Jawaban Terstruktur:\n` +
                        `1. 🎯 *Topik Utama & Esensi Materi*\n` +
                        `2. 🔑 *Konsep-Konsep Kunci & Teori Krusial*\n` +
                        `3. 📐 *Rumus / Definisi / Prosedur Penting*\n` +
                        `4. 💡 *Takeaways & Tips Menghadapi Ujian*\n` +
                        `5. ❓ *3 Contoh Pertanyaan Prediksi Ujian beserta Jawabannya Singkat*\n\n` +
                        `Gunakan format WhatsApp markdown rapi dengan bullet points, tanpa kata pembuka basa-basi.`

                    const result = await model.generateContent([
                        {
                            inlineData: {
                                mimeType: 'application/pdf',
                                data: base64Doc
                            }
                        },
                        { text: studyPrompt }
                    ])
                    summaryResult = result.response?.text()?.trim() || ''
                } catch (geminiErr) {
                    logger.error('[Notes] Gemini PDF analysis error:', geminiErr.message)
                }
            }

            // Kasus 2: Gambar Slide / Papan Tulis
            if (!summaryResult && isImage && docBuffer && genAI) {
                try {
                    let model
                    try {
                        model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
                    } catch (_) {
                        model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
                    }

                    const base64Img = docBuffer.toString('base64')
                    const imgPrompt =
                        `Kamu adalah tutor akademik cerdas. Bacalah isi catatan gambar/slide/papan tulis ini secara cermat.\n` +
                        `Transkripsikan isi teks/rumus/bagan, jelaskan konsep intinya, dan buatkan rangkuman terstruktur untuk persiapan belajar/ujian mahasiswa.`

                    const result = await model.generateContent([
                        {
                            inlineData: {
                                mimeType: note.mime_type || 'image/jpeg',
                                data: base64Img
                            }
                        },
                        { text: imgPrompt }
                    ])
                    summaryResult = result.response?.text()?.trim() || ''
                } catch (imgErr) {
                    logger.error('[Notes] Gemini Image analysis error:', imgErr.message)
                }
            }

            // Kasus 3: Dokumen Teks atau Catatan Teks Biasa via Hermes Agent
            if (!summaryResult) {
                let textSource = note.content || ''
                if (isTextDoc && docBuffer) {
                    textSource = docBuffer.toString('utf-8').slice(0, 15000)
                }

                if (textSource.trim().length > 0) {
                    const hermesPrompt =
                        `Judul Materi: "${note.title}"\n\n` +
                        `Isi Materi/Catatan:\n"""\n${textSource}\n"""\n\n` +
                        `Sebagai tutor akademik cerdas, tolong rangkum materi ini dengan rapi, berikan poin-poin penting serta prediksi soal latihan untuk bahan belajar/ujian.`

                    try {
                        const hermesRes = await hermesService.chat({
                            chatId: ctx.chatId,
                            prompt: hermesPrompt,
                            systemPrompt: 'Kamu adalah asisten akademik cerdas. Rangkumlah materi kuliah/catatan secara terstruktur, komprehensif, dan mudah dipahami mahasiswa.'
                        })
                        summaryResult = hermesRes.text?.trim() || ''
                    } catch (hermesErr) {
                        logger.error('[Notes] Hermes summarization error:', hermesErr.message)
                    }
                }
            }

            if (!summaryResult) {
                await react('❌')
                return reply(`❌ Gagal merangkum catatan #${id}. Pastikan format file didukung (PDF, gambar slide, atau teks).`)
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
            await react('✅')

            return reply(
                `🎓 *[STUDY GUIDE & RANGKUMAN: ${note.title.toUpperCase()}]*\n` +
                `⚡ *Diproses dalam:* ${elapsed}s | *ID:* #${note.id}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${summaryResult}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `_Unduh file materi lengkap dengan: !notes get ${note.id}_`
            )
        }

        // ─── 5. EDIT CATATAN ──────────────────────────
        if (sub === 'edit' || sub === 'update') {
            const rawInput = args.slice(1).join(' ')
            const sepIdx = rawInput.indexOf('|')

            if (sepIdx === -1) {
                return reply(`❌ Format: *!notes edit <id> | keterangan baru*`)
            }

            const id = parseInt(rawInput.slice(0, sepIdx).trim(), 10)
            const newContent = rawInput.slice(sepIdx + 1).trim()

            if (!id || !newContent) return reply(`❌ ID atau keterangan baru tidak valid.`)

            const note = db.prepare('SELECT id, user_jid FROM notes WHERE id = ?').get(id)
            if (!note) return reply(`❌ Catatan #${id} tidak ditemukan.`)

            const isUserOwner = isOwner(sender)
            if (note.user_jid !== sender && !isUserOwner) {
                return reply(`🚫 Kamu hanya bisa mengedit catatan milikmu sendiri.`)
            }

            db.prepare(`
                UPDATE notes SET content = ?, updated_at = unixepoch() WHERE id = ?
            `).run(newContent, id)

            await react('✅')
            return reply(`✅ Catatan #${id} berhasil diupdate!`)
        }

        // ─── 6. DELETE / HAPUS CATATAN ────────────────
        if (['delete', 'del', 'hapus', 'rm'].includes(sub)) {
            const id = parseInt(args[1], 10)
            if (!id) return reply(`❌ Berikan ID catatan yang ingin dihapus.\nContoh: *!notes delete 3*`)

            const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
            if (!note) return reply(`❌ Catatan #${id} tidak ditemukan.`)

            const isUserOwner = isOwner(sender)
            if (note.user_jid !== sender && !isUserOwner) {
                return reply(`🚫 Kamu hanya bisa menghapus catatan milikmu sendiri.`)
            }

            // Hapus berkas fisik bila ada di disk
            if (note.file_path && fs.existsSync(note.file_path)) {
                try {
                    fs.unlinkSync(note.file_path)
                } catch (e) {
                    logger.warn(`[Notes] Gagal menghapus berkas fisik ${note.file_path}:`, e.message)
                }
            }

            db.prepare('DELETE FROM notes WHERE id = ?').run(id)

            await react('🗑️')
            return reply(`🗑️ Catatan #${id} *"${note.title}"* berhasil dihapus.`)
        }

        // ─── 7. CLEAR SEMUA CATATAN PRIBADI ──────────
        if (sub === 'clear' || sub === 'reset') {
            const userNotes = db.prepare('SELECT * FROM notes WHERE user_jid = ?').all(sender)
            if (!userNotes.length) return reply(`📝 Catatan kamu sudah kosong.`)

            for (const n of userNotes) {
                if (n.file_path && fs.existsSync(n.file_path)) {
                    try { fs.unlinkSync(n.file_path) } catch (_) {}
                }
            }

            db.prepare('DELETE FROM notes WHERE user_jid = ?').run(sender)
            await react('🗑️')
            return reply(`🗑️ Berhasil menghapus semua *${userNotes.length}* catatan pribadi milikmu.`)
        }

        // ─── 8. SEARCH / CARI CATATAN & MATERI ────────
        if (sub === 'search' || sub === 'cari') {
            const keyword = args.slice(1).join(' ').trim()
            if (!keyword) return reply(`❌ Berikan kata kunci pencarian.\nContoh: *!notes search kalkulus*`)

            const isUserOwner = isOwner(sender)
            const baseWhere = isUserOwner ? '1=1' : '(user_jid = ? OR is_public = 1)'
            const params = isUserOwner ? [] : [sender]

            const query = `
                SELECT * FROM notes
                WHERE ${baseWhere} AND (
                    title LIKE ? OR content LIKE ? OR file_name LIKE ? OR tag LIKE ?
                )
                ORDER BY created_at DESC LIMIT 15
            `
            const term = `%${keyword}%`
            params.push(term, term, term, term)

            const results = db.prepare(query).all(...params)

            if (!results.length) {
                return reply(`🔍 Tidak ada catatan atau dokumen yang cocok dengan kata kunci "*${keyword}*".`)
            }

            const list = results.map(n => {
                const badge = n.file_name ? getDocBadge(n.file_name, n.mime_type) : '📝 [TEXT]'
                const sizeInfo = n.file_size ? ` (${formatFileSize(n.file_size)})` : ''
                return `[#${n.id}] ${badge} *${n.title}*${sizeInfo}\n_${n.content.slice(0, 80)}${n.content.length > 80 ? '...' : ''}_`
            }).join('\n\n')

            return reply(
                `🔍 *HASIL PENCARIAN "${keyword.toUpperCase()}" (${results.length}):*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${list}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `_Gunakan !notes get <id> untuk mengunduh atau membaca._`
            )
        }

        // ─── 9. PANDUAN LENGKAP (HELP FALLBACK) ───────
        return reply(
            `📚 *PANDUAN CATATAN & DOKUMEN MATERI KULIAH*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Simpan dokumen materi kuliah (PDF, Word, PPTX, gambar) atau catatan personal langsung di bot:\n\n` +
            `📌 *1. Menyimpan Berkas / Materi:*\n` +
            `• Balas file PDF/Word/PPT dengan:\n` +
            `  *!notes add <Judul> | <Keterangan>*\n` +
            `• Atau materi bersama (publik):\n` +
            `  *!materi add Struktur Data | Bab Pohon Biner*\n` +
            `• Atau simpan catatan teks biasa:\n` +
            `  *!notes add Ide Projek | Rancang Bot Cerdas*\n\n` +
            `📥 *2. Mengambil & Mengunduh Berkas:*\n` +
            `• *!notes get <id>* atau *!materi get <id>*\n\n` +
            `🎓 *3. Rangkuman & Bedah Materi AI (UTS/UAS Mode):*\n` +
            `• *!notes ringkas <id>* atau *!materi ringkas <id>*\n\n` +
            `📋 *4. Navigasi & Pengelolaan:*\n` +
            `• *!notes list* — Lihat semua catatan & dokumen\n` +
            `• *!notes list materi* — Filter hanya materi kuliah\n` +
            `• *!notes search <kata>* — Cari materi berdasarkan topik\n` +
            `• *!notes edit <id> | teks baru* — Edit keterangan\n` +
            `• *!notes delete <id>* — Hapus dokumen/catatan\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `_Kapasitas hingga 100 catatan per user, berkas fisik terarsip aman._`
        )
    }
}
