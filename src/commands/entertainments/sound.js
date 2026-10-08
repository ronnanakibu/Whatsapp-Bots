// src/commands/entertainments/sound.js
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { execFile, exec } from 'child_process'
import util from 'util'
import Database from 'better-sqlite3'
import yts from 'yt-search'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { logger } from '../../utils/logger.js'
import { tgStorage } from '../../services/tgStorage.js'
import { mediaCache } from '../../services/mediaCache.js'
import { getFfmpegPath } from '../../services/media.js'
import { download } from '../../services/downloader/index.js'
import { unwrapMessage } from '../../utils/message.js'
import { normalizeNumber } from '../../utils/permissions.js'

const execFilePromise = util.promisify(execFile)
const execPromise = util.promisify(exec)

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
const VN_DIR = path.resolve('./storage/sounds')
const SOUND_CACHE_DIR = path.resolve('./storage/sounds/cache')

let dbInstance = null
function getDb() {
    if (dbInstance) return dbInstance

    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(VN_DIR)) fs.mkdirSync(VN_DIR, { recursive: true })
    if (!fs.existsSync(SOUND_CACHE_DIR)) fs.mkdirSync(SOUND_CACHE_DIR, { recursive: true })

    dbInstance = new Database(DB_PATH)
    dbInstance.pragma('journal_mode = WAL')
    dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS sound_cache (
            keyword    TEXT PRIMARY KEY,
            sound_name TEXT NOT NULL,
            sound_url  TEXT NOT NULL,
            audio_data BLOB,
            source     TEXT NOT NULL DEFAULT 'unknown',
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS sound_vn (
            keyword    TEXT PRIMARY KEY,
            file_path  TEXT,
            audio_data BLOB,
            mime_type  TEXT,
            added_by   TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)

    // Migrasi kolom jika tabel lama belum memiliki audio_data atau mime_type
    try { dbInstance.exec('ALTER TABLE sound_vn ADD COLUMN audio_data BLOB') } catch (_) {}
    try { dbInstance.exec('ALTER TABLE sound_vn ADD COLUMN mime_type TEXT') } catch (_) {}
    try { dbInstance.exec('ALTER TABLE sound_cache ADD COLUMN audio_data BLOB') } catch (_) {}

    return dbInstance
}

// ─── Koleksi Meme Sounds Bawaan (Instan 0ms Response) ─────────────────────────
const MEME_SOUNDS = {
    'vineboom':   'https://www.myinstants.com/media/sounds/vine-boom.mp3',
    'bruh':       'https://www.myinstants.com/media/sounds/movie_1.mp3',
    'crickets':   'https://www.myinstants.com/media/sounds/crickets.mp3',
    'fart':       'https://www.myinstants.com/media/sounds/fart-with-reverb.mp3',
    'sadviolin':  'https://www.myinstants.com/media/sounds/sad-violin.mp3',
    'laugh':      'https://www.myinstants.com/media/sounds/laugh-track.mp3',
    'wow':        'https://www.myinstants.com/media/sounds/anime-wow-sound-effect.mp3',
    'spongebob':  'https://www.myinstants.com/media/sounds/spongebob-fail.mp3',
    'nani':       'https://www.myinstants.com/media/sounds/nani_Pmxf5n3.mp3',
    'run':        'https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3',
    'bonk':       'https://www.myinstants.com/media/sounds/bonk_BEtiM8g.mp3',
    'emotional':  'https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3',
    'illuminati': 'https://www.myinstants.com/media/sounds/illuminati-confirmed.mp3',
    'windows':    'https://www.myinstants.com/media/sounds/windows-xp-startup.mp3',
    'boom':       'https://www.myinstants.com/media/sounds/yamede-kudasai.mp3',
    'amongus':    'https://www.myinstants.com/media/sounds/among-us-role-reveal-sound.mp3',
    'airhorn':    'https://www.myinstants.com/media/sounds/mlg-airhorn.mp3',
    'metalgear':  'https://www.myinstants.com/media/sounds/mgs-alert.mp3',
    'wasted':     'https://www.myinstants.com/media/sounds/gta-v-death-sound-effect-102.mp3',
    'discord':    'https://www.myinstants.com/media/sounds/discord-notification.mp3',
    'roblox':     'https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3',
    'error':      'https://www.myinstants.com/media/sounds/windows-error.mp3',
    'sheesh':     'https://www.myinstants.com/media/sounds/sheesh-sound-effect.mp3',
    'tada':       'https://www.myinstants.com/media/sounds/tada1.mp3',
    'rimshot':    'https://www.myinstants.com/media/sounds/ba-dum-tss_1.mp3',
    'applause':   'https://www.myinstants.com/media/sounds/applause-8.mp3'
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function isValidAudio(buf) {
    if (!buf || buf.length < 500) return false
    const str = buf.subarray(0, 100).toString().toLowerCase()
    if (str.includes('<!doctype') || str.includes('<html') || str.includes('cloudflare') || str.includes('attention required')) {
        return false
    }
    return true
}

function getCachedSound(url) {
    try {
        const hash = crypto.createHash('md5').update(url).digest('hex')
        const cacheFile = path.join(SOUND_CACHE_DIR, `${hash}.mp3`)
        if (fs.existsSync(cacheFile)) {
            const buf = fs.readFileSync(cacheFile)
            if (isValidAudio(buf)) return buf
        }
    } catch (_) {}
    return null
}

function saveCachedSound(url, buf) {
    try {
        if (!isValidAudio(buf)) return
        if (!fs.existsSync(SOUND_CACHE_DIR)) fs.mkdirSync(SOUND_CACHE_DIR, { recursive: true })
        const hash = crypto.createHash('md5').update(url).digest('hex')
        const cacheFile = path.join(SOUND_CACHE_DIR, `${hash}.mp3`)
        fs.writeFileSync(cacheFile, buf)
    } catch (_) {}
}

async function fetchSoundBuffer(url) {
    const cached = getCachedSound(url)
    if (cached) return cached

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': UA,
                'Referer': 'https://www.myinstants.com/',
                'Accept': '*/*'
            }
        })
        if (res.ok) {
            const ab = await res.arrayBuffer()
            const buf = Buffer.from(ab)
            if (isValidAudio(buf)) {
                saveCachedSound(url, buf)
                return buf
            }
        }
    } catch (fetchErr) {
        logger.warn(`[Sound] fetch buffer failed for ${url}: ${fetchErr.message}`)
    }

    try {
        const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl'
        const args = ['-s', '-L', '--max-time', '15', '-A', UA, '-e', 'https://www.myinstants.com/', url]
        const { stdout } = await execFilePromise(curlBin, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 })
        if (isValidAudio(stdout)) {
            saveCachedSound(url, stdout)
            return stdout
        }
    } catch (curlErr) {
        logger.warn(`[Sound] curl buffer failed for ${url}: ${curlErr.message}`)
    }

    return null
}

/**
 * Cari daftar sound dari MyInstants Soundboard menggunakan curl untuk melewati proteksi TLS
 */
async function searchMyInstantsList(query) {
    try {
        const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl'
        const url = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`
        const args = ['-s', '-L', '--max-time', '10', '-A', UA, url]
        const { stdout } = await execFilePromise(curlBin, args)
        if (!stdout) return []

        const regex = /onclick="play\('([^']+)'[^)]*\)"[\s\S]*?<a[^>]*class="instant-link[^"]*"[^>]*>([^<]+)<\/a>/g
        const results = []
        let match
        while ((match = regex.exec(stdout)) !== null) {
            results.push({
                mp3: `https://www.myinstants.com${match[1]}`,
                title: match[2].trim()
            })
            if (results.length >= 10) break
        }
        return results
    } catch (err) {
        logger.warn(`[Sound] MyInstants search error for "${query}": ${err.message}`)
        return []
    }
}

/**
 * Cari sound effect meme online secara dinamis
 * 1. Prioritas 1: MyInstants Meme Soundboard (respon cepat 1-2 detik, koleksi meme otentik)
 * 2. Prioritas 2: YouTube SFX Engine (Klip audio pendek 1-30 detik)
 */
async function searchOnlineSound(query) {
    // 1. MyInstants Soundboard Search
    try {
        const instants = await searchMyInstantsList(query)
        if (instants && instants.length > 0) {
            for (const item of instants.slice(0, 3)) {
                logger.info(`[Sound] Mencoba unduh dari MyInstants: "${item.title}" -> ${item.mp3}`)
                const buf = await fetchSoundBuffer(item.mp3)
                if (buf && isValidAudio(buf)) {
                    return {
                        title: item.title,
                        url: item.mp3,
                        buffer: buf,
                        source: 'myinstants',
                        ext: 'mp3'
                    }
                }
            }
        }
    } catch (mErr) {
        logger.warn(`[Sound] MyInstants lookup failed: ${mErr.message}`)
    }

    // 2. Fallback: YouTube SFX / Meme Klip Pendek
    try {
        const searchTerms = [
            `${query} sound effect`,
            `${query} meme sound`,
            query
        ]

        for (const term of searchTerms) {
            const res = await yts(term).catch(() => null)
            const videos = res?.videos || []
            if (videos.length === 0) continue

            // Prioritaskan klip pendek sound effect murni (1 sampai 30 detik)
            const matched = videos.find(v => v.seconds >= 1 && v.seconds <= 30)
                || videos.find(v => v.seconds >= 1 && v.seconds <= 60)

            if (matched) {
                logger.info(`[Sound] Found YouTube sound candidate: "${matched.title}" (${matched.seconds}s) -> ${matched.url}`)
                const dl = await download(matched.url, { format: 'audio' })
                if (dl?.buffer && dl.buffer.length > 500) {
                    return {
                        title: matched.title,
                        url: matched.url,
                        duration: matched.timestamp,
                        buffer: dl.buffer,
                        source: 'youtube-sfx',
                        ext: dl.ext || 'mp3'
                    }
                }
            }
        }
    } catch (err) {
        logger.warn(`[Sound] Online sound search failed for "${query}": ${err.message}`)
    }
    return null
}

export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme, simpan audio kustom, atau cari soundboard meme online',
    usage: '.sound <nama/pencarian> | .sound search <query> | .sound add <nama> (reply VN) | .sound del <nama> | .sound list',
    example: '.sound bruh | .sound metal pipe | .sound search anime | .sound add rizz (reply VN)',
    cooldown: 2,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, messageContent } = ctx
        const db = getDb()

        const sub = args[0]?.toLowerCase()

        const rawBotId = sock.user?.id ?? ''
        const botNumbers = new Set([
            normalizeNumber(rawBotId),
            normalizeNumber(sock.user?.lid ?? ''),
            ...(process.env.BOT_NUMBER ?? '').split(',').map(normalizeNumber)
        ].filter(Boolean))

        // ─────────────────────────────────────────────────────────────────────
        // SUB-COMMAND: add / save / simpan (Simpan VN/Audio/Video ke Database)
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'add' || sub === 'save' || sub === 'simpan') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) {
                return reply('❌ Sebutkan nama/keyword untuk sound ini!\n*Contoh:* .sound add rizz (sambil reply ke pesan VN, Audio, atau Video)')
            }

            const contextInfo = messageContent?.extendedTextMessage?.contextInfo
            const quotedMsg = contextInfo?.quotedMessage ?? null
            const quotedStanzaId = contextInfo?.stanzaId
            const quotedParticipant = contextInfo?.participant

            const unwrappedDirect = unwrapMessage(messageContent)
            const unwrappedQuoted = unwrapMessage(quotedMsg)

            let targetBuffer = null
            let mimeType = 'audio/ogg; codecs=opus'
            let isVideo = false

            await react('⏳')

            // 1. Cek dari Quoted Message
            if (unwrappedQuoted) {
                const qType = Object.keys(unwrappedQuoted)[0]
                const isAudio = qType === 'audioMessage' || (qType === 'documentMessage' && unwrappedQuoted.documentMessage?.mimetype?.startsWith('audio/'))
                isVideo = qType === 'videoMessage' || qType === 'ptvMessage'

                if (isAudio || isVideo) {
                    const reconstructedQuotedMsg = {
                        key: {
                            remoteJid: from,
                            id: quotedStanzaId ?? '',
                            fromMe: quotedParticipant ? botNumbers.has(normalizeNumber(quotedParticipant)) : false,
                            participant: quotedParticipant || undefined,
                        },
                        message: unwrappedQuoted
                    }

                    targetBuffer = await mediaCache.getMediaBuffer(sock, reconstructedQuotedMsg)
                    if (!targetBuffer) {
                        targetBuffer = await downloadMediaMessage(
                            reconstructedQuotedMsg,
                            'buffer',
                            {},
                            { logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage }
                        ).catch(() => null)
                    }

                    if (isAudio && unwrappedQuoted[qType]?.mimetype) {
                        mimeType = unwrappedQuoted[qType].mimetype
                    }
                }
            }

            // 2. Cek dari Direct Message
            if (!targetBuffer && unwrappedDirect) {
                const dType = Object.keys(unwrappedDirect)[0]
                const isAudio = dType === 'audioMessage' || (dType === 'documentMessage' && unwrappedDirect.documentMessage?.mimetype?.startsWith('audio/'))
                isVideo = dType === 'videoMessage' || dType === 'ptvMessage'

                if (isAudio || isVideo) {
                    targetBuffer = await mediaCache.getMediaBuffer(sock, msg)
                    if (!targetBuffer) {
                        targetBuffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage }
                        ).catch(() => null)
                    }
                    if (isAudio && unwrappedDirect[dType]?.mimetype) {
                        mimeType = unwrappedDirect[dType].mimetype
                    }
                }
            }

            if (!targetBuffer || targetBuffer.length === 0) {
                await react('❌')
                return reply(
                    '❌ Media suara tidak ditemukan!\n\n' +
                    '*Cara pakai:*\n' +
                    '1. Reply ke pesan Voice Note, Audio, atau Video.\n' +
                    '2. Ketik: *.sound add <nama_sound>*\n' +
                    'Contoh: *.sound add ketawa*'
                )
            }

            // Ekstrak audio jika input berupa video
            if (isVideo) {
                const ffmpegBin = getFfmpegPath()
                const tmpDir = path.resolve('./storage/media/tmp')
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
                const randId = crypto.randomBytes(4).toString('hex')
                const tempIn = path.join(tmpDir, `${randId}_in.mp4`)
                const tempOut = path.join(tmpDir, `${randId}_out.ogg`)

                try {
                    fs.writeFileSync(tempIn, targetBuffer)
                    await execPromise(`${ffmpegBin} -y -i "${tempIn}" -vn -c:a libopus -b:a 64k "${tempOut}"`)
                    if (fs.existsSync(tempOut)) {
                        targetBuffer = fs.readFileSync(tempOut)
                        mimeType = 'audio/ogg; codecs=opus'
                    }
                } catch (convErr) {
                    logger.warn(`[Sound] Gagal konversi video ke audio via ffmpeg: ${convErr.message}`)
                } finally {
                    try { if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn) } catch (_) {}
                    try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut) } catch (_) {}
                }
            }

            if (targetBuffer[0] === 0x4F && targetBuffer[1] === 0x67 && targetBuffer[2] === 0x67) {
                mimeType = 'audio/ogg; codecs=opus'
            } else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
                mimeType = 'audio/mpeg'
            }

            const safeKeyword = keyword.replace(/[^a-z0-9_-]/g, '_')
            const ext = mimeType.includes('mpeg') ? 'mp3' : 'ogg'
            const filePath = path.join(VN_DIR, `${safeKeyword}_${Date.now()}.${ext}`)

            try {
                fs.writeFileSync(filePath, targetBuffer)
            } catch (err) {
                logger.warn(`[Sound] Gagal tulis file lokal: ${err.message}`)
            }

            try {
                db.prepare(`
                    INSERT OR REPLACE INTO sound_vn (keyword, file_path, audio_data, mime_type, added_by, created_at)
                    VALUES (?, ?, ?, ?, ?, unixepoch())
                `).run(keyword, filePath, targetBuffer, mimeType, sender)
            } catch (dbErr) {
                logger.error(`[Sound] DB save error: ${dbErr.message}`)
                await react('❌')
                return reply(`❌ Gagal menyimpan ke database: ${dbErr.message}`)
            }

            if (tgStorage.isConfigured) {
                try {
                    const tgName = `sound_${safeKeyword}.${ext}`
                    const caption = mediaCache.formatTelegramCaption('Sound Saved', tgName, targetBuffer, {
                        sender,
                        isGroup: ctx.isGroup,
                        from,
                        mType: 'audioMessage',
                        ptt: true
                    })
                    await tgStorage.uploadMedia(targetBuffer, tgName, {
                        caption,
                        type: 'audio'
                    })
                } catch (tgErr) {
                    logger.warn(`[Sound] Backup ke Telegram gagal: ${tgErr.message}`)
                }
            }

            await react('✅')
            return reply(
                `✅ Sound *"${keyword}"* (${(targetBuffer.length / 1024).toFixed(1)} KB) berhasil disimpan secara permanen!\n\n` +
                `▶️ Putar kapan saja dengan mengetik: *.sound ${keyword}*`
            )
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUB-COMMAND: del / delete / hapus
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'del' || sub === 'delete' || sub === 'hapus') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) return reply('❌ Sebutkan keyword sound yang ingin dihapus.\n*Contoh:* .sound del rizz')

            const existing = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(keyword)
            const cached = db.prepare('SELECT keyword FROM sound_cache WHERE keyword = ?').get(keyword)

            if (!existing && !cached) {
                return reply(`❌ Sound dengan keyword *"${keyword}"* tidak ditemukan di database.`)
            }

            if (existing) {
                db.prepare('DELETE FROM sound_vn WHERE keyword = ?').run(keyword)
                if (existing.file_path && fs.existsSync(existing.file_path)) {
                    try { fs.unlinkSync(existing.file_path) } catch (_) {}
                }
            }

            if (cached) {
                db.prepare('DELETE FROM sound_cache WHERE keyword = ?').run(keyword)
            }

            await react('🗑️')
            return reply(`🗑️ Sound *"${keyword}"* berhasil dihapus dari database.`)
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUB-COMMAND: search / cari (Cari daftar soundboard meme online)
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'search' || sub === 'cari') {
            const q = args.slice(1).join(' ').trim()
            if (!q) {
                return reply('❌ Masukkan kata kunci yang ingin dicari!\n*Contoh:* .sound search metal pipe')
            }

            await react('🔍')
            const list = await searchMyInstantsList(q)
            if (!list || list.length === 0) {
                await react('❌')
                return reply(`❌ Tidak ditemukan soundboard meme dengan kata kunci *"${q}"*.`)
            }

            const items = list.map((item, idx) => `${idx + 1}. *${item.title}*\n   ▶️ *.sound ${item.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()}*`).join('\n\n')
            await react('✅')
            return reply(
                `🔊 *Hasil Pencarian Soundboard Meme:* "${q}"\n\n` +
                items +
                `\n\n_Ketik salah satu perintah *.sound <nama>* di atas untuk langsung memutarnya!_`
            )
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUB-COMMAND: list / daftar
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'list' || sub === 'daftar') {
            const builtInList = Object.keys(MEME_SOUNDS).map(s => `• ${s}`).join('\n')
            let vnList = ''
            let cacheList = ''
            try {
                const vnSounds = db.prepare('SELECT keyword FROM sound_vn ORDER BY keyword ASC').all()
                if (vnSounds.length > 0) {
                    vnList = '\n\n*🎤 Sound Kustom Tersimpan:*\n' + vnSounds.map(s => `• ${s.keyword}`).join('\n')
                }

                const cachedSounds = db.prepare('SELECT keyword, sound_name FROM sound_cache ORDER BY created_at DESC LIMIT 15').all()
                if (cachedSounds.length > 0) {
                    cacheList = '\n\n*🌐 Sound Online (Tercache):*\n' + cachedSounds.map(s => `• ${s.keyword} _(${s.sound_name.slice(0, 30)})_`).join('\n')
                }
            } catch (_) {}

            return reply(
                `🔊 *Daftar Koleksi Sound Bot*\n\n` +
                `*📦 Sound Bawaan (${Object.keys(MEME_SOUNDS).length}):*\n${builtInList}` +
                vnList +
                cacheList +
                `\n\n_Ketik *.sound <nama>* untuk memutar sound apa pun._\n_Simpan sound baru: Reply audio dengan *.sound add <nama>*_`
            )
        }

        // ─────────────────────────────────────────────────────────────────────
        // MENU UTAMA (Tanpa Argumen)
        // ─────────────────────────────────────────────────────────────────────
        if (args.length === 0) {
            const topSounds = Object.keys(MEME_SOUNDS).slice(0, 15).map(s => `• ${s}`).join('\n')
            let customCount = 0
            try {
                const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sound_vn').get()
                customCount = countRow?.cnt ?? 0
            } catch (_) {}

            return reply(
                `🔊 *Soundboard & Meme Sound Menu*\n\n` +
                `*📖 Cara Penggunaan:*\n` +
                `1. *.sound <nama/pencarian>*\n` +
                `   Memutar voice note meme bawaan atau *mencari otomatis di meme soundboard / internet*!\n` +
                `   Contoh: *.sound bruh*, *.sound metal pipe*, *.sound skibidi*, *.sound waduh*\n\n` +
                `2. *.sound search <kata_kunci>*\n` +
                `   Mencari daftar pilihan soundboard meme dari internet.\n` +
                `   Contoh: *.sound search anime*, *.sound search fart*\n\n` +
                `3. *(Reply VN/Audio/Video)* *.sound add <nama>*\n` +
                `   Menyimpan audio menjadi sound kustom pribadi bot secara permanen.\n\n` +
                `4. *.sound list*\n` +
                `   Melihat seluruh koleksi sound (${customCount} sound kustom tersimpan).\n\n` +
                `5. *.sound del <nama>*\n` +
                `   Menghapus sound kustom yang tersimpan.\n\n` +
                `*🔥 Rekomendasi Sound Bawaan:*\n${topSounds}`
            )
        }

        // ─────────────────────────────────────────────────────────────────────
        // PLAY SOUND (.sound <nama / pencarian>)
        // ─────────────────────────────────────────────────────────────────────
        const query = args.join(' ').toLowerCase().trim()
        await react('⏳')

        // 1. Cek Sound Kustom di DB (Paling Cepat: 0ms)
        try {
            const vnRow = db.prepare('SELECT file_path, audio_data, mime_type FROM sound_vn WHERE keyword = ?').get(query)
            if (vnRow) {
                let playBuffer = vnRow.audio_data
                if (!playBuffer && vnRow.file_path && fs.existsSync(vnRow.file_path)) {
                    playBuffer = fs.readFileSync(vnRow.file_path)
                }
                if (playBuffer && playBuffer.length > 0) {
                    await sock.sendMessage(from, {
                        audio: playBuffer,
                        mimetype: vnRow.mime_type || 'audio/ogg; codecs=opus',
                        ptt: true
                    }, { quoted: msg })
                    await react('✅')
                    return
                }
            }
        } catch (dbErr) {
            logger.error(`[Sound] DB read error: ${dbErr.message}`)
        }

        // 2. Cek Sound Bawaan (MEME_SOUNDS)
        if (MEME_SOUNDS[query]) {
            try {
                const soundUrl = MEME_SOUNDS[query]
                const audioBuffer = await fetchSoundBuffer(soundUrl)
                if (audioBuffer && audioBuffer.length > 0) {
                    await sock.sendMessage(from, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: true
                    }, { quoted: msg })
                    await react('✅')
                    return
                }
            } catch (playErr) {
                logger.error(`[Sound] Built-in sound play error: ${playErr.message}`)
            }
        }

        // 3. Cek Sound Cache di DB (Hasil Pencarian Online Sebelumnya)
        try {
            const cacheRow = db.prepare('SELECT sound_name, sound_url, audio_data FROM sound_cache WHERE keyword = ?').get(query)
            if (cacheRow) {
                let cachedBuffer = cacheRow.audio_data
                if (!cachedBuffer && cacheRow.sound_url) {
                    cachedBuffer = await fetchSoundBuffer(cacheRow.sound_url)
                }
                if (cachedBuffer && cachedBuffer.length > 0) {
                    await sock.sendMessage(from, {
                        audio: cachedBuffer,
                        mimetype: 'audio/mpeg',
                        ptt: true
                    }, { quoted: msg })
                    await react('✅')
                    return
                }
            }
        } catch (cacheErr) {
            logger.error(`[Sound] Cache read error: ${cacheErr.message}`)
        }

        // 4. PENCARIAN ONLINE OTOMATIS (Meme Soundboard / SFX Library)
        try {
            const onlineResult = await searchOnlineSound(query)
            if (onlineResult && onlineResult.buffer) {
                // Simpan ke SQLite cache agar panggilan berikutnya 0ms
                try {
                    db.prepare(`
                        INSERT OR REPLACE INTO sound_cache (keyword, sound_name, sound_url, audio_data, source, created_at)
                        VALUES (?, ?, ?, ?, 'online-sfx', unixepoch())
                    `).run(query, onlineResult.title, onlineResult.url, onlineResult.buffer)
                } catch (_) {}

                // Kirim langsung sebagai Voice Note
                await sock.sendMessage(from, {
                    audio: onlineResult.buffer,
                    mimetype: 'audio/mpeg',
                    ptt: true
                }, { quoted: msg })

                await react('✅')
                return
            }
        } catch (searchErr) {
            logger.warn(`[Sound] Online search error: ${searchErr.message}`)
        }

        // 5. Sound tidak ditemukan
        await react('❌')
        return reply(
            `❌ Sound *"${query}"* tidak ditemukan di pustaka lokal maupun pencarian online.\n\n` +
            `💡 *Tips:*\n` +
            `• Coba gunakan kata kunci lain (misal: *.sound metal pipe*, *.sound skibidi*, *.sound waduh*).\n` +
            `• Ketik *.sound list* untuk melihat sound yang tersedia.\n` +
            `• Simpan sound sendiri: Reply ke VN/Audio lalu ketik: *.sound add ${query}*`
        )
    }
}
