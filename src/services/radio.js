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
 * Dapatkan play-dl stream langsung.
 * Return: { stream: Readable, type: string }
 * Tidak butuh yt-dlp sama sekali.
 */
async function getPlayDlStream(youtubeUrl) {
    const playdl = await getPlayDl()

    botLogger.info('radio', `play-dl streaming: ${youtubeUrl}`)

    // quality: 0 = best, 1 = medium, 2 = worst (untuk kecepatan)
    const streamData = await playdl.stream(youtubeUrl, { quality: 0 })

    botLogger.info('radio', `Stream ready — type: ${streamData.type}`)
    return streamData
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
                // Build ffmpeg filter chain
                const filters = [FX_PRESETS[this.#activeFx], EQ_PRESETS[this.#activeEq]].filter(Boolean)
                const filterStr = filters.join(',')

                // ── 1. Dapatkan play-dl stream ──
                let streamData
                try {
                    streamData = await getPlayDlStream(track.url)
                } catch (e) {
                    return reject(new Error(`play-dl stream gagal: ${e.message}`))
                }

                if (this.#skipRequested) {
                    streamData.stream.destroy?.()
                    return resolve()
                }

                this.#currentStream = streamData.stream

                // ── 2. Tentukan input format untuk ffmpeg ──
                // play-dl return 'opus' untuk webm/opus stream, 'arbitrary' untuk mp4/m4a
                const inputFormat = streamData.type === 'opus' ? 'opus' : null

                const ffmpegBin = getFfmpegPath()
                const ffArgs = []

                // Input: pipe dari stdin
                if (inputFormat) {
                    ffArgs.push('-f', inputFormat)
                }
                ffArgs.push('-i', 'pipe:0')   // baca dari stdin

                // Output: MP3 ke stdout
                ffArgs.push('-vn')
                ffArgs.push('-acodec', 'libmp3lame')
                ffArgs.push('-ab', '128k')
                ffArgs.push('-ar', '44100')
                ffArgs.push('-ac', '2')

                if (filterStr) ffArgs.push('-af', filterStr)

                ffArgs.push(
                    '-f', 'mp3',
                    '-loglevel', 'error',
                    'pipe:1'   // output ke stdout
                )

                botLogger.info('radio', `FFmpeg starting (${ffmpegBin})`)
                const ffProc = spawn(ffmpegBin, ffArgs)
                this.#ffmpeg = ffProc

                // ── 3. Pipe play-dl → ffmpeg stdin ──
                streamData.stream.pipe(ffProc.stdin)

                streamData.stream.on('error', e => {
                    botLogger.err('radio', e, 'play-dl stream')
                    ffProc.kill()
                    reject(new Error(`Stream error: ${e.message}`))
                })

                ffProc.stdin.on('error', () => {
                    // Biasa terjadi saat skip — ffmpeg stdin ditutup paksa, aman diabaikan
                })

                // ── 4. FFmpeg stdout → broadcast ──
                ffProc.stdout.on('data', chunk => this.#broadcast(chunk))

                ffProc.stderr.on('data', d => {
                    const msg = d.toString().trim()
                    if (msg) botLogger.debug('ffmpeg', msg)
                })

                ffProc.on('close', code => {
                    this.#ffmpeg = null
                    this.#currentStream = null
                    if (code === 0 || this.#skipRequested) resolve()
                    else reject(new Error(`FFmpeg exit code ${code}`))
                })

                ffProc.on('error', e => {
                    if (e.code === 'ENOENT') {
                        reject(new Error(
                            'FFmpeg tidak ditemukan.\n' +
                            'Download FFmpeg static build ke storage/bin/ffmpeg\n' +
                            'atau install di system: apt install ffmpeg'
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