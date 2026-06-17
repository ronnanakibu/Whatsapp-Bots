import axios from 'axios'
import * as cheerio from 'cheerio'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const VN_DIR  = path.resolve('./storage/sounds')

let dbInstance = null
function getDb() {
    if (dbInstance) return dbInstance

    // Pastikan folder database ada
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
    'boom':       'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3'
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ─── Scraper 1: iMyFone Soundboard API ──────────────────────────────────────
async function scrapeImyfone(query) {
    try {
        const res = await axios.get('https://voxbox-voice-ma-api.imyfone.com/magicmic/web/sound-effects', {
            params: { keyword: query, page: 1, pageSize: 5 },
            headers: {
                'User-Agent': UA,
                'product-id': '3000',
                'version': '1.0.0',
                'Referer': 'https://filme.imyfone.com/'
            },
            timeout: 8000
        })
        const list = res.data?.data?.data_list ?? []
        if (list.length > 0 && list[0].resource_url) {
            return { name: list[0].name, url: list[0].resource_url, source: 'imyfone' }
        }
    } catch (err) {
        logger.warn(`[Sound] iMyFone error: ${err.message}`)
    }
    return null
}

// ─── Scraper 2: SoundButtonsWorld API ───────────────────────────────────────
async function scrapeSoundButtonsWorld(query) {
    try {
        const res = await axios.get('https://soundbuttonsworld.com/api/memes/search', {
            params: { page: 0, pageSize: 5, q: query },
            headers: { 'User-Agent': UA },
            timeout: 8000
        })
        const list = res.data?.data ?? []
        if (list.length > 0 && list[0].fileName) {
            return {
                name: list[0].name,
                url: `https://soundbuttonsworld.com/uploads/${list[0].fileName}`,
                source: 'soundbuttonsworld'
            }
        }
    } catch (err) {
        logger.warn(`[Sound] SoundButtonsWorld error: ${err.message}`)
    }
    return null
}

// ─── Scraper 3: MyInstants (fallback) ───────────────────────────────────────
async function scrapeMyInstants(query) {
    try {
        const searchUrl = `https://www.myinstants.com/search/?name=${encodeURIComponent(query)}`
        const response = await axios.get(searchUrl, { headers: { 'User-Agent': UA }, timeout: 10000 })
        const $ = cheerio.load(response.data)
        const results = []
        $('.instant').each((i, el) => {
            const name = $(el).find('.instant-link').text().trim()
            const onClickAttr = $(el).find('.small-button').attr('onclick') || ''
            const match = onClickAttr.match(/play\('([^']+)'/)
            if (match) results.push({ name, url: `https://www.myinstants.com${match[1]}` })
        })
        if (results.length > 0) return { name: results[0].name, url: results[0].url, source: 'myinstants' }
    } catch (err) {
        logger.warn(`[Sound] MyInstants error: ${err.message}`)
    }
    return null
}

export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme — lokal, database, simpan VN, atau cari di 3 sumber online',
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
            const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
                ?? messageContent?.audioMessage
                ?? null
            const quotedKey = messageContent?.extendedTextMessage?.contextInfo

            let audioMsg = null
            let targetMsgForDownload = null

            if (type === 'audioMessage') {
                // Pesan langsung adalah audio
                audioMsg = messageContent.audioMessage
                targetMsgForDownload = msg
            } else if (quotedMsg) {
                // Cari audioMessage di quoted
                const qType = Object.keys(quotedMsg)[0]
                const inner = qType === 'viewOnceMessage' || qType === 'ephemeralMessage'
                    ? quotedMsg[qType]?.message
                    : quotedMsg
                const innerType = inner ? Object.keys(inner)[0] : null
                if (innerType === 'audioMessage') {
                    audioMsg = inner.audioMessage
                    targetMsgForDownload = {
                        key: {
                            remoteJid: from,
                            id: quotedKey?.stanzaId ?? msg.key.id,
                            fromMe: false
                        },
                        message: inner
                    }
                }
            }

            if (!audioMsg) {
                return reply('❌ Reply ke pesan suara/VN dulu, lalu ketik:\n*.sound add <nama>*')
            }

            // Cek apakah keyword sudah ada
            const existingVn  = db.prepare('SELECT keyword FROM sound_vn WHERE keyword = ?').get(keyword)
            const existingUrl = db.prepare('SELECT keyword FROM sound_cache WHERE keyword = ?').get(keyword)
            if (existingVn || existingUrl || MEME_SOUNDS[keyword]) {
                return reply(`❌ Keyword *"${keyword}"* sudah dipakai. Pilih nama lain.`)
            }

            await react('⏳')
            try {
                const buffer = await downloadMediaMessage(targetMsgForDownload, 'buffer', {})
                if (!buffer || buffer.length === 0) throw new Error('Buffer kosong')

                const filePath = path.join(VN_DIR, `${keyword.replace(/[^a-z0-9_-]/g, '_')}_${Date.now()}.ogg`)
                fs.writeFileSync(filePath, buffer)

                db.prepare('INSERT OR REPLACE INTO sound_vn (keyword, file_path, added_by) VALUES (?, ?, ?)').run(keyword, filePath, sender)
                await react('✅')
                return reply(`✅ VN berhasil disimpan sebagai *"${keyword}"*!\nGunakan: *.sound ${keyword}*`)
            } catch (err) {
                logger.error('[Sound] VN add error:', err.message)
                await react('❌')
                return reply('❌ Gagal menyimpan VN. Coba lagi.')
            }
        }

        // ── SUB-COMMAND: del ─────────────────────────────────────────────────
        if (args[0]?.toLowerCase() === 'del' || args[0]?.toLowerCase() === 'delete') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) return reply('❌ Sebutkan keyword yang mau dihapus.\n*Contoh:* .sound del rizz')

            const existing = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(keyword)
            if (!existing) {
                // Coba hapus dari cache juga
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
                `- *.sound del nama* — hapus dari database`
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

        // 4. Scrape online: iMyFone → SoundButtonsWorld → MyInstants
        if (!soundUrl && !isFile) {
            await react('⏳')
            let scraped = null

            scraped = await scrapeImyfone(query)
            if (!scraped) scraped = await scrapeSoundButtonsWorld(query)
            if (!scraped) scraped = await scrapeMyInstants(query)

            if (scraped) {
                soundUrl   = scraped.url
                soundName  = scraped.name
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
            return reply(`❌ Sound *"${query}"* tidak ditemukan di lokal, database, iMyFone, SoundButtonsWorld, maupun MyInstants.`)
        }

        // 6. Kirim ke WA
        await react('⏳')
        try {
            if (isFile) {
                await sock.sendMessage(from, {
                    audio: fileBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                }, { quoted: msg })
            } else {
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
