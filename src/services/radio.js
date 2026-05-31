// src/services/radio.js
// RadioService — Live Radio Streaming Engine
// Architecture: play-dl.stream() → pipe stdin → FFmpeg → HTTP chunked stream

import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'

// ─────────────────────────────────────────────
// PLAY-DL HELPERS
// ─────────────────────────────────────────────

async function getPlayDl() {
    try {
        const mod = await import('play-dl')
        return mod.default ?? mod
    } catch (e) {
        throw new Error(`play-dl belum terinstall: ${e.message}`)
    }
}

/**
 * Search YouTube — return { title, url, duration, thumbnail }
 */
async function youtubeSearch(query) {
    const playdl = await getPlayDl()
    const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } })
    if (!results?.length) throw new Error('Lagu tidak ditemukan.')
    const v = results[0]
    return {
        title: v.title || 'Unknown',
        url: `https://www.youtube.com/watch?v=${v.id}`,
        duration: v.durationInSec || 0,
        thumbnail: v.thumbnails?.[0]?.url || null
    }
}

/**
 * Get info dari URL langsung
 */
async function youtubeGetInfo(url) {
    const playdl = await getPlayDl()
    const info = await playdl.video_info(url)
    const d = info.video_details
    return {
        title: d.title || 'Unknown',
        url: `https://www.youtube.com/watch?v=${d.id}`,
        duration: d.durationInSec || 0,
        thumbnail: d.thumbnails?.[0]?.url || null
    }
}

/**
 * Stream audio dari YouTube via play-dl.stream()
 * Return: Node.js Readable stream (piped langsung ke FFmpeg stdin)
 * 
 * Ini lebih reliable dari video_info → format URL karena:
 * - CDN URL dari format sudah dihandle play-dl internaly
 * - Tidak perlu reconstruct URL yang expired
 */
async function youtubeStream(url) {
    const playdl = await getPlayDl()

    // Pastikan play-dl tidak butuh auth untuk video publik
    let stream
    try {
        stream = await playdl.stream(url, {
            quality: 2,         // 0=highest, 2=medium — lebih stabil untuk streaming
            discordPlayerCompatibility: false
        })
    } catch (firstErr) {
        // Fallback: coba tanpa options
        try {
            stream = await playdl.stream(url)
        } catch (secondErr) {
            throw new Error(`play-dl stream gagal: ${secondErr.message}`)
        }
    }

    if (!stream?.stream) throw new Error('play-dl tidak return stream valid.')
    return stream.stream  // Node.js Readable
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
    #ytStream = null      // play-dl Readable stream
    #clients = new Set()
    #isPlaying = false
    #activeFx = 'normal'
    #activeEq = 'flat'
    #skipRequested = false
    #playTimeout = null

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
                const track = await this.search(q.trim(), requestedBy)
                results.push({ track, error: null })
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
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.#queue.length) return null
        const [removed] = this.#queue.splice(index, 1)
        return removed
    }

    clearQueue() {
        this.#queue = []
        this.emit('queue:clear')
    }

    // ─────────────────────────────────────────────
    // PLAYBACK
    // ─────────────────────────────────────────────

    async #playNext() {
        if (this.#queue.length === 0) {
            this.#isPlaying = false
            this.#currentTrack = null
            this.emit('radio:idle')
            return
        }

        this.#currentTrack = this.#queue.shift()
        this.#isPlaying = true
        this.#skipRequested = false
        this.emit('track:start', this.#currentTrack)
        console.log(`\x1b[36m[Radio] ▶ Now playing: ${this.#currentTrack.title}\x1b[0m`)

        try {
            await this.#streamTrack(this.#currentTrack)
        } catch (err) {
            console.error(`\x1b[31m[Radio] Stream error: ${err.message}\x1b[0m`)
            this.emit('track:error', { track: this.#currentTrack, error: err.message })
        }

        if (!this.#skipRequested) await this.#playNext()
    }

    /**
     * Stream track: play-dl.stream() → pipe ke FFmpeg stdin → broadcast ke HTTP clients
     * 
     * Kenapa pipe stdin bukan -i URL:
     * - YouTube CDN URL expire dalam hitungan detik
     * - play-dl handle renewal otomatis via pipe
     * - Lebih stabil untuk long-running streams
     */
    async #streamTrack(track) {
        return new Promise(async (resolve, reject) => {
            try {
                // Build filter chain
                const filters = [
                    FX_PRESETS[this.#activeFx],
                    EQ_PRESETS[this.#activeEq]
                ].filter(Boolean)
                const filterStr = filters.join(',')

                // Ambil stream dari play-dl
                console.log(`\x1b[90m[Radio] Getting stream for: ${track.url}\x1b[0m`)
                const ytReadable = await youtubeStream(track.url)
                this.#ytStream = ytReadable

                // FFmpeg: baca dari stdin (pipe dari play-dl)
                const ffArgs = [
                    '-i', 'pipe:0',        // baca dari stdin
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', '128k',
                    '-ar', '44100',
                    '-ac', '2',
                ]
                if (filterStr) ffArgs.push('-af', filterStr)
                ffArgs.push('-f', 'mp3', '-loglevel', 'error', 'pipe:1')

                const ffProc = spawn('ffmpeg', ffArgs, {
                    env: {
                        ...process.env,
                        // Inject storage/bin ke PATH supaya ffmpeg static binary ketemu
                        PATH: `${path.resolve('./storage/bin')}:${process.env.PATH}`
                    }
                })
                this.#ffmpeg = ffProc

                // Pipe play-dl → ffmpeg stdin
                ytReadable.pipe(ffProc.stdin)

                // Handle backpressure
                ytReadable.on('error', (err) => {
                    console.error(`\x1b[31m[Radio] YT stream error: ${err.message}\x1b[0m`)
                    ffProc.stdin?.destroy()
                })

                ffProc.stdin?.on('error', () => {
                    // stdin error biasanya karena ffmpeg sudah exit — ignore
                })

                // Broadcast output ke semua listener
                ffProc.stdout.on('data', chunk => this.#broadcast(chunk))

                ffProc.stderr.on('data', d => {
                    const msg = d.toString().trim()
                    if (msg) console.log(`\x1b[33m[FFmpeg] ${msg}\x1b[0m`)
                })

                ffProc.on('close', (code) => {
                    this.#ffmpeg = null
                    this.#ytStream = null
                    if (code === 0 || this.#skipRequested) resolve()
                    else reject(new Error(`FFmpeg exit ${code}`))
                })

                ffProc.on('error', e => reject(new Error(`FFmpeg error: ${e.message}`)))

                // Timeout safety
                const maxMs = Math.min((track.duration || 600) + 60, 720) * 1000
                this.#playTimeout = setTimeout(() => {
                    console.warn(`[Radio] Timeout: ${track.title}`)
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
    }

    setFx(name) {
        if (!FX_PRESETS.hasOwnProperty(name))
            throw new Error(`FX tidak dikenal: ${name}. Tersedia: ${Object.keys(FX_PRESETS).join(', ')}`)
        this.#activeFx = name
        this.emit('fx:change', name)
    }

    setEq(name) {
        if (!EQ_PRESETS.hasOwnProperty(name))
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
        try { this.#ytStream?.destroy() } catch (_) { }
        try { this.#ffmpeg?.kill('SIGKILL') } catch (_) { }
        this.#ffmpeg = null
        this.#ytStream = null
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