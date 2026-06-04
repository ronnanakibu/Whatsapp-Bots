import axios from 'axios'
import * as cheerio from 'cheerio'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')

let dbInstance = null
function getDb() {
    if (dbInstance) return dbInstance

    // Pastikan folder database ada
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    dbInstance = new Database(DB_PATH)
    dbInstance.pragma('journal_mode = WAL')
    dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS sound_cache (
            keyword    TEXT PRIMARY KEY,
            sound_name TEXT NOT NULL,
            sound_url  TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)
    return dbInstance
}

const MEME_SOUNDS = {
    'vineboom': 'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh': 'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'crickets': 'https://www.myinstants.com/media/sounds/crickets.mp3',
    'fart': 'https://www.myinstants.com/media/sounds/fart-with-reverb.mp3',
    'sadviolin': 'https://www.myinstants.com/media/sounds/sad-violin.mp3',
    'laugh': 'https://www.myinstants.com/media/sounds/laugh-track.mp3',
    'wow': 'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'spongebob': 'https://www.myinstants.com/media/sounds/spongebob-fail.mp3',
    'nani': 'https://www.myinstants.com/media/sounds/nani_1.mp3',
    'run': 'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
    'bonk': 'https://www.myinstants.com/media/sounds/bonk_XjB1kwG.mp3',
    'emotional': 'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
    'illuminati': 'https://www.myinstants.com/media/sounds/illuminati-confirmed.mp3',
    'windows': 'https://www.myinstants.com/media/sounds/windows-xp-startup.mp3',
    'boom': 'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3'
}

export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme (lokal, database, atau cari di MyInstants)',
    usage: '.sound <nama_sound/kata kunci>',
    example: '.sound vineboom atau .sound bing chilling',
    cooldown: 3,
    permissions: ['user'],
    async execute(ctx) {
        const { args, reply, react, sock, from, msg } = ctx
        const db = getDb()

        if (args.length === 0) {
            const available = Object.keys(MEME_SOUNDS).map(s => `- ${s}`).join('\n')
            
            // Ambil daftar kata kunci tambahan dari database cache
            let cachedList = ''
            try {
                const cachedSounds = db.prepare('SELECT keyword, sound_name FROM sound_cache ORDER BY created_at DESC LIMIT 50').all()
                if (cachedSounds.length > 0) {
                    cachedList = '\n\n*Sound Tambahan (Database):*\n' + 
                        cachedSounds.map(s => `- ${s.keyword} _(${s.sound_name})_`).join('\n')
                }
            } catch (err) {
                logger.error('❌ [Sound] DB List Error:', err.message)
            }

            return reply(
                `⚠️ Sebutkan nama/kata kunci sound-nya!\n\n` +
                `*Sound Lokal Tersedia:*\n${available}${cachedList}\n\n` +
                `*Contoh:* .sound bruh atau .sound bing chilling`
            )
        }

        const query = args.join(' ').toLowerCase().trim()
        let soundUrl = MEME_SOUNDS[query]
        let soundName = query
        let isFromDb = false
        let isFromScraper = false

        // 1. Cek di daftar lokal first
        if (!soundUrl) {
            // 2. Cek di database cache
            try {
                const cached = db.prepare('SELECT sound_name, sound_url FROM sound_cache WHERE keyword = ?').get(query)
                if (cached) {
                    soundUrl = cached.sound_url
                    soundName = cached.sound_name
                    isFromDb = true
                }
            } catch (err) {
                logger.error('❌ [Sound] DB Read Error:', err.message)
            }
        }

        // 3. Jika tidak ada di lokal maupun database cache, baru scraping ke MyInstants
        if (!soundUrl) {
            await react('⏳')
            try {
                const searchUrl = `https://www.myinstants.com/search/?name=${encodeURIComponent(query)}`
                const response = await axios.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 WABOT2.0'
                    }
                })
                const $ = cheerio.load(response.data)
                const results = []

                $('.instant').each((i, el) => {
                    const name = $(el).find('.instant-link').text().trim()
                    const button = $(el).find('.small-button')
                    const onClickAttr = button.attr('onclick') || ''
                    const match = onClickAttr.match(/play\('([^']+)'/)
                    if (match) {
                        results.push({
                            name,
                            url: `https://www.myinstants.com${match[1]}`
                        })
                    }
                })

                if (results.length > 0) {
                    soundUrl = results[0].url
                    soundName = results[0].name
                    isFromScraper = true

                    // Simpan hasil pencarian pertama ke database cache
                    try {
                        db.prepare('INSERT OR REPLACE INTO sound_cache (keyword, sound_name, sound_url) VALUES (?, ?, ?)')
                            .run(query, soundName, soundUrl)
                        logger.info(`💾 [Sound] Berhasil menyimpan cache: "${query}" -> "${soundName}"`)
                    } catch (dbErr) {
                        logger.error('❌ [Sound] DB Write Error:', dbErr.message)
                    }
                }
            } catch (err) {
                logger.error('❌ [Sound] Search Error:', err.message)
            }
        }

        // 4. Jika tidak ditemukan di manapun
        if (!soundUrl) {
            await react('❌')
            return reply(`❌ Sound "${query}" tidak ditemukan di lokal maupun MyInstants.`)
        }

        // 5. Kirim sound ke WA
        if (isFromScraper) {
            await reply(`🔍 *Mendapatkan sound baru:* "${soundName}"\n💾 Menyimpan ke database cache...`)
        }

        await react('⏳')
        try {
            await sock.sendMessage(from, {
                audio: { url: soundUrl },
                mimetype: 'audio/mpeg',
                ptt: false // Nonaktifkan PTT agar MP3 bisa diputar di WA Mobile tanpa error
            }, { quoted: msg })

            await react('✅')

        } catch (err) {
            logger.error('❌ [Sound] Error:', err.message)
            await react('❌')
            await reply('❌ Gagal mengirim sound, mungkin link-nya mati.')
        }
    }
}
