// src/services/radio.js
// RadioService — Live Radio Streaming Engine
// Architecture: yt-dlp (YouTube extract) → FFmpeg stdin pipe → HTTP broadcast
// Fallback: SoundCloud via play-dl jika YouTube/yt-dlp gagal

import { spawn, execSync } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { botLogger } from '../utils/logger.js'
import { getYtdlpPath, ytdlpGetAudioUrl, ytdlpStream, getCookieArgs } from './ytdlp.js'
import { db } from './db.js'

// Cek apakah filter 'afifo' didukung oleh ffmpeg (karena sudah dihapus sejak versi FFmpeg awal 2024)
let _isAfifoSupported = false
try {
    const filters = execSync('ffmpeg -filters', { stdio: 'pipe' }).toString()
    _isAfifoSupported = filters.includes(' afifo ')
} catch (e) {
    botLogger.warn('radio', `Gagal mengecek filter afifo ffmpeg: ${e.message}`)
}

// ─────────────────────────────────────────────
// PLAY-DL — search + stream (no yt-dlp needed)
// ─────────────────────────────────────────────

async function getPlayDl() {
    try {
        const mod = await import('play-dl')
        return mod.default ?? mod
    } catch (e) {
        throw new Error(`play-dl belum terinstall. Jalankan: npm install play-dl\n${e.message}`)
    }
}

// Inisialisasi play-dl sekali — set cookie kalau ada
let _playDlReady = false
async function initPlayDl() {
    if (_playDlReady) return
    _playDlReady = true
    const playdl = await getPlayDl()

    // Cari cookie dari berbagai sumber:
    // 1. File JSON (recommended — bisa multiline, paste langsung dari browser extension)
    // 2. ENV var YOUTUBE_COOKIE (single-line header string)
    const cookieFile = process.env.YOUTUBE_COOKIE_FILE
        || path.resolve('./storage/youtube-cookies.json')

    let cookieStr = null

    // Source 1: File JSON atau Netscape
    if (fs.existsSync(cookieFile)) {
        try {
            const raw = fs.readFileSync(cookieFile, 'utf-8').trim()
            if (raw.startsWith('[')) {
                const arr = JSON.parse(raw)
                cookieStr = arr
                    .filter(c => c.name && c.value)
                    .map(c => `${c.name}=${c.value}`)
                    .join('; ')
                botLogger.info('radio', `Cookie loaded from ${path.basename(cookieFile)} (${arr.length} cookies)`)
            } else if (raw.startsWith('#')) {
                // Netscape format cookie file
                const lines = raw.split('\n')
                const cookies = []
                for (let line of lines) {
                    line = line.trim()
                    if (!line || line.startsWith('#')) continue
                    const parts = line.split('\t')
                    if (parts.length >= 7) {
                        const name = parts[5]
                        const value = parts[6]
                        cookies.push(`${name}=${value}`)
                    }
                }
                cookieStr = cookies.join('; ')
                botLogger.info('radio', `Cookie loaded from Netscape file ${path.basename(cookieFile)} (${cookies.length} cookies)`)
            } else {
                // Sudah format header string
                cookieStr = raw
                botLogger.info('radio', `Cookie loaded from ${path.basename(cookieFile)} (header string)`)
            }
        } catch (e) {
            botLogger.warn('radio', `Gagal baca cookie file ${cookieFile}: ${e.message}`)
        }
    }

    // Source 2: ENV var (single-line)
    if (!cookieStr) {
        const env = process.env.YOUTUBE_COOKIE
        if (env && env.length > 20 && !env.startsWith('[')) {
            cookieStr = env.trim()
            botLogger.info('radio', 'Cookie loaded from YOUTUBE_COOKIE env var')
        }
    }

    if (!cookieStr) {
        botLogger.warn('radio', [
            'YouTube cookie tidak ditemukan.',
            `Simpan cookie JSON dari browser ke: ${cookieFile}`,
            'Atau set YOUTUBE_COOKIE di .env (format: name=val; name=val).',
        ].join(' '))
        return
    }

    try {
        await playdl.setToken({ youtube: { cookie: cookieStr } })
        botLogger.info('radio', 'play-dl: YouTube cookie configured ✓')
    } catch (e) {
        botLogger.warn('radio', `play-dl: cookie setup gagal: ${e.message}`)
    }
}

async function youtubeSearch(query) {
    const playdl = await getPlayDl()
    const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } })
    if (!results?.length) throw new Error('Lagu tidak ditemukan.')
    const v = results[0]
    return {
        title: v.title || 'Unknown',
        url: `https://www.youtube.com/watch?v=${v.id}`,
        duration: v.durationInSec || 0,
        thumbnail: v.thumbnails?.[0]?.url || null,
    }
}

async function youtubeGetInfo(url) {
    const playdl = await getPlayDl()
    const info = await playdl.video_info(url)
    const d = info.video_details
    return {
        title: d.title || 'Unknown',
        url: `https://www.youtube.com/watch?v=${d.id}`,
        duration: d.durationInSec || 0,
        thumbnail: d.thumbnails?.[0]?.url || null,
    }
}

/**
 * Extract audio CDN URL via play-dl video_info.
 * Lebih reliable dari stream() — tidak butuh auth/cookies.
 * Return: direct HTTPS URL yang bisa di-pipe ke ffmpeg -i
 */
async function getAudioUrl(youtubeUrl) {
    const playdl = await getPlayDl()

    botLogger.info('radio', `Extracting audio URL: ${youtubeUrl}`)

    // Validate dulu biar error message jelas
    const valid = await playdl.validate(youtubeUrl)
    if (!valid || valid === 'search') {
        throw new Error(`URL tidak valid untuk streaming: ${youtubeUrl}`)
    }

    const info = await playdl.video_info(youtubeUrl)
    const formats = info.format ?? []

    botLogger.debug('radio', `Got ${formats.length} formats`)

    // Debug: log struktur format pertama
    if (formats.length > 0) {
        botLogger.debug('radio', `Format[0]: ${JSON.stringify({
            itag: formats[0].itag,
            mimeType: formats[0].mimeType,
            bitrate: formats[0].bitrate,
            hasAudio: formats[0].hasAudio,
            hasVideo: formats[0].hasVideo,
            quality: formats[0].quality,
            url: formats[0].url ? '[present]' : '[missing]'
        })}`)
    }

    // YouTube audio-only itags (tidak ada video track)
    const AUDIO_ONLY_ITAGS = new Set([139, 140, 141, 249, 250, 251, 256, 258, 327, 233, 234])
    const PREFERRED_ITAGS = [140, 141, 251, 250, 139, 249, 258, 256]

    let best = null

    // Strategy 1: itag audio-only foreknown (paling reliable)
    for (const itag of PREFERRED_ITAGS) {
        const f = formats.find(f => f.itag === itag && f.url)
        if (f) { best = f; break }
    }

    // Strategy 2: mimeType mengandung 'audio'
    if (!best) {
        const byMime = formats
            .filter(f => f.url && f.mimeType?.toLowerCase().includes('audio'))
            .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
        best = byMime[0] ?? null
    }

    // Strategy 3: hasAudio && !hasVideo (beberapa versi play-dl)
    if (!best) {
        const byFlag = formats
            .filter(f => f.url && f.hasAudio === true && f.hasVideo === false)
            .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
        best = byFlag[0] ?? null
    }

    // Strategy 4: itag dalam set audio-only
    if (!best) {
        best = formats.find(f => f.url && AUDIO_ONLY_ITAGS.has(f.itag)) ?? null
    }

    // Strategy 5: fallback — format apapun yang punya URL, bitrate paling kecil (kemungkinan audio)
    if (!best) {
        const withUrl = formats.filter(f => f.url)
        withUrl.sort((a, b) => (a.bitrate ?? 999999) - (b.bitrate ?? 999999))
        best = withUrl[0] ?? null
        if (best) botLogger.warn('radio', `Fallback ke format non-audio-only (itag ${best.itag})`)
    }

    if (!best?.url) {
        const itagList = formats.map(f => f.itag).join(', ')
        throw new Error(`Tidak ada format audio yang bisa dipakai. Available itags: ${itagList}`)
    }

    botLogger.info('radio', `Selected: itag=${best.itag} mime=${best.mimeType ?? '?'} bitrate=${best.bitrate ?? '?'}`)
    // Kembalikan juga info object — dipakai stream_from_info() agar tidak double-fetch
    return { url: best.url, mimeType: best.mimeType ?? 'audio/mp4', info }
}

// ─────────────────────────────────────────────
// FETCH URL → NODE READABLE STREAM
// Bypass ffmpeg DNS — Node.js fetch CDN URL dulu,
// pipe ke ffmpeg stdin. Ffmpeg tidak perlu resolve apapun.
// ─────────────────────────────────────────────

function fetchStream(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'))

        const client = url.startsWith('https') ? https : http
        const req = client.get(url, {
            headers: {
                // Header yang YouTube CDN harapkan dari browser
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',     // Jangan compress — kita stream raw
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com/',
                'Sec-Fetch-Dest': 'video',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site',
                'Range': 'bytes=0-',
            },
            timeout: 15_000,
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.destroy()
                return fetchStream(res.headers.location, redirectCount + 1).then(resolve).catch(reject)
            }

            if (res.statusCode !== 200 && res.statusCode !== 206) {
                res.destroy()
                return reject(new Error(`HTTP ${res.statusCode} dari CDN`))
            }

            resolve(res)
        })

        req.on('error', e => reject(new Error(`Fetch error: ${e.message}`)))
        req.on('timeout', () => {
            req.destroy()
            reject(new Error('Fetch timeout (15s)'))
        })
    })
}

// ─────────────────────────────────────────────
// FFMPEG PATH
// ─────────────────────────────────────────────

function getFfmpegPath() {
    const local = path.resolve('./storage/bin/ffmpeg')
    if (fs.existsSync(local)) {
        try {
            fs.accessSync(local, fs.constants.X_OK)
        } catch (_) {
            try { fs.chmodSync(local, 0o755) } catch (_) { }
        }
        return local
    }
    return 'ffmpeg' // fallback system PATH
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const TEMP_DIR = path.resolve('./storage/media/radio-temp')
const MAX_QUEUE = parseInt(process.env.RADIO_MAX_QUEUE ?? '20')

const FX_PRESETS = {
    normal: '',
    tupai: 'asetrate=44100*1.8,aresample=44100',
    lambat: 'asetrate=44100*0.7,aresample=44100',
    bass: 'bass=g=10,volume=1.5',
    robot: 'aecho=0.8:0.5:10:0.5,aphaser',
    reverb: 'aecho=0.8:0.88:60:0.4',
    louder: 'volume=2.0',
}

const EQ_PRESETS = {
    flat: '',
    pop: 'equalizer=f=60:t=o:w=200:g=3,equalizer=f=3000:t=o:w=1000:g=2',
    rock: 'equalizer=f=60:t=o:w=200:g=5,equalizer=f=1000:t=o:w=500:g=-2,equalizer=f=8000:t=o:w=2000:g=4',
    jazz: 'equalizer=f=250:t=o:w=200:g=3,equalizer=f=4000:t=o:w=1000:g=2',
    bass: 'equalizer=f=60:t=o:w=100:g=8,equalizer=f=200:t=o:w=200:g=4',
    classic: 'equalizer=f=250:t=o:w=200:g=2,equalizer=f=1000:t=o:w=500:g=-1,equalizer=f=4000:t=o:w=2000:g=3',
}

// ─────────────────────────────────────────────
// HELPER FUNCTIONS & DATABASE INTEGRATION
// ─────────────────────────────────────────────

export function getSongId(url, source) {
    if (source === 'youtube' || /(?:youtube\.com|youtu\.be)/.test(url)) {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\/\s]{11})/)
        if (match) return `yt_${match[1]}`
    }
    if (source === 'soundcloud' || /soundcloud\.com/.test(url)) {
        const slug = url.split('/').pop()
        return `sc_${slug}`
    }
    let hash = 0
    for (let i = 0; i < url.length; i++) {
        hash = (hash << 5) - hash + url.charCodeAt(i)
        hash |= 0
    }
    return `url_${Math.abs(hash)}`
}

export function dbEnsureUser(jid, name = null) {
    try {
        const resolvedName = name || jid.split('@')[0]
        db.prepare(`
            INSERT INTO users (jid, name)
            VALUES (?, ?)
            ON CONFLICT(jid) DO NOTHING
        `).run(jid, resolvedName)
    } catch (err) {
        botLogger.error('radio-db', `Failed to ensure user: ${err.message}`)
    }
}

export function dbUpsertSong(track) {
    try {
        db.prepare(`
            INSERT INTO songs (song_id, title, artist, duration, thumbnail_url, source, stream_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(song_id) DO UPDATE SET
                title = excluded.title,
                thumbnail_url = excluded.thumbnail_url,
                stream_url = excluded.stream_url
        `).run(
            track.songId,
            track.title,
            track.artist || 'Unknown',
            track.duration || 0,
            track.thumbnail || '',
            track.source,
            track.url
        )
    } catch (err) {
        botLogger.error('radio-db', `Failed to upsert song ${track.songId}: ${err.message}`)
    }
}

export function dbAddPlayHistory(songId, requestedByJid) {
    try {
        const jid = (requestedByJid && requestedByJid.includes('@')) ? requestedByJid : null
        if (jid) {
            dbEnsureUser(jid)
        }
        db.prepare(`
            INSERT INTO play_history (song_id, requested_by_jid, played_at)
            VALUES (?, ?, unixepoch())
        `).run(songId, jid)
    } catch (err) {
        botLogger.error('radio-db', `Failed to add play history: ${err.message}`)
    }
}

export function dbEvaluateAchievements(userJid) {
    try {
        // Evaluate requests_count achievements
        const reqCount = db.prepare("SELECT COUNT(*) as count FROM requests WHERE user_jid = ? AND status = 'played'").get(userJid)?.count || 0
        const reqAchievements = db.prepare("SELECT * FROM achievements WHERE criteria_type = 'requests_count'").all()
        for (const ach of reqAchievements) {
            if (reqCount >= ach.criteria_value) {
                dbUnlockAchievement(userJid, ach.achievement_id)
            }
        }

        // Evaluate listening_hours achievements
        const totalListenSec = db.prepare('SELECT SUM(duration_seconds) as total FROM listening_sessions WHERE user_jid = ?').get(userJid)?.total || 0
        const listenHours = totalListenSec / 3600
        const listenAchievements = db.prepare("SELECT * FROM achievements WHERE criteria_type = 'listening_hours'").all()
        for (const ach of listenAchievements) {
            if (listenHours >= ach.criteria_value) {
                dbUnlockAchievement(userJid, ach.achievement_id)
            }
        }
    } catch (err) {
        botLogger.error('radio-db', `Failed to evaluate achievements for ${userJid}: ${err.message}`)
    }
}

export function dbUnlockAchievement(userJid, achievementId) {
    try {
        db.prepare(`
            INSERT INTO achievement_unlocks (user_jid, achievement_id, unlocked_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(user_jid, achievement_id) DO NOTHING
        `).run(userJid, achievementId)
    } catch (_) {}
}

// ─────────────────────────────────────────────
// TRACK MODEL
// ─────────────────────────────────────────────

export class Track {
    constructor({ title, url, duration, thumbnail, requestedBy, source, songId, artist, requestedByJid, startSeek }) {
        this.title = title
        this.url = url
        this.duration = duration
        this.thumbnail = thumbnail
        this.requestedBy = requestedBy
        this.requestedByJid = requestedByJid || null
        this.source = source || 'unknown' // 'youtube' | 'soundcloud' | 'unknown'
        this.addedAt = Date.now()
        this.songId = songId || getSongId(url, this.source)
        this.artist = artist || 'Unknown'
        this.startSeek = startSeek || 0
    }

    get durationFormatted() {
        if (!this.duration) return 'LIVE'
        const m = Math.floor(this.duration / 60)
        const s = this.duration % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }
}

// ─────────────────────────────────────────────
// RADIO SERVICE
// ─────────────────────────────────────────────

class RadioService extends EventEmitter {
    #queue = []
    #currentTrack = null
    #ffmpeg = null
    #clients = new Set()
    #isPlaying = false
    #activeFx = 'normal'
    #activeEq = 'flat'
    #skipRequested = false
    #playTimeout = null
    #currentStream = null   // play-dl stream reference untuk cleanup
    
    // Status sinkronisasi Spotify owner aktif
    spotifySyncActive = false

    constructor() {
        super()
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true })
    }

    get isPlaying() { return this.#isPlaying }
    get currentTrack() { return this.#currentTrack }
    get queue() { return [...this.#queue] }
    get listenerCount() { return this.#clients.size }
    get activeFx() { return this.#activeFx }
    get activeEq() { return this.#activeEq }
    get isFfmpegActive() { return this.#ffmpeg !== null }

    // ─────────────────────────────────────────────
    // SEARCH & EXTRACTION (YouTube via yt-dlp + SoundCloud fallback)
    // ─────────────────────────────────────────────
    // Priority: YouTube (yt-dlp binary) → SoundCloud (play-dl) fallback
    // yt-dlp punya anti-throttle & cipher solver yang lebih canggih dari play-dl

    async search(query, requestedByJid, requestedByName = null) {
        const playdl = await getPlayDl()
        const isUrl = /^https?:\/\//.test(query)
        const isYoutubeUrl = /(?:youtube\.com|youtu\.be)/.test(query)
        const display = requestedByName || (requestedByJid ? (requestedByJid.includes('@') ? requestedByJid.split('@')[0] : requestedByJid) : 'Unknown')

        // ── Strategy 1: YouTube URL langsung → yt-dlp ──
        if (isYoutubeUrl) {
            botLogger.info('radio', `YouTube URL detected, using yt-dlp: ${query}`)
            try {
                const info = await this.#ytdlpGetInfo(query)
                return new Track({ ...info, requestedBy: display, requestedByJid, source: 'youtube' })
            } catch (e) {
                botLogger.warn('radio', `yt-dlp gagal untuk URL: ${e.message}`)
                // Fallback ke SoundCloud search via judul
            }
        }

        // ── Strategy 2: Text query → YouTube search (play-dl) + yt-dlp extract ──
        if (!isUrl) {
            try {
                botLogger.info('radio', `Searching YouTube: ${query}`)
                const ytResults = await playdl.search(query, { limit: 1, source: { youtube: 'video' } })
                if (ytResults?.length > 0) {
                    const v = ytResults[0]
                    const ytUrl = `https://www.youtube.com/watch?v=${v.id}`
                    botLogger.info('radio', `YouTube found: ${v.title} → ${ytUrl}`)
                    return new Track({
                        title: v.title || 'Unknown',
                        url: ytUrl,
                        duration: v.durationInSec || 0,
                        thumbnail: v.thumbnails?.[0]?.url || null,
                        requestedBy: display,
                        requestedByJid,
                        source: 'youtube'
                    })
                }
            } catch (e) {
                botLogger.warn('radio', `YouTube search gagal: ${e.message}`)
            }
        }

        // ── Strategy 3: SoundCloud fallback ──
        botLogger.info('radio', `Fallback ke SoundCloud: ${query}`)
        try {
            const clientId = await playdl.getFreeClientID()
            await playdl.setToken({ soundcloud: { client_id: clientId } })
        } catch (e) {
            botLogger.warn('radio', `Gagal set SC Client ID: ${e.message}. Menggunakan default client_id.`)
            try {
                await playdl.setToken({ soundcloud: { client_id: 'Yks9HNwSpw5Bo7goMq3jv8cyDYgoLpZr' } })
            } catch (_) { }
        }

        let searchQuery = query
        // Kalau YouTube URL tapi yt-dlp gagal, coba ambil judul untuk SC search
        if (isYoutubeUrl) {
            try {
                const info = await playdl.video_info(query)
                searchQuery = info.video_details?.title || query
                botLogger.info('radio', `YT title untuk SC search: ${searchQuery}`)
            } catch (_) { }
        }

        const scResults = await playdl.search(searchQuery, { source: { soundcloud: 'tracks' }, limit: 1 })
        if (!scResults || scResults.length === 0) {
            throw new Error(`Tidak ditemukan di YouTube maupun SoundCloud: ${query}`)
        }

        const sc = scResults[0]
        return new Track({
            url: sc.url,
            title: sc.name + ' (SC)',
            duration: sc.durationInSec,
            thumbnail: sc.thumbnail || null,
            requestedBy: display,
            requestedByJid,
            source: 'soundcloud'
        })
    }

    /**
     * Get track info via yt-dlp --dump-json (judul, durasi, thumbnail)
     */
    async #ytdlpGetInfo(url) {
        const ytdlpPath = getYtdlpPath()
        if (!ytdlpPath) throw new Error('yt-dlp binary tidak tersedia')

        return new Promise((resolve, reject) => {
            const proc = spawn(ytdlpPath, [
                '--no-playlist', '--dump-json', '--no-warnings', '--quiet', url
            ])
            let output = '', errOutput = ''
            proc.stdout.on('data', d => output += d.toString())
            proc.stderr.on('data', d => errOutput += d.toString())
            proc.on('close', code => {
                if (code !== 0) return reject(new Error(`yt-dlp info gagal: ${errOutput.slice(0, 200)}`))
                try {
                    const data = JSON.parse(output)
                    resolve({
                        title: data.title || data.fulltitle || 'Unknown',
                        url: url,
                        duration: data.duration ? Math.round(data.duration) : 0,
                        thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || null,
                    })
                } catch (e) {
                    reject(new Error(`yt-dlp JSON parse error: ${e.message}`))
                }
            })
            proc.on('error', e => reject(new Error(`yt-dlp spawn error: ${e.message}`)))
            setTimeout(() => { proc.kill(); reject(new Error('yt-dlp info timeout (15s)')) }, 15_000)
        })
    }

    async searchBatch(queries, requestedByJid, requestedByName = null) {
        const results = []
        for (const q of queries) {
            try {
                results.push({ track: await this.search(q.trim(), requestedByJid, requestedByName), error: null })
            } catch (err) {
                results.push({ track: null, error: err.message, query: q })
            }
        }
        return results
    }

    // ─────────────────────────────────────────────
    // QUEUE
    // ─────────────────────────────────────────────

    addToQueue(track, correlationId = null, bypassSyncActive = false) {
        if (this.spotifySyncActive && !bypassSyncActive) {
            throw new Error('Antrean radio sedang dikunci karena sinkronisasi Spotify Owner aktif.')
        }
        if (this.#queue.length >= MAX_QUEUE) throw new Error(`Queue penuh (max ${MAX_QUEUE}).`)
        
        // Save song metadata to DB
        dbUpsertSong(track)

        this.#queue.push(track)

        // Save request record to DB
        try {
            const requestedByJid = track.requestedByJid || track.requestedBy
            if (requestedByJid && requestedByJid.includes('@')) {
                dbEnsureUser(requestedByJid, track.requestedBy && !track.requestedBy.includes('@') ? track.requestedBy : null)
                db.prepare(`
                    INSERT INTO requests (user_jid, song_id, status, created_at)
                    VALUES (?, ?, 'pending', unixepoch())
                `).run(requestedByJid, track.songId)
            }
        } catch (err) {
            botLogger.error('radio-db', `Failed to log queue request: ${err.message}`)
        }

        this.emit('queue:add', track, correlationId)
        botLogger.info('radio', `Queued: ${track.title}`)
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.#queue.length) return null
        const [removed] = this.#queue.splice(index, 1)
        this.emit('queue:clear')
        return removed
    }

    clearQueue() { this.#queue = []; this.emit('queue:clear') }

    // ─────────────────────────────────────────────
    // PLAYBACK ENGINE
    // ─────────────────────────────────────────────

    async #playNext() {
        if (this.#queue.length === 0) {
            this.#isPlaying = false
            this.#currentTrack = null
            this.emit('radio:idle')
            botLogger.info('radio', 'Queue habis, radio idle.')
            return
        }

        this.#currentTrack = this.#queue.shift()
        this.#isPlaying = true
        this.#skipRequested = false

        // Save to song metadata and play history in DB
        dbUpsertSong(this.#currentTrack)
        dbAddPlayHistory(this.#currentTrack.songId, this.#currentTrack.requestedByJid || this.#currentTrack.requestedBy)

        // Update request status to played in DB
        try {
            const requestedByJid = this.#currentTrack.requestedByJid || this.#currentTrack.requestedBy
            if (requestedByJid && requestedByJid.includes('@')) {
                db.prepare(`
                    UPDATE requests 
                    SET status = 'played', played_at = unixepoch()
                    WHERE user_jid = ? AND song_id = ? AND status = 'pending'
                `).run(requestedByJid, this.#currentTrack.songId)
                
                // Evaluate achievements
                dbEvaluateAchievements(requestedByJid)
            }
        } catch (err) {
            botLogger.error('radio-db', `Failed to update request status: ${err.message}`)
        }

        this.emit('track:start', this.#currentTrack)
        botLogger.info('radio', `▶ Now playing: ${this.#currentTrack.title}`)

        try {
            const seek = this.#currentTrack.startSeek || 0
            await this.#streamTrack(this.#currentTrack, seek)
        } catch (err) {
            botLogger.err('radio', err, 'streamTrack')
            this.emit('track:error', { track: this.#currentTrack, error: err.message })
        }

        if (this.#isPlaying) {
            await this.#playNext()
        }
    }

    /**
     * Stream pipeline:
     * YouTube tracks:    yt-dlp --get-url → fetchStream(CDN URL) → ffmpeg stdin → broadcast
     * SoundCloud tracks: play-dl.stream → ffmpeg stdin → broadcast
     */
    async #streamTrack(track, seek = 0) {
        return new Promise(async (resolve, reject) => {
            try {
                const filters = [FX_PRESETS[this.#activeFx], EQ_PRESETS[this.#activeEq]].filter(Boolean)

                // Tambahkan efek Fade In selama 3 detik di awal lagu (hanya jika mulai dari 0)
                if (seek === 0) {
                    filters.push('afade=t=in:st=0:d=3')
                }

                // Tambahkan efek Fade Out selama 3 detik di akhir lagu (hanya jika mulai dari 0)
                if (seek === 0 && track.duration && track.duration > 6) {
                    filters.push(`afade=t=out:st=${track.duration - 3}:d=3`)
                }

                // Tambahkan audio FIFO buffer filter jika didukung oleh versi ffmpeg
                if (_isAfifoSupported) {
                    filters.push('afifo')
                }

                const filterStr = filters.join(',')

                botLogger.info('radio', `Memulai streaming untuk: ${track.title} [source: ${track.source || 'unknown'}]`)

                let inputStream = null
                let streamType = 'unknown'

                const isYoutubeTrack = track.source === 'youtube' || /(?:youtube\.com|youtu\.be)/.test(track.url)

                // ── Strategy 1: YouTube → yt-dlp pipe stdout → FFmpeg (Solusi DNS Pterodactyl) ──
                let ytProc = null
                if (isYoutubeTrack) {
                    try {
                        botLogger.info('radio', `[yt-dlp] Membuka stdout pipe untuk: ${track.url}`)
                        const tempYtProc = ytdlpStream(track.url)

                        // Tunggu sampai ada data pertama, atau proses exit (menggunakan 'readable' agar data tidak dikonsumsi)
                        const ok = await new Promise((resolve) => {
                            let resolved = false
                            const onReadable = () => {
                                if (!resolved && tempYtProc.stdout.readableLength > 0) {
                                    resolved = true
                                    cleanup()
                                    resolve(true)
                                }
                            }
                            const onClose = (code) => {
                                if (!resolved) {
                                    resolved = true
                                    cleanup()
                                    resolve(false)
                                }
                            }
                            const onError = () => {
                                if (!resolved) {
                                    resolved = true
                                    cleanup()
                                    resolve(false)
                                }
                            }

                            if (tempYtProc.stdout.readableLength > 0) {
                                resolved = true
                                resolve(true)
                                return
                            }

                            tempYtProc.stdout.on('readable', onReadable)
                            tempYtProc.on('close', onClose)
                            tempYtProc.on('error', onError)

                            // Timeout 3 detik jika tidak ada data sama sekali
                            const timer = setTimeout(() => {
                                if (!resolved) {
                                    resolved = true
                                    cleanup()
                                    resolve(false)
                                }
                            }, 10000)

                            function cleanup() {
                                clearTimeout(timer)
                                tempYtProc.stdout.off('readable', onReadable)
                                tempYtProc.off('close', onClose)
                                tempYtProc.off('error', onError)
                            }
                        })

                        if (ok) {
                            ytProc = tempYtProc
                            inputStream = ytProc.stdout
                            streamType = 'yt-dlp-pipe'
                            botLogger.info('radio', `[yt-dlp] Pipe siap → passing to ffmpeg stdin`)
                        } else {
                            // Ambil seluruh log yang sempat ditangkap dari stderr sebelum proses dimatikan
                            const detailError = tempYtProc.ytdlpLogs && tempYtProc.ytdlpLogs.length > 0
                                ? tempYtProc.ytdlpLogs.join('\n')
                                : 'Tidak ada output dari stderr. Kemungkinan masalah alokasi memory kontainer atau IP Hard-ban.'

                            botLogger.warn('radio', `[yt-dlp] Gagal memproduksi data stream (Pipe error).\n====== DETAIL YT-DLP ERROR ======\n${detailError}\n=================================`)
                            tempYtProc.kill()

                            // ── Strategy 1.1: Hugging Face space downloader fallback ──
                            const hfUrl = process.env.HF_API_URL
                            if (hfUrl) {
                                botLogger.info('radio', `[HF-fallback] Meminta stream audio dari Hugging Face downloader...`)
                                try {
                                    const response = await fetch(`${hfUrl.replace(/\/$/, '')}/download`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ url: track.url, format: 'audio' })
                                    })
                                    if (response.ok) {
                                        const arrayBuffer = await response.arrayBuffer()
                                        const buffer = Buffer.from(arrayBuffer)
                                        const tempFilePath = path.resolve(`./storage/media/temp/radio_${Date.now()}.mp3`)
                                        if (!fs.existsSync(path.dirname(tempFilePath))) {
                                            fs.mkdirSync(path.dirname(tempFilePath), { recursive: true })
                                        }
                                        fs.writeFileSync(tempFilePath, buffer)
                                        inputStream = tempFilePath
                                        streamType = 'hf-downloader-file'
                                        botLogger.info('radio', `[HF-fallback] Sukses download → streaming dari local file: ${tempFilePath}`)
                                    } else {
                                        botLogger.warn('radio', `[HF-fallback] Server HF mengembalikan HTTP ${response.status}`)
                                    }
                                } catch (hfErr) {
                                    botLogger.warn('radio', `[HF-fallback] Gagal: ${hfErr.message}`)
                                }
                            }

                            // ── Strategy 1.2: Local yt-dlp download full file fallback (jika HF gagal/tidak ada) ──
                            if (!inputStream) {
                                botLogger.info('radio', `[Local-download-fallback] Mencoba download full file via yt-dlp...`)
                                try {
                                    const tempFilePath = path.resolve(`./storage/media/temp/radio_${Date.now()}.mp3`)
                                    if (!fs.existsSync(path.dirname(tempFilePath))) {
                                        fs.mkdirSync(path.dirname(tempFilePath), { recursive: true })
                                    }
                                    
                                    const dlArgs = [
                                        '--no-playlist',
                                        '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best[height<=480]/best',
                                        '--extract-audio',
                                        '--audio-format', 'mp3',
                                        '--audio-quality', '128K',
                                        ...getCookieArgs(),
                                        '-o', tempFilePath,
                                        track.url
                                    ]
                                    
                                    const ytdlpPath = getYtdlpPath()
                                    await new Promise((resolveDl, rejectDl) => {
                                        const dlProc = spawn(ytdlpPath, dlArgs)
                                        let dlStderr = ''
                                        dlProc.stderr.on('data', d => dlStderr += d.toString())
                                        dlProc.on('close', code => {
                                            if (code === 0 && fs.existsSync(tempFilePath)) {
                                                resolveDl()
                                            } else {
                                                rejectDl(new Error(`Exit code ${code}: ${dlStderr.slice(0, 150)}`))
                                            }
                                        })
                                        dlProc.on('error', rejectDl)
                                        setTimeout(() => {
                                            dlProc.kill()
                                            rejectDl(new Error('Download timeout'))
                                        }, 60000)
                                    })
                                    
                                    inputStream = tempFilePath
                                    streamType = 'local-download-file'
                                    botLogger.info('radio', `[Local-download-fallback] Sukses download → streaming dari local file: ${tempFilePath}`)
                                } catch (dlErr) {
                                    botLogger.warn('radio', `[Local-download-fallback] Gagal: ${dlErr.message}`)
                                }
                            }
                        }
                    } catch (ytErr) {
                        botLogger.warn('radio', `[yt-dlp] Gagal: ${ytErr.message}`)
                        if (ytProc) { ytProc.kill(); ytProc = null }
                    }
                }

                // ── Strategy 2: SoundCloud fallback (untuk YouTube yang gagal) ──
                if (!inputStream && isYoutubeTrack) {
                    try {
                        const playdl = await getPlayDl()
                        botLogger.info('radio', `[SC-fallback] YouTube gagal, cari "${track.title}" di SoundCloud...`)

                        // Setup SC client ID
                        try {
                            const clientId = await playdl.getFreeClientID()
                            await playdl.setToken({ soundcloud: { client_id: clientId } })
                        } catch (e) {
                            botLogger.warn('radio', `Gagal set SC Client ID: ${e.message}. Menggunakan default client_id.`)
                            try {
                                await playdl.setToken({ soundcloud: { client_id: 'Yks9HNwSpw5Bo7goMq3jv8cyDYgoLpZr' } })
                            } catch (_) { }
                        }

                        const scResults = await playdl.search(track.title, { source: { soundcloud: 'tracks' }, limit: 1 })
                        if (scResults?.length > 0) {
                            const scUrl = scResults[0].url
                            botLogger.info('radio', `[SC-fallback] Found: ${scResults[0].name} → streaming dari SC`)
                            const streamData = await playdl.stream(scUrl)
                            if (streamData?.stream) {
                                inputStream = streamData.stream
                                streamType = `sc-fallback(${streamData.type})`
                            }
                        }
                    } catch (scErr) {
                        botLogger.warn('radio', `[SC-fallback] Gagal: ${scErr.message}`)
                    }
                }

                // ── Strategy 3: play-dl stream langsung (untuk SoundCloud tracks / non-YT URLs) ──
                if (!inputStream) {
                    try {
                        const playdl = await getPlayDl()
                        botLogger.info('radio', `[play-dl] Trying stream: ${track.url}`)
                        const streamData = await playdl.stream(track.url)
                        if (!streamData?.stream) {
                            throw new Error('play-dl stream tidak mengembalikan readable stream.')
                        }
                        inputStream = streamData.stream
                        streamType = `play-dl(${streamData.type})`
                        botLogger.info('radio', `[play-dl] Stream OK: ${streamData.type}`)
                    } catch (pdErr) {
                        return reject(new Error(`Semua metode stream gagal.\nyt-dlp: ${isYoutubeTrack ? 'tried' : 'skipped'}\nSC-fallback: tried\nplay-dl: ${pdErr.message}`))
                    }
                }

                if (this.#skipRequested) {
                    if (ytProc) ytProc.kill()
                    return resolve()
                }

                this.#currentStream = inputStream

                // ── 3. FFmpeg: stdin pipe / direct URL → MP3 stdout ──
                const ffmpegBin = getFfmpegPath()
                const isDirectUrl = typeof inputStream === 'string'

                const ffArgs = [
                    '-thread_queue_size', '4096',
                    // Jika direct URL, pakai fitur auto-reconnect & realtime read dari FFmpeg (sangat kebal putus)
                    ...(isDirectUrl ? [
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '5'
                    ] : []),
                    '-re',
                    '-i', isDirectUrl ? inputStream : 'pipe:0',
                    // Seek di posisi output setelah -i agar bekerja dengan lancar untuk direct URL maupun pipe stdin
                    ...(seek > 0 ? ['-ss', String(seek)] : []),
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', process.env.RADIO_BITRATE || '128k',
                    '-ar', '44100',
                    '-ac', '2',
                ]

                if (filterStr) ffArgs.push('-af', filterStr)
                ffArgs.push('-f', 'mp3', '-loglevel', 'error', 'pipe:1')

                botLogger.info('radio', `FFmpeg starting [${streamType}] → ${ffmpegBin}`)
                const ffProc = spawn(ffmpegBin, ffArgs)
                this.#ffmpeg = ffProc

                // Pipe input stream ke ffmpeg stdin (HANYA JIKA BUKAN DIRECT URL)
                if (!isDirectUrl) {
                    inputStream.pipe(ffProc.stdin)
                    inputStream.on('error', e => {
                        botLogger.err('radio', e, 'input stream error')
                        ffProc.kill()
                    })
                }

                ffProc.stdin.on('error', () => { /* normal saat skip */ })

                // ── 4. Broadcast stdout ──
                ffProc.stdout.on('data', chunk => this.#broadcast(chunk))

                ffProc.stderr.on('data', d => {
                    const msg = d.toString().trim()
                    if (msg) botLogger.debug('ffmpeg', msg)
                })

                ffProc.on('close', code => {
                    this.#ffmpeg = null
                    if (ytProc) {
                        botLogger.debug('ytdlp', 'Membersihkan proses yt-dlp setelah ffmpeg close.')
                        ytProc.kill()
                    }
                    if (code === 0 || this.#skipRequested) resolve()
                    else reject(new Error(`FFmpeg exit code ${code}`))
                })

                ffProc.on('error', e => {
                    if (e.code === 'ENOENT') {
                        reject(new Error(
                            'FFmpeg tidak ditemukan.\n' +
                            'Download: https://johnvansickle.com/ffmpeg/ → simpan ke storage/bin/ffmpeg'
                        ))
                    } else {
                        reject(new Error(`FFmpeg error: ${e.message}`))
                    }
                })

                // Timeout safety (Megamix & Live Stream friendly)
                const duration = track.duration || 43200 // Default 12 jam jika live/unknown
                const maxMs = Math.min(duration + 180, 86400) * 1000 // Maks 24 jam
                this.#playTimeout = setTimeout(() => {
                    botLogger.warn('radio', `Timeout: ${track.title}`)
                    this.#killProcesses()
                    resolve()
                }, maxMs)

            } catch (err) {
                reject(err)
            }
        }).finally(() => {
            clearTimeout(this.#playTimeout)
            // Bersihkan file streaming lokal (jika ada)
            if (typeof inputStream === 'string' && (inputStream.includes('radio_') || inputStream.includes('radio_temp'))) {
                try {
                    if (fs.existsSync(inputStream)) {
                        fs.unlinkSync(inputStream)
                        botLogger.info('radio', `Membersihkan file streaming lokal: ${inputStream}`)
                    }
                } catch (e) {
                    botLogger.warn('radio', `Gagal menghapus file stream lokal: ${e.message}`)
                }
            }
        })
    }

    #broadcast(chunk) {
        for (const client of this.#clients) {
            if (client.destroyed || !client.writable) {
                this.#clients.delete(client)
                continue
            }
            try { client.write(chunk) }
            catch { this.#clients.delete(client) }
        }
    }

    // ─────────────────────────────────────────────
    // CONTROLS
    // ─────────────────────────────────────────────

    async start() {
        if (this.#isPlaying) return
        await this.#playNext()
    }

    async skip() {
        if (!this.#isPlaying) return false
        this.#skipRequested = true
        this.#killProcesses()
        await new Promise(r => setTimeout(r, 200))
        return true
    }

    async restartCurrent() {
        if (!this.#isPlaying || !this.#currentTrack) return false
        this.#queue.unshift(this.#currentTrack)
        this.#skipRequested = true
        this.#killProcesses()
        await new Promise(r => setTimeout(r, 200))
        return true
    }

    stop() {
        this.#skipRequested = true
        this.#killProcesses()
        this.#queue = []
        this.#currentTrack = null
        this.#isPlaying = false
        this.emit('radio:stop')
        botLogger.info('radio', 'Stopped.')
    }

    setFx(name) {
        if (!Object.hasOwn(FX_PRESETS, name))
            throw new Error(`FX tidak dikenal: ${name}. Tersedia: ${Object.keys(FX_PRESETS).join(', ')}`)
        this.#activeFx = name
        this.emit('fx:change', name)
    }

    setEq(name) {
        if (!Object.hasOwn(EQ_PRESETS, name))
            throw new Error(`EQ tidak dikenal: ${name}. Tersedia: ${Object.keys(EQ_PRESETS).join(', ')}`)
        this.#activeEq = name
        this.emit('eq:change', name)
    }

    addClient(res, userJid = null) {
        if (userJid && userJid !== 'anonymous') {
            for (const client of this.#clients) {
                if (client.userJid === userJid) {
                    botLogger.info('radio', `Closing duplicate stream connection for JID: ${userJid}`)
                    try {
                        client.write(JSON.stringify({ error: 'Sesi streaming baru telah dibuka di perangkat lain.' }))
                        client.end()
                    } catch (_) {}
                    this.#clients.delete(client)
                }
            }
            res.userJid = userJid
        } else if (userJid === 'anonymous') {
            res.userJid = 'anonymous'
        }
        this.#clients.add(res)
        this.emit('listener:join', this.#clients.size)

        let sessionId = null
        const joinedAt = Math.floor(Date.now() / 1000)

        if (userJid && userJid.includes('@')) {
            try {
                dbEnsureUser(userJid)
                const result = db.prepare(`
                    INSERT INTO listening_sessions (user_jid, joined_at)
                    VALUES (?, ?)
                `).run(userJid, joinedAt)
                sessionId = result.lastInsertRowid
            } catch (err) {
                botLogger.error('radio-db', `Failed to start listening session: ${err.message}`)
            }
        }

        const cleanup = () => {
            this.#clients.delete(res)
            this.emit('listener:leave', this.#clients.size)

            if (sessionId) {
                try {
                    const leftAt = Math.floor(Date.now() / 1000)
                    const duration = leftAt - joinedAt
                    db.prepare(`
                        UPDATE listening_sessions
                        SET left_at = ?, duration_seconds = ?
                        WHERE id = ?
                    `).run(leftAt, duration, sessionId)

                    if (duration > 10) {
                        const xpEarned = Math.max(1, Math.floor(duration / 60))
                        db.prepare(`
                            UPDATE users
                            SET experience_points = experience_points + ?
                            WHERE jid = ?
                        `).run(xpEarned, userJid)

                        const userData = db.prepare('SELECT experience_points, level FROM users WHERE jid = ?').get(userJid)
                        if (userData) {
                            const newLevel = Math.floor(Math.sqrt(userData.experience_points / 100)) + 1
                            if (newLevel > userData.level) {
                                db.prepare('UPDATE users SET level = ? WHERE jid = ?').run(newLevel, userJid)
                                botLogger.info('radio-level', `User ${userJid} naik level ke ${newLevel}!`)
                            }
                        }
                    }

                    dbEvaluateAchievements(userJid)
                } catch (err) {
                    botLogger.error('radio-db', `Failed to close listening session ${sessionId}: ${err.message}`)
                }
            }
        }
        res.on('close', cleanup)
        res.on('error', cleanup)
        res.on('finish', cleanup)
    }

    #killProcesses() {
        clearTimeout(this.#playTimeout)
        try { this.#currentStream?.destroy?.() } catch (_) { }
        try { this.#ffmpeg?.kill('SIGKILL') } catch (_) { }
        this.#ffmpeg = null
        this.#currentStream = null
    }

    getNowPlayingInfo() {
        if (!this.#currentTrack) return null
        return {
            track: this.#currentTrack,
            queue: this.#queue.length,
            listeners: this.#clients.size,
            fx: this.#activeFx,
            eq: this.#activeEq,
        }
    }

    destroy() {
        this.stop()
        for (const client of this.#clients) {
            try { client.end() } catch (_) { }
        }
        this.#clients.clear()
    }
}

export const radioService = new RadioService()

process.on('SIGTERM', () => radioService.destroy())
process.on('SIGINT', () => radioService.destroy())

export const AVAILABLE_FX = Object.keys(FX_PRESETS)
export const AVAILABLE_EQ = Object.keys(EQ_PRESETS)

// ─────────────────────────────────────────────
// FAVORITES DATABASE HELPERS
// ─────────────────────────────────────────────

export function dbAddFavorite(userJid, songId) {
    try {
        dbEnsureUser(userJid)
        db.prepare(`
            INSERT INTO favorites (user_jid, song_id, created_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(user_jid, song_id) DO NOTHING
        `).run(userJid, songId)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to add favorite: ${err.message}`)
        return false
    }
}

export function dbRemoveFavorite(userJid, songId) {
    try {
        db.prepare(`
            DELETE FROM favorites
            WHERE user_jid = ? AND song_id = ?
        `).run(userJid, songId)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to remove favorite: ${err.message}`)
        return false
    }
}

export function dbGetFavorites(userJid) {
    try {
        dbEnsureUser(userJid)
        return db.prepare(`
            SELECT s.* FROM favorites f
            JOIN songs s ON f.song_id = s.song_id
            WHERE f.user_jid = ?
            ORDER BY f.created_at DESC
        `).all(userJid)
    } catch (err) {
        botLogger.error('radio-db', `Failed to get favorites: ${err.message}`)
        return []
    }
}

export function dbIsFavorite(userJid, songId) {
    try {
        const row = db.prepare(`
            SELECT 1 FROM favorites
            WHERE user_jid = ? AND song_id = ?
        `).get(userJid, songId)
        return !!row
    } catch (err) {
        botLogger.error('radio-db', `Failed to check favorite: ${err.message}`)
        return false
    }
}

export function dbCreatePlaylist(userJid, name, description = null) {
    try {
        dbEnsureUser(userJid)
        const existing = db.prepare('SELECT id FROM playlists WHERE user_jid = ? AND name = ? COLLATE NOCASE').get(userJid, name)
        if (existing) throw new Error(`Playlist "${name}" sudah ada.`)
        
        db.prepare('INSERT INTO playlists (user_jid, name, description) VALUES (?, ?, ?)')
            .run(userJid, name, description)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to create playlist: ${err.message}`)
        throw err
    }
}

export function dbAddSongToPlaylist(userJid, playlistName, songId) {
    try {
        dbEnsureUser(userJid)
        const pl = db.prepare('SELECT id FROM playlists WHERE user_jid = ? AND name = ? COLLATE NOCASE').get(userJid, playlistName)
        if (!pl) throw new Error(`Playlist "${playlistName}" tidak ditemukan.`)
        
        const existing = db.prepare('SELECT 1 FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').get(pl.id, songId)
        if (existing) throw new Error(`Lagu sudah ada di playlist "${playlistName}".`)

        db.prepare('INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)')
            .run(pl.id, songId)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to add song to playlist: ${err.message}`)
        throw err
    }
}

export function dbRemoveSongFromPlaylist(userJid, playlistName, songIndex) {
    try {
        const pl = db.prepare('SELECT id FROM playlists WHERE user_jid = ? AND name = ? COLLATE NOCASE').get(userJid, playlistName)
        if (!pl) throw new Error(`Playlist "${playlistName}" tidak ditemukan.`)

        const songs = db.prepare('SELECT song_id FROM playlist_songs WHERE playlist_id = ? ORDER BY added_at ASC').all(pl.id)
        if (songIndex < 0 || songIndex >= songs.length) throw new Error(`Nomor urutan lagu tidak valid.`)

        const targetSongId = songs[songIndex].song_id
        db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').run(pl.id, targetSongId)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to remove song from playlist: ${err.message}`)
        throw err
    }
}

export function dbGetPlaylists(userJid) {
    try {
        return db.prepare('SELECT * FROM playlists WHERE user_jid = ? ORDER BY created_at DESC').all(userJid)
    } catch (err) {
        botLogger.error('radio-db', `Failed to get playlists: ${err.message}`)
        return []
    }
}

export function dbGetPlaylistSongs(userJid, playlistName) {
    try {
        const pl = db.prepare('SELECT id FROM playlists WHERE user_jid = ? AND name = ? COLLATE NOCASE').get(userJid, playlistName)
        if (!pl) return null
        
        return db.prepare(`
            SELECT s.* FROM playlist_songs ps
            JOIN songs s ON ps.song_id = s.song_id
            WHERE ps.playlist_id = ?
            ORDER BY ps.added_at ASC
        `).all(pl.id)
    } catch (err) {
        botLogger.error('radio-db', `Failed to get playlist songs: ${err.message}`)
        return []
    }
}

export function dbDeletePlaylist(userJid, playlistName) {
    try {
        const pl = db.prepare('SELECT id FROM playlists WHERE user_jid = ? AND name = ? COLLATE NOCASE').get(userJid, playlistName)
        if (!pl) throw new Error(`Playlist "${playlistName}" tidak ditemukan.`)
        db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id)
        return true
    } catch (err) {
        botLogger.error('radio-db', `Failed to delete playlist: ${err.message}`)
        throw err
    }
}