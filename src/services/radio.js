// src/services/radio.js
// RadioService — Live Radio Streaming Engine
// Architecture: yt-dlp (YouTube extract) → FFmpeg stdin pipe → HTTP broadcast
// Fallback: SoundCloud via play-dl jika YouTube/yt-dlp gagal

import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { botLogger } from '../utils/logger.js'
import { getYtdlpPath, ytdlpGetAudioUrl, ytdlpStream } from './ytdlp.js'

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

    // Source 1: File JSON
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
// TRACK MODEL
// ─────────────────────────────────────────────

class Track {
    constructor({ title, url, duration, thumbnail, requestedBy, source }) {
        this.title = title
        this.url = url
        this.duration = duration
        this.thumbnail = thumbnail
        this.requestedBy = requestedBy
        this.source = source || 'unknown' // 'youtube' | 'soundcloud' | 'unknown'
        this.addedAt = Date.now()
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

    async search(query, requestedBy) {
        const playdl = await getPlayDl()
        const isUrl = /^https?:\/\//.test(query)
        const isYoutubeUrl = /(?:youtube\.com|youtu\.be)/.test(query)

        // ── Strategy 1: YouTube URL langsung → yt-dlp ──
        if (isYoutubeUrl) {
            botLogger.info('radio', `YouTube URL detected, using yt-dlp: ${query}`)
            try {
                const info = await this.#ytdlpGetInfo(query)
                return new Track({ ...info, requestedBy, source: 'youtube' })
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
                        requestedBy,
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
            botLogger.warn('radio', `Gagal set SC Client ID: ${e.message}`)
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
            requestedBy,
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

    async searchBatch(queries, requestedBy) {
        const results = []
        for (const q of queries) {
            try {
                results.push({ track: await this.search(q.trim(), requestedBy), error: null })
            } catch (err) {
                results.push({ track: null, error: err.message, query: q })
            }
        }
        return results
    }

    // ─────────────────────────────────────────────
    // QUEUE
    // ─────────────────────────────────────────────

    addToQueue(track) {
        if (this.#queue.length >= MAX_QUEUE) throw new Error(`Queue penuh (max ${MAX_QUEUE}).`)
        this.#queue.push(track)
        this.emit('queue:add', track)
        botLogger.info('radio', `Queued: ${track.title}`)
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.#queue.length) return null
        const [removed] = this.#queue.splice(index, 1)
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
        this.emit('track:start', this.#currentTrack)
        botLogger.info('radio', `▶ Now playing: ${this.#currentTrack.title}`)

        try {
            await this.#streamTrack(this.#currentTrack)
        } catch (err) {
            botLogger.err('radio', err, 'streamTrack')
            this.emit('track:error', { track: this.#currentTrack, error: err.message })
        }

        if (!this.#skipRequested) await this.#playNext()
    }

    /**
     * Stream pipeline:
     * YouTube tracks:    yt-dlp --get-url → fetchStream(CDN URL) → ffmpeg stdin → broadcast
     * SoundCloud tracks: play-dl.stream → ffmpeg stdin → broadcast
     */
    async #streamTrack(track) {
        return new Promise(async (resolve, reject) => {
            try {
                const filters = [FX_PRESETS[this.#activeFx], EQ_PRESETS[this.#activeEq]].filter(Boolean)
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
                        ytProc = ytdlpStream(track.url)

                        inputStream = ytProc.stdout
                        streamType = 'yt-dlp-pipe'
                        botLogger.info('radio', `[yt-dlp] Pipe siap → passing to ffmpeg stdin`)
                    } catch (ytErr) {
                        botLogger.warn('radio', `[yt-dlp] Gagal: ${ytErr.message}`)
                        botLogger.info('radio', `[yt-dlp] Falling back to play-dl stream...`)
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
                        } catch (_) { }

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
                    // Jika direct URL, pakai fitur auto-reconnect dari FFmpeg (sangat kebal putus)
                    ...(isDirectUrl ? [
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '5'
                    ] : []),
                    '-re',
                    '-i', isDirectUrl ? inputStream : 'pipe:0',
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', '128k',
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

                // Timeout safety
                const maxMs = Math.min((track.duration || 600) + 60, 720) * 1000
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
        await new Promise(r => setTimeout(r, 300))
        await this.#playNext()
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

    addClient(res) {
        this.#clients.add(res)
        this.emit('listener:join', this.#clients.size)
        const cleanup = () => {
            this.#clients.delete(res)
            this.emit('listener:leave', this.#clients.size)
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