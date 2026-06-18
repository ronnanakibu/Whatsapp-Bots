import axios from 'axios'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const VN_DIR  = path.resolve('./storage/sounds')

let dbInstance = null
function getDb() {
    if (dbInstance) return dbInstance

    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(VN_DIR))  fs.mkdirSync(VN_DIR,  { recursive: true })

    dbInstance = new Database(DB_PATH)
    dbInstance.pragma('journal_mode = WAL')
    dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS sound_cache (
            keyword    TEXT PRIMARY KEY,
            sound_name TEXT NOT NULL,
            sound_url  TEXT NOT NULL,
            source     TEXT NOT NULL DEFAULT 'unknown',
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS sound_vn (
            keyword    TEXT PRIMARY KEY,
            file_path  TEXT NOT NULL,
            added_by   TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)
    return dbInstance
}

// ─── Built-in meme sounds ────────────────────────────────────────────────────
const MEME_SOUNDS = {
    'vineboom':   'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh':       'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'crickets':   'https://www.myinstants.com/media/sounds/crickets.mp3',
    'fart':       'https://www.myinstants.com/media/sounds/fart-with-reverb.mp3',
    'sadviolin':  'https://www.myinstants.com/media/sounds/sad-violin.mp3',
    'laugh':      'https://www.myinstants.com/media/sounds/laugh-track.mp3',
    'wow':        'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'spongebob':  'https://www.myinstants.com/media/sounds/spongebob-fail.mp3',
    'nani':       'https://www.myinstants.com/media/sounds/nani_1.mp3',
    'run':        'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
    'bonk':       'https://www.myinstants.com/media/sounds/bonk_XjB1kwG.mp3',
    'emotional':  'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
    'illuminati': 'https://www.myinstants.com/media/sounds/illuminati-confirmed.mp3',
    'windows':    'https://www.myinstants.com/media/sounds/windows-xp-startup.mp3',
    'boom':       'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Source 1 (PRIORITY): MyInstants REST API ────────────────────────────────
// Free, no key, clean JSON, 500k+ sounds
async function searchMyInstants(query) {
    try {
        const res = await axios.get('https://www.myinstants.com/api/v1/instants/', {
            params: { name: query, page: 1, page_size: 5 },
            headers: { 'User-Agent': UA },
            timeout: 10000
        })
        const results = res.data?.results ?? []
        if (results.length > 0 && results[0].sound) {
            return {
                name: results[0].name,
                url: results[0].sound,
                source: 'myinstants'
            }
        }
    } catch (err) {
        logger.warn(`[Sound] MyInstants error: ${err.message}`)
    }
    return null
}


export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme — lokal, database, simpan VN, atau cari di MyInstants',
    usage: '.sound <nama> | .sound add <nama> (reply VN) | .sound del <nama>',
    example: '.sound bruh | .sound add rizz (reply VN)',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, messageContent, type } = ctx
        const db = getDb()

        // ── SUB-COMMAND: add ─────────────────────────────────────────────────
        if (args[0]?.toLowerCase() === 'add') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) return reply('❌ Sebutkan nama/keyword untuk VN ini!\n*Contoh:* .sound add rizz (reply ke VN)')

            // Deteksi audio di quoted message atau pesan langsung
            const contextInfo = messageContent?.extendedTextMessage?.contextInfo
            const quotedMsg   = contextInfo?.quotedMessage ?? null
            const quotedStanzaId = contextInfo?.stanzaId
            const quotedParticipant = contextInfo?.participant

            let audioMsg = null
            let targetMsgForDownload = null

            if (type === 'audioMessage') {
                // Pesan langsung adalah audio/VN
                audioMsg = messageContent?.audioMessage
                targetMsgForDownload = msg
            } else if (quotedMsg) {
                // Cari audioMessage di dalam quoted (handle wrapper types)
                const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
                const qType  = Object.keys(quotedMsg)[0]
                const inner  = WRAPPERS.includes(qType)
                    ? (quotedMsg[qType]?.message ?? quotedMsg)
                    : quotedMsg
                const innerType = Object.keys(inner)[0]

                if (innerType === 'audioMessage') {
                    audioMsg = inner.audioMessage
                    // Bangun message object agar bisa didownload oleh Baileys
                    targetMsgForDownload = {
                        key: {
                            remoteJid: from,
                            id: quotedStanzaId ?? msg.key.id,
                            fromMe: quotedParticipant
                                ? (quotedParticipant === sock.user?.id || quotedParticipant === sock.user?.lid)
                                : false,
                            participant: quotedParticipant || undefined,
                        },
                        message: inner
                    }
                }
            }

            if (!audioMsg) {
                return reply('❌ Reply ke pesan suara/VN dulu, lalu ketik:\n*.sound add <nama>*\n\nAtau kirim VN langsung dengan caption *.sound add <nama>*')
            }

            // Cek apakah keyword sudah ada
            const existingVn  = db.prepare('SELECT keyword FROM sound_vn WHERE keyword = ?').get(keyword)
            const existingUrl = db.prepare('SELECT keyword FROM sound_cache WHERE keyword = ?').get(keyword)
            if (existingVn || existingUrl || MEME_SOUNDS[keyword]) {
                return reply(`❌ Keyword *"${keyword}"* sudah dipakai. Pilih nama lain.`)
            }

            await react('⏳')
            try {
                // Download media menggunakan sock (REQUIRED oleh Baileys untuk private media)
                const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(
                    targetMsgForDownload,
                    'buffer',
                    {},
                    { logger: logger, reuploadRequest: sock.updateMediaMessage }
                )

                if (!buffer || buffer.length === 0) throw new Error('Buffer kosong — media tidak bisa diunduh')

                // Simpan ke disk
                const safeKeyword = keyword.replace(/[^a-z0-9_-]/g, '_')
                const ext = audioMsg.mimetype?.includes('ogg') ? 'ogg' : 'mp3'
                const filePath = path.join(VN_DIR, `${safeKeyword}_${Date.now()}.${ext}`)
                fs.writeFileSync(filePath, buffer)

                db.prepare('INSERT OR REPLACE INTO sound_vn (keyword, file_path, added_by) VALUES (?, ?, ?)')
                    .run(keyword, filePath, sender)

                await react('✅')
                return reply(`✅ VN berhasil disimpan sebagai *"${keyword}"*!\nGunakan: *.sound ${keyword}*`)
            } catch (err) {
                logger.error('[Sound] VN add error:', err.message, err.stack?.split('\n')[1])
                await react('❌')
                return reply(`❌ Gagal menyimpan VN: ${err.message}\n\nPastikan kamu reply ke pesan VN yang valid.`)
            }
        }

        // ── SUB-COMMAND: del ─────────────────────────────────────────────────
        if (args[0]?.toLowerCase() === 'del' || args[0]?.toLowerCase() === 'delete') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) return reply('❌ Sebutkan keyword yang mau dihapus.\n*Contoh:* .sound del rizz')

            const existing = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(keyword)
            if (!existing) {
                const cacheRows = db.prepare('DELETE FROM sound_cache WHERE keyword = ?').run(keyword)
                if (cacheRows.changes > 0) return reply(`🗑️ Sound cache *"${keyword}"* berhasil dihapus.`)
                return reply(`❌ Keyword *"${keyword}"* tidak ditemukan di database.`)
            }

            db.prepare('DELETE FROM sound_vn WHERE keyword = ?').run(keyword)
            try { fs.unlinkSync(existing.file_path) } catch (_) {}
            return reply(`🗑️ VN *"${keyword}"* berhasil dihapus dari database.`)
        }

        // ── LIST (no args) ───────────────────────────────────────────────────
        if (args.length === 0) {
            const available = Object.keys(MEME_SOUNDS).map(s => `- ${s}`).join('\n')

            let cachedList = ''
            let vnList = ''
            try {
                const cachedSounds = db.prepare('SELECT keyword, sound_name, source FROM sound_cache ORDER BY created_at DESC LIMIT 30').all()
                if (cachedSounds.length > 0) {
                    cachedList = '\n\n*🌐 Sound Online (Cached):*\n' +
                        cachedSounds.map(s => `- ${s.keyword} _(${s.sound_name})_ [${s.source}]`).join('\n')
                }

                const vnSounds = db.prepare('SELECT keyword FROM sound_vn ORDER BY created_at DESC LIMIT 20').all()
                if (vnSounds.length > 0) {
                    vnList = '\n\n*🎤 VN Tersimpan:*\n' + vnSounds.map(s => `- ${s.keyword}`).join('\n')
                }
            } catch (err) {
                logger.error('❌ [Sound] DB List Error:', err.message)
            }

            return reply(
                `🔊 *Sound Command*\n\n` +
                `*📦 Sound Lokal:*\n${available}${vnList}${cachedList}\n\n` +
                `*Cara pakai:*\n` +
                `- *.sound bruh* — kirim sound\n` +
                `- *(reply VN)* *.sound add nama* — simpan VN\n` +
                `- *.sound del nama* — hapus dari database\n\n` +
                `*Sumber:* MyInstants API`
            )
        }

        // ── PLAY SOUND ───────────────────────────────────────────────────────
        const query = args.join(' ').toLowerCase().trim()

        // 1. Cek lokal hardcoded
        let soundUrl = MEME_SOUNDS[query]
        let soundName = query
        let sourceLabel = 'lokal'
        let isFile = false
        let fileBuffer = null

        // 2. Cek VN tersimpan di DB
        if (!soundUrl) {
            try {
                const vnRow = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(query)
                if (vnRow && fs.existsSync(vnRow.file_path)) {
                    fileBuffer = fs.readFileSync(vnRow.file_path)
                    soundName = query
                    isFile = true
                    sourceLabel = 'vn-lokal'
                }
            } catch (err) {
                logger.error('❌ [Sound] VN read error:', err.message)
            }
        }

        // 3. Cek URL cache di DB
        if (!soundUrl && !isFile) {
            try {
                const cached = db.prepare('SELECT sound_name, sound_url, source FROM sound_cache WHERE keyword = ?').get(query)
                if (cached) {
                    soundUrl = cached.sound_url
                    soundName = cached.sound_name
                    sourceLabel = cached.source ?? 'cache'
                }
            } catch (err) {
                logger.error('❌ [Sound] DB Read Error:', err.message)
            }
        }

        // 4. Search online: MyInstants
        if (!soundUrl && !isFile) {
            await react('⏳')
            let scraped = null

            scraped = await searchMyInstants(query)

            if (scraped) {
                soundUrl    = scraped.url
                soundName   = scraped.name
                sourceLabel = scraped.source

                // Cache di database
                try {
                    db.prepare('INSERT OR REPLACE INTO sound_cache (keyword, sound_name, sound_url, source) VALUES (?, ?, ?, ?)')
                        .run(query, soundName, soundUrl, sourceLabel)
                    logger.info(`💾 [Sound] Cached: "${query}" -> "${soundName}" [${sourceLabel}]`)
                } catch (dbErr) {
                    logger.error('❌ [Sound] DB Write Error:', dbErr.message)
                }

                await reply(`🔍 *Sound baru:* "${soundName}"\n💾 Disimpan ke cache dari *${sourceLabel}*`)
            }
        }

        // 5. Tidak ditemukan di manapun
        if (!soundUrl && !isFile) {
            await react('❌')
            return reply(`❌ Sound *"${query}"* tidak ditemukan.\n\n_Coba kata kunci lain atau gunakan .sound untuk lihat daftar yang tersedia._`)
        }

        // 6. Kirim ke WA
        await react('⏳')
        try {
            if (isFile) {
                // VN lokal — kirim sebagai PTT (voice note)
                const ext = fileBuffer?.[0] === 0x4F ? 'audio/ogg; codecs=opus' : 'audio/mpeg'
                await sock.sendMessage(from, {
                    audio: fileBuffer,
                    mimetype: ext,
                    ptt: true
                }, { quoted: msg })
            } else {
                // URL online — kirim sebagai audio biasa (bukan PTT)
                await sock.sendMessage(from, {
                    audio: { url: soundUrl },
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg })
            }
            await react('✅')
        } catch (err) {
            logger.error('❌ [Sound] Send Error:', err.message)
            await react('❌')
            await reply('❌ Gagal mengirim sound. Link mungkin sudah mati atau file rusak.')
        }
    }
}
