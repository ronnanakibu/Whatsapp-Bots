// src/commands/entertainments/sound.js
import axios from 'axios'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { execFile, exec } from 'child_process'
import util from 'util'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { logger } from '../../utils/logger.js'
import { tgStorage } from '../../services/tgStorage.js'
import { mediaCache } from '../../services/mediaCache.js'
import { getFfmpegPath } from '../../services/media.js'
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
    try {
        dbInstance.exec('ALTER TABLE sound_vn ADD COLUMN audio_data BLOB')
    } catch (_) {}
    try {
        dbInstance.exec('ALTER TABLE sound_vn ADD COLUMN mime_type TEXT')
    } catch (_) {}

    return dbInstance
}

// ─── Koleksi Meme Sounds Bawaan (Terverifikasi Aktif & Bebas Blokir) ───────────
const MEME_SOUNDS = {
    // Klasik & Viral
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
    // 1. Cek disk cache lokal terlebih dahulu
    const cached = getCachedSound(url)
    if (cached) return cached

    // 2. Gunakan HTTP fetch dengan header browser
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

    // 3. Fallback ke curl
    try {
        const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl'
        const args = [
            '-s', '-L',
            '--max-time', '15',
            '-A', UA,
            '-e', 'https://www.myinstants.com/',
            url
        ]
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

export default {
    name: 'sound',
    aliases: ['snd', 'vn', 'voice'],
    category: 'entertainment',
    description: 'Kirim voice note meme, simpan audio kustom, atau kelola koleksi soundboard',
    usage: '.sound <nama> | .sound add <nama> (reply VN) | .sound del <nama> | .sound list',
    example: '.sound bruh | .sound add rizz (reply VN)',
    cooldown: 2,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, from, msg, sender, messageContent } = ctx
        const db = getDb()

        const sub = args[0]?.toLowerCase()

        // Kumpulkan identifier bot untuk resolusi fromMe
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

                    // Prioritas: Ambil dari cache lokal terlebih dahulu
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

            // 2. Cek dari Direct Message (misal dikirim dengan caption .sound add <nama>)
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

            // Jika sumber dari video, ekstrak audio menggunakan FFmpeg
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

            // Normalisasi mimetype
            if (targetBuffer[0] === 0x4F && targetBuffer[1] === 0x67 && targetBuffer[2] === 0x67) {
                mimeType = 'audio/ogg; codecs=opus'
            } else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
                mimeType = 'audio/mpeg'
            }

            const safeKeyword = keyword.replace(/[^a-z0-9_-]/g, '_')
            const ext = mimeType.includes('mpeg') ? 'mp3' : 'ogg'
            const filePath = path.join(VN_DIR, `${safeKeyword}_${Date.now()}.${ext}`)

            // 1. Simpan ke disk lokal
            try {
                fs.writeFileSync(filePath, targetBuffer)
            } catch (err) {
                logger.warn(`[Sound] Gagal tulis file lokal: ${err.message}`)
            }

            // 2. Simpan ke Database SQLite (Menyimpan binary audio_data secara permanen)
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

            // 3. Backup otomatis ke Telegram Cloud Vault jika dikonfigurasi
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
        // SUB-COMMAND: del / delete / hapus (Hapus VN dari Database)
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'del' || sub === 'delete' || sub === 'hapus') {
            const keyword = args.slice(1).join(' ').toLowerCase().trim()
            if (!keyword) return reply('❌ Sebutkan keyword sound yang ingin dihapus.\n*Contoh:* .sound del rizz')

            const existing = db.prepare('SELECT file_path FROM sound_vn WHERE keyword = ?').get(keyword)
            if (!existing) {
                return reply(`❌ Sound dengan keyword *"${keyword}"* tidak ditemukan di database.`)
            }

            db.prepare('DELETE FROM sound_vn WHERE keyword = ?').run(keyword)
            if (existing.file_path && fs.existsSync(existing.file_path)) {
                try { fs.unlinkSync(existing.file_path) } catch (_) {}
            }

            await react('🗑️')
            return reply(`🗑️ Sound *"${keyword}"* berhasil dihapus dari database.`)
        }

        // ─────────────────────────────────────────────────────────────────────
        // SUB-COMMAND: list / daftar (Daftar Seluruh Sound)
        // ─────────────────────────────────────────────────────────────────────
        if (sub === 'list' || sub === 'daftar') {
            const builtInList = Object.keys(MEME_SOUNDS).map(s => `• ${s}`).join('\n')
            let vnList = ''
            try {
                const vnSounds = db.prepare('SELECT keyword FROM sound_vn ORDER BY keyword ASC').all()
                if (vnSounds.length > 0) {
                    vnList = '\n\n*🎤 Sound Kustom Tersimpan:*\n' + vnSounds.map(s => `• ${s.keyword}`).join('\n')
                }
            } catch (_) {}

            return reply(
                `🔊 *Daftar Koleksi Sound Bot*\n\n` +
                `*📦 Sound Bawaan (${Object.keys(MEME_SOUNDS).length}):*\n${builtInList}` +
                vnList +
                `\n\n_Ketik *.sound <nama>* untuk memutar sound._\n_Simpan sound baru: Reply audio dengan *.sound add <nama>*_`
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
                `🔊 *Soundboard & Voice Note Menu*\n\n` +
                `*📖 Cara Penggunaan:*\n` +
                `1. *.sound <nama>*\n` +
                `   Memutar voice note meme (Contoh: *.sound bruh* atau *.sound vineboom*).\n\n` +
                `2. *(Reply VN/Audio/Video)* *.sound add <nama>*\n` +
                `   Menyimpan audio menjadi sound kustom bot.\n\n` +
                `3. *.sound list*\n` +
                `   Melihat seluruh daftar sound (${customCount} sound kustom tersimpan).\n\n` +
                `4. *.sound del <nama>*\n` +
                `   Menghapus sound kustom yang tersimpan.\n\n` +
                `*🔥 Rekomendasi Sound Populer:*\n${topSounds}`
            )
        }

        // ─────────────────────────────────────────────────────────────────────
        // PLAY SOUND (.sound <nama>)
        // ─────────────────────────────────────────────────────────────────────
        const query = args.join(' ').toLowerCase().trim()
        await react('⏳')

        // 1. Cek Sound Kustom di DB
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

        // 3. Sound tidak ditemukan
        await react('❌')
        return reply(
            `❌ Sound *"${query}"* tidak ditemukan.\n\n` +
            `💡 *Tips:*\n` +
            `• Ketik *.sound list* untuk melihat daftar sound yang tersedia.\n` +
            `• Simpan sound baru dengan me-reply audio lalu ketik: *.sound add ${query}*`
        )
    }
}
