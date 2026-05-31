// src/services/radio.js
// RadioService — Live Radio Streaming Engine
// Architecture: play-dl (search) + yt-dlp (stream URL) + FFmpeg (transcode) → HTTP


import { ytdlpGetAudioUrl, ensureYtdlp } from './ytdlp.js'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'


// ─────────────────────────────────────────────
// PLAY-DL — search only
// ─────────────────────────────────────────────

async function getPlayDl() {
    try {
        const mod = await import('play-dl')
        return mod.default ?? mod
    } catch (e) {
        throw new Error(`play-dl belum terinstall: ${e.message}`)
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
        thumbnail: v.thumbnails?.[0]?.url || null
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
        thumbnail: d.thumbnails?.[0]?.url || null
    }
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

    constructor() {
        super()
        ensureYtdlp().catch(err => console.error('[Radio] ensureYtdlp error:', err.message))
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true })
    }

    get isPlaying() { return this.#isPlaying }
    get currentTrack() { return this.#currentTrack }
    get queue() { return [...this.#queue] }
    get listenerCount() { return this.#clients.size }
    get activeFx() { return this.#activeFx }
    get activeEq() { return this.#activeEq }

    // ─────────────────────────────────────────────
    // SEARCH — via play-dl
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
        logger.info(`[Radio] Queued: ${track.title}`)
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
            logger.info('[Radio] Queue habis, radio idle.')
            return
        }

        this.#currentTrack = this.#queue.shift()
        this.#isPlaying = true
        this.#skipRequested = false
        this.emit('track:start', this.#currentTrack)
        console.log(`\x1b[36m[Radio] ▶ ${this.#currentTrack.title}\x1b[0m`)

        try {
            await this.#streamTrack(this.#currentTrack)
        } catch (err) {
            console.error(`\x1b[31m[Radio] Stream error: ${err.message}\x1b[0m`)
            this.emit('track:error', { track: this.#currentTrack, error: err.message })
        }

        if (!this.#skipRequested) await this.#playNext()
    }

    /**
     * Stream pipeline:
     * yt-dlp --get-url → CDN URL → ffmpeg -i [CDN URL] → stdout → broadcast
     * 
     * Kenapa -i URL bukan pipe:
     * CDN URL dari yt-dlp punya token yang valid lebih lama (~6 jam)
     * dan FFmpeg support HTTP reconnect (-reconnect flags) untuk URL
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

                // yt-dlp: extract fresh CDN audio URL
                const audioUrl = await ytdlpGetAudioUrl(track.url)

                if (this.#skipRequested) return resolve()

                // FFmpeg: transcode CDN URL → MP3 stream
                const ffmpegBin = (() => {
                    // Coba ffmpeg static binary dulu, fallback ke system
                    const local = path.resolve('./storage/bin/ffmpeg')
                    return fs.existsSync(local) ? local : 'ffmpeg'
                })()

                const ffArgs = [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-i', audioUrl,
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', '128k',
                    '-ar', '44100',
                    '-ac', '2',
                ]
                if (filterStr) ffArgs.push('-af', filterStr)
                ffArgs.push('-f', 'mp3', '-loglevel', 'error', 'pipe:1')

                console.log(`\x1b[90m[Radio] FFmpeg starting (${ffmpegBin})...\x1b[0m`)
                const ffProc = spawn(ffmpegBin, ffArgs)
                this.#ffmpeg = ffProc

                ffProc.stdout.on('data', chunk => this.#broadcast(chunk))
                ffProc.stderr.on('data', d => {
                    const msg = d.toString().trim()
                    if (msg) console.log(`\x1b[33m[FFmpeg] ${msg}\x1b[0m`)
                })

                ffProc.on('close', (code) => {
                    this.#ffmpeg = null
                    if (code === 0 || this.#skipRequested) resolve()
                    else reject(new Error(`FFmpeg exit ${code}`))
                })

                ffProc.on('error', e => {
                    if (e.code === 'ENOENT') {
                        reject(new Error('FFmpeg tidak ditemukan. Tunggu download otomatis selesai atau restart bot.'))
                    } else {
                        reject(new Error(`FFmpeg error: ${e.message}`))
                    }
                })

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
        logger.info('[Radio] Stopped.')
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
        try { this.#ffmpeg?.kill('SIGKILL') } catch (_) { }
        this.#ffmpeg = null
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