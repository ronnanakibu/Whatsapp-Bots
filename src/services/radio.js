// src/services/radio.js
// RadioService — Live Radio Streaming Engine
// Architecture: play-dl (search + stream) → FFmpeg stdin pipe → HTTP broadcast
// NO yt-dlp dependency — pure Node.js

import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { botLogger } from '../utils/logger.js'

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
    return { url: best.url, mimeType: best.mimeType ?? 'audio/mp4' }
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
    constructor({ title, url, duration, thumbnail, requestedBy }) {
        this.title = title
        this.url = url
        this.duration = duration
        this.thumbnail = thumbnail
        this.requestedBy = requestedBy
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

    // ─────────────────────────────────────────────
    // SEARCH
    // ─────────────────────────────────────────────

    async search(query, requestedBy) {
        const isUrl = /^https?:\/\//.test(query)
        const info = isUrl ? await youtubeGetInfo(query) : await youtubeSearch(query)
        return new Track({ ...info, requestedBy })
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
     * Stream pipeline (no yt-dlp):
     * play-dl.stream(url) → Readable → ffmpeg stdin → ffmpeg stdout → broadcast
     *
     * Keunggulan vs yt-dlp approach:
     * - Tidak butuh binary eksternal apapun
     * - Works di semua environment (Pterodactyl, Railway, Heroku, dll)
     * - play-dl handle auth & token refresh otomatis
     */
    async #streamTrack(track) {
        return new Promise(async (resolve, reject) => {
            try {
                const filters = [FX_PRESETS[this.#activeFx], EQ_PRESETS[this.#activeEq]].filter(Boolean)
                const filterStr = filters.join(',')

                // ── 1. Extract CDN URL via play-dl ──
                let audioInfo
                try {
                    audioInfo = await getAudioUrl(track.url)
                } catch (e) {
                    return reject(new Error(`Gagal extract audio URL: ${e.message}`))
                }

                if (this.#skipRequested) return resolve()

                // ── 2. FFmpeg: CDN URL → MP3 stdout ──
                const ffmpegBin = getFfmpegPath()
                const ffArgs = [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-i', audioInfo.url,
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', '128k',
                    '-ar', '44100',
                    '-ac', '2',
                ]

                if (filterStr) ffArgs.push('-af', filterStr)
                ffArgs.push('-f', 'mp3', '-loglevel', 'error', 'pipe:1')

                botLogger.info('radio', `FFmpeg starting → ${ffmpegBin}`)
                const ffProc = spawn(ffmpegBin, ffArgs)
                this.#ffmpeg = ffProc

                // ── 3. Broadcast stdout ──
                ffProc.stdout.on('data', chunk => this.#broadcast(chunk))

                ffProc.stderr.on('data', d => {
                    const msg = d.toString().trim()
                    if (msg) botLogger.debug('ffmpeg', msg)
                })

                ffProc.on('close', code => {
                    this.#ffmpeg = null
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