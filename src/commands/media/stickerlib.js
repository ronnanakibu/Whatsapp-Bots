// src/commands/media/stickerlib.js
// !lib — Custom sticker library ala sticker.ly
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const STICKERS_DIR = path.resolve('./storage/stickers')

// Ensure local stickers storage folder exists
if (!fs.existsSync(STICKERS_DIR)) {
    fs.mkdirSync(STICKERS_DIR, { recursive: true })
}

function getDb() {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    
    // SQLite Tables schema
    db.exec(`
        CREATE TABLE IF NOT EXISTS sticker_packs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_jid    TEXT    NOT NULL,
            name        TEXT    NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_name_user ON sticker_packs(user_jid, name);

        CREATE TABLE IF NOT EXISTS pack_stickers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pack_id     INTEGER NOT NULL,
            sticker_sha256 TEXT NOT NULL,
            file_path   TEXT    NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY(pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_stickers_pack ON pack_stickers(pack_id);
    `)
    return db
}

export default {
    name: 'lib',
    aliases: ['stickerlib', 'addlib', 'addtolib', 'getlib', 'listlib', 'showlib', 'dellib', 'delsticker'],
    category: 'media',
    description: 'Manajemen library stiker kustom personal (seperti sticker.ly).',
    usage: '.lib add <nama> | .lib addto <nama> (reply stiker) | .lib get <nama> <index> | .lib list | .lib show <nama> | .lib delete <nama> | .lib delsticker <nama> <index>',
    cooldown: 2,
    permissions: ['user'],

    async execute(ctx) {
        const { msg, messageContent, args, reply, react, from, sender, sock } = ctx
        const db = getDb()

        const commandName = ctx.commandName?.toLowerCase()
        let sub = args[0]?.toLowerCase()
        let packArgs = args.slice(1)

        // Map direct commands aliases directly to subcommands
        if (commandName === 'addlib') {
            sub = 'add'
            packArgs = args
        } else if (commandName === 'addtolib') {
            sub = 'addto'
            packArgs = args
        } else if (commandName === 'getlib') {
            sub = 'get'
            packArgs = args
        } else if (commandName === 'listlib') {
            sub = 'list'
            packArgs = args
        } else if (commandName === 'showlib') {
            sub = 'show'
            packArgs = args
        } else if (commandName === 'dellib') {
            sub = 'delete'
            packArgs = args
        } else if (commandName === 'delsticker') {
            sub = 'delsticker'
            packArgs = args
        }

        // ─── 1. Subcommand: add ──────────────────────────
        if (sub === 'add' || sub === 'create' || sub === 'make') {
            const packName = packArgs.join(' ').trim().toLowerCase()
            if (!packName) return reply('❌ Kasih nama library nya, cuy!\nContoh: *.addlib meme*')
            
            if (!/^[a-zA-Z0-9_-]+$/.test(packName)) {
                return reply('❌ Nama library hanya boleh huruf, angka, underscore (_), atau strip (-).')
            }

            try {
                const existing = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (existing) return reply(`❌ Library *"${packName}"* sudah ada.`)

                db.prepare('INSERT INTO sticker_packs (user_jid, name) VALUES (?, ?)').run(sender, packName)
                await react('✅')
                return reply(`✅ Library stiker *"${packName}"* berhasil dibuat!\n\nSimpan stiker ke sini dengan reply stikernya lalu ketik:\n*.addtolib ${packName}*`)
            } catch (err) {
                logger.error(err, '[StickerLib] add error')
                return reply(`❌ Gagal membuat library: ${err.message}`)
            }
        }

        // ─── 2. Subcommand: addto ────────────────────────
        if (sub === 'addto' || sub === 'save') {
            const packName = packArgs.join(' ').trim().toLowerCase()
            if (!packName) return reply('❌ Tentukan nama library target, cuy!\nContoh: *.addtolib meme*')

            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            const unwrappedQuoted = unwrapMessage(quotedMsg)
            const isSticker = !!unwrappedQuoted?.stickerMessage

            if (!isSticker) {
                return reply('⚠️ Harap balas/reply stiker yang ingin disimpan!')
            }

            try {
                const pack = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (!pack) return reply(`❌ Library *"${packName}"* tidak ditemukan. Buat dulu dengan *.addlib ${packName}*`)

                await react('⏳')

                const quotedKey = messageContent?.extendedTextMessage?.contextInfo
                const reconstructedQuotedMsg = {
                    key: {
                        remoteJid: from,
                        id: quotedKey?.stanzaId ?? '',
                        fromMe: quotedKey?.participant === sock.user?.id,
                    },
                    message: unwrappedQuoted,
                }
                const buffer = await downloadMediaMessage(reconstructedQuotedMsg, 'buffer', {}, {
                    logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage
                })

                if (!buffer) throw new Error('Gagal mendownload media stiker.')

                const hash = crypto.createHash('sha256').update(buffer).digest('hex')
                const relativePath = path.join('stickers', `${hash}.webp`)
                const absolutePath = path.join(process.cwd(), 'storage', relativePath)

                if (!fs.existsSync(absolutePath)) {
                    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
                    fs.writeFileSync(absolutePath, buffer)
                }

                const alreadyInPack = db.prepare(`
                    SELECT id FROM pack_stickers WHERE pack_id = ? AND sticker_sha256 = ?
                `).get(pack.id, hash)

                if (alreadyInPack) {
                    await react('✅')
                    return reply(`ℹ️ Stiker ini sudah tersimpan di library *"${packName}"*.`)
                }

                db.prepare(`
                    INSERT INTO pack_stickers (pack_id, sticker_sha256, file_path) VALUES (?, ?, ?)
                `).run(pack.id, hash, relativePath)

                const count = db.prepare('SELECT COUNT(*) as n FROM pack_stickers WHERE pack_id = ?').get(pack.id)?.n ?? 0

                await react('✅')
                return reply(`✅ Stiker berhasil disimpan ke library *"${packName}"* (Index #${count})!`)

            } catch (err) {
                logger.error(err, '[StickerLib] addto error')
                await react('❌')
                return reply(`❌ Gagal menyimpan stiker: ${err.message}`)
            }
        }

        // ─── 3. Subcommand: list ─────────────────────────
        if (sub === 'list' || sub === 'ls') {
            try {
                const packs = db.prepare(`
                    SELECT p.name, COUNT(s.id) as count 
                    FROM sticker_packs p
                    LEFT JOIN pack_stickers s ON p.id = s.pack_id
                    WHERE p.user_jid = ?
                    GROUP BY p.id
                    ORDER BY p.name ASC
                `).all(sender)

                if (!packs.length) {
                    return reply(`📁 *Kamu belum mempunyai library stiker.*\n\nBuat library pertama kamu:\n*.addlib [nama_library]*`)
                }

                const list = packs.map((p, i) => `${i + 1}. *${p.name}* (${p.count} stiker)`).join('\n')
                return reply(`📁 *Library Stiker Kamu:*\n\n${list}\n\n_Panggil stiker: .getlib [nama] [index]_`)
            } catch (err) {
                logger.error(err, '[StickerLib] list error')
                return reply(`❌ Gagal mengambil daftar library: ${err.message}`)
            }
        }

        // ─── 4. Subcommand: show ─────────────────────────
        if (sub === 'show' || sub === 'view') {
            const packName = packArgs.join(' ').trim().toLowerCase()
            if (!packName) return reply('❌ Tentukan nama library, cuy!\nContoh: *.showlib meme*')

            try {
                const pack = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (!pack) return reply(`❌ Library *"${packName}"* tidak ditemukan.`)

                const stickers = db.prepare(`
                    SELECT id, sticker_sha256 FROM pack_stickers 
                    WHERE pack_id = ? 
                    ORDER BY id ASC
                `).all(pack.id)

                if (!stickers.length) {
                    return reply(`📁 Library *"${packName}"* masih kosong.\n\nSimpan stiker dengan reply stikernya lalu ketik:\n*.addtolib ${packName}*`)
                }

                let list = `📁 *Isi Library "${packName}":*\n\n`
                stickers.forEach((s, idx) => {
                    list += `- Index *#${idx + 1}* (SHA: ${s.sticker_sha256.slice(0, 8)})\n`
                })
                list += `\n_Ketik: .getlib ${packName} [index] untuk mengirim stiker_`

                return reply(list)
            } catch (err) {
                logger.error(err, '[StickerLib] show error')
                return reply(`❌ Gagal memuat library: ${err.message}`)
            }
        }

        // ─── 5. Subcommand: get ──────────────────────────
        if (sub === 'get' || sub === 'send') {
            const packName = packArgs[0]?.toLowerCase()
            const index = parseInt(packArgs[1], 10)

            if (!packName) return reply('❌ Tentukan nama library target!\nContoh: *.getlib meme 1*')
            if (isNaN(index) || index <= 0) return reply('❌ Tentukan index stiker (1-based index)!\nContoh: *.getlib meme 1*')

            try {
                const pack = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (!pack) return reply(`❌ Library *"${packName}"* tidak ditemukan.`)

                const stickers = db.prepare(`
                    SELECT file_path FROM pack_stickers 
                    WHERE pack_id = ? 
                    ORDER BY id ASC
                `).all(pack.id)

                if (!stickers.length) return reply(`❌ Library *"${packName}"* kosong.`)
                if (index > stickers.length) return reply(`❌ Index #${index} melebihi jumlah stiker (${stickers.length}).`)

                const targetSticker = stickers[index - 1]
                const absolutePath = path.join(process.cwd(), 'storage', targetSticker.file_path)

                if (!fs.existsSync(absolutePath)) {
                    return reply(`❌ Berkas stiker tidak ditemukan di disk server.`)
                }

                await react('⏳')
                const stickerBuffer = fs.readFileSync(absolutePath)
                
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: getCleanQuoted(msg) })
                await react('✅')

            } catch (err) {
                logger.error(err, '[StickerLib] get error')
                await react('❌')
                return reply(`❌ Gagal mengirim stiker: ${err.message}`)
            }
        }

        // ─── 6. Subcommand: delete ───────────────────────
        if (sub === 'delete' || sub === 'dellib' || sub === 'hapuslib') {
            const packName = packArgs.join(' ').trim().toLowerCase()
            if (!packName) return reply('❌ Tentukan nama library, cuy!\nContoh: *.dellib meme*')

            try {
                const pack = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (!pack) return reply(`❌ Library *"${packName}"* tidak ditemukan.`)

                const stickers = db.prepare('SELECT file_path, sticker_sha256 FROM pack_stickers WHERE pack_id = ?').all(pack.id)

                db.prepare('DELETE FROM sticker_packs WHERE id = ?').run(pack.id)

                // Clean files from disk if no other pack references them
                for (const s of stickers) {
                    const count = db.prepare('SELECT COUNT(*) as n FROM pack_stickers WHERE sticker_sha256 = ?').get(s.sticker_sha256)?.n ?? 0
                    if (count === 0) {
                        const absolutePath = path.join(process.cwd(), 'storage', s.file_path)
                        if (fs.existsSync(absolutePath)) {
                            fs.unlinkSync(absolutePath)
                        }
                    }
                }

                await react('🗑️')
                return reply(`🗑️ Library *"${packName}"* beserta stiker di dalamnya berhasil dihapus.`)
            } catch (err) {
                logger.error(err, '[StickerLib] delete pack error')
                return reply(`❌ Gagal menghapus library: ${err.message}`)
            }
        }

        // ─── 7. Subcommand: delsticker ───────────────────
        if (sub === 'delsticker' || sub === 'remsticker') {
            const packName = packArgs[0]?.toLowerCase()
            const index = parseInt(packArgs[1], 10)

            if (!packName) return reply('❌ Tentukan nama library!\nContoh: *.delsticker meme 1*')
            if (isNaN(index) || index <= 0) return reply('❌ Tentukan index stiker (1-based index)!\nContoh: *.delsticker meme 1*')

            try {
                const pack = db.prepare('SELECT id FROM sticker_packs WHERE user_jid = ? AND name = ?').get(sender, packName)
                if (!pack) return reply(`❌ Library *"${packName}"* tidak ditemukan.`)

                const stickers = db.prepare(`
                    SELECT id, file_path, sticker_sha256 FROM pack_stickers 
                    WHERE pack_id = ? 
                    ORDER BY id ASC
                `).all(pack.id)

                if (!stickers.length) return reply(`❌ Library *"${packName}"* kosong.`)
                if (index > stickers.length) return reply(`❌ Index #${index} melebihi jumlah stiker (${stickers.length}).`)

                const targetSticker = stickers[index - 1]

                db.prepare('DELETE FROM pack_stickers WHERE id = ?').run(targetSticker.id)

                const count = db.prepare('SELECT COUNT(*) as n FROM pack_stickers WHERE sticker_sha256 = ?').get(targetSticker.sticker_sha256)?.n ?? 0
                if (count === 0) {
                    const absolutePath = path.join(process.cwd(), 'storage', targetSticker.file_path)
                    if (fs.existsSync(absolutePath)) {
                        fs.unlinkSync(absolutePath)
                    }
                }

                await react('🗑️')
                return reply(`🗑️ Stiker di index #${index} dari library *"${packName}"* berhasil dihapus.`)

            } catch (err) {
                logger.error(err, '[StickerLib] delsticker error')
                return reply(`❌ Gagal menghapus stiker: ${err.message}`)
            }
        }

        // ─── 8. Fallback / Help text ─────────────────────
        return reply(
            `🗂️ *Manajemen Library Stiker Kustom*\n\n` +
            `• *!addlib [nama]* — Membuat library baru\n` +
            `• *!addtolib [nama]* — Simpan stiker (reply stikernya)\n` +
            `• *!listlib* — List semua library stiker kamu\n` +
            `• *!showlib [nama]* — Lihat daftar stiker di library\n` +
            `• *!getlib [nama] [index]* — Ambil/kirim stiker\n` +
            `• *!delsticker [nama] [index]* — Hapus stiker tertentu\n` +
            `• *!dellib [nama]* — Hapus library kustom\n\n` +
            `💡 _Contoh: .addlib meme -> balas stiker dgn .addtolib meme -> panggil dgn .getlib meme 1_`
        )
    }
}
