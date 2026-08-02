// src/services/downloader/providers/instagram.js
// Instagram Downloader — Reels, Posts, Stories, IGTV
// Strategy: local yt-dlp → Embed scrape → Fallback public APIs (BtchDownloader, SaveIG, SnapSave)

import { fetchBuffer, sanitizeFilename } from '../utils.js'
import { logger } from '../../../utils/logger.js'
import { downloadYtdlp } from './ytdlp.js'
import https from 'https'
import http from 'http'
import * as cheerio from 'cheerio'

/**
 * Ekstrak shortcode dari URL Instagram
 */
function extractShortcode(url) {
    const match = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/)
    return match ? match[1] : null
}

/**
 * Fetch HTML mentah pakai http/https native
 */
function fetchHtml(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url)
        const mod = parsed.protocol === 'https:' ? https : http
        const req = mod.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            family: 4,
            timeout,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchHtml(res.headers.location, timeout).then(resolve).catch(reject)
            }
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => resolve(data))
            res.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${timeout}ms`)) })
    })
}

/**
 * Download video/image dari Instagram melalui halaman embed
 */
async function downloadViaEmbed(url) {
    const shortcode = extractShortcode(url)
    if (!shortcode) throw new Error('Shortcode tidak ditemukan di URL')

    const embedUrls = [
        `https://www.instagram.com/reel/${shortcode}/embed/`,
        `https://www.instagram.com/p/${shortcode}/embed/captioned/`
    ]

    for (const embedUrl of embedUrls) {
        try {
            logger.info(`[Instagram] Embed: fetching ${embedUrl}`)
            const html = await fetchHtml(embedUrl)

            let mediaUrl = null
            let isVideo = true

            // Method 1: Escaped format (paling umum di embed page)
            const escapedMatch = html.match(/\\"video_url\\":\\"(https?:[^"]*?)\\"/)
            if (escapedMatch) {
                mediaUrl = escapedMatch[1]
                    .replace(/\\\\\//g, '/')
                    .replace(/\\\//g, '/')
                    .replace(/\\u0026/g, '&')
            }

            // Method 2: Direct format
            if (!mediaUrl) {
                const directMatch = html.match(/"video_url":"(https?:[^"]+)"/)
                if (directMatch) {
                    mediaUrl = directMatch[1]
                        .replace(/\\\//g, '/')
                        .replace(/\\u0026/g, '&')
                }
            }

            // Method 3: og:video tag
            if (!mediaUrl) {
                const $ = cheerio.load(html)
                const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[property="og:video:secure_url"]').attr('content')
                if (ogVideo) {
                    mediaUrl = ogVideo.replace(/&amp;/g, '&')
                } else {
                    const ogImage = $('meta[property="og:image"]').attr('content')
                    if (ogImage) {
                        mediaUrl = ogImage.replace(/&amp;/g, '&')
                        isVideo = false
                    }
                }
            }

            if (mediaUrl) {
                return { mediaUrl, isVideo }
            }
        } catch (e) {
            logger.debug(`[Instagram] Embed fetch error (${embedUrl}): ${e.message}`)
        }
    }

    throw new Error('video_url / media_url tidak ditemukan di embed page')
}

// ─────────────────────────────────────────────
// DEOBFUSCATOR UNTUK SNAPSAVE / PUBLIC SCRAPERS
// ─────────────────────────────────────────────
function deobfuscateJs(jsCode) {
    if (!jsCode || typeof jsCode !== 'string') return null

    // Dean Edwards Packer
    const packerMatch = jsCode.match(/}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s)
    if (packerMatch) {
        try {
            let [, p, a, c, k] = packerMatch
            a = parseInt(a, 10)
            c = parseInt(c, 10)
            const keywords = k.split('|')
            while (c--) {
                if (keywords[c]) {
                    const reg = new RegExp('\\b' + c.toString(a) + '\\b', 'g')
                    p = p.replace(reg, keywords[c])
                }
            }
            return p
        } catch (_) {}
    }

    // Custom VM DOM assignment
    try {
        let innerHtmlOutput = ''
        const mockLocation = { hostname: 'snapsave.app', href: 'https://snapsave.app/id', protocol: 'https:', origin: 'https://snapsave.app' }
        const mockElement = { set innerHTML(val) { innerHtmlOutput = val }, get innerHTML() { return innerHtmlOutput } }
        const sandbox = {
            window: { location: mockLocation },
            location: mockLocation,
            document: { location: mockLocation, getElementById: () => mockElement, querySelector: () => mockElement, querySelectorAll: () => [mockElement] }
        }
        const func = new Function('document', 'window', 'location', jsCode)
        func(sandbox.document, sandbox.window, sandbox.location)
        if (innerHtmlOutput) return innerHtmlOutput
    } catch (_) {}

    return null
}

// ─────────────────────────────────────────────
// FALLBACK API ENDPOINTS
// ─────────────────────────────────────────────

const IG_APIS = [
    {
        name: 'BtchDownloader',
        fetchMedia: async (url) => {
            const { igdl } = await import('btch-downloader')
            const res = await igdl(url)
            if (!res?.status || !res?.result?.length) return null
            const valid = res.result.find(i => i.url && i.url.length > 0)
            if (!valid) return null
            const isVideo = valid.url.includes('.mp4') || valid.url.includes('v2?') || valid.url.includes('video')
            return {
                downloadUrl: valid.url,
                type: isVideo ? 'video' : 'image',
                thumbnail: valid.thumbnail || null,
                multiple: res.result.filter(i => i.url).map(i => i.url),
            }
        }
    },
    {
        name: 'SaveIG',
        fetchMedia: async (url) => {
            const { fetchJson } = await import('../utils.js')
            const formData = new URLSearchParams({ q: url, t: 'media', lang: 'id' })
            const data = await fetchJson('https://saveig.app/api/ajaxSearch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Referer': 'https://saveig.app/id',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: formData.toString(),
                timeout: 6000,
            })
            if (data?.status !== 'ok' || !data?.data?.length) return null
            const video = data.data.find(i => i.type === 'mp4' || i.url?.includes('.mp4'))
            const image = data.data.find(i => i.type === 'jpg' || i.type === 'jpeg' || i.url?.includes('.jpg'))
            const chosen = video ?? image ?? data.data[0]
            return {
                downloadUrl: chosen.url,
                type: video ? 'video' : 'image',
                thumbnail: data.data.find(i => i.type === 'jpg')?.url ?? null,
                multiple: data.data.length > 1 ? data.data.map(i => i.url) : null,
            }
        }
    },
    {
        name: 'SnapSave',
        fetchMedia: async (url) => {
            const { fetchJson } = await import('../utils.js')
            const formData = new URLSearchParams({ url })
            const raw = await fetchJson('https://snapsave.app/action.php?lang=id', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': 'https://snapsave.app/id',
                    'Origin': 'https://snapsave.app',
                },
                body: formData.toString(),
                timeout: 6000,
                isText: true,
            })
            const html = deobfuscateJs(raw) || raw
            if (typeof html !== 'string') return null
            const $ = cheerio.load(html)
            const videoUrl = $('a[href*="cdninstagram.com"]').attr('href') || $('a.download-btn').attr('href') || $('a[target="_blank"]').attr('href')
            if (!videoUrl) return null
            return {
                downloadUrl: decodeURIComponent(videoUrl),
                type: videoUrl.includes('.mp4') ? 'video' : 'image',
                thumbnail: null,
                multiple: null,
            }
        }
    }
]

// ─────────────────────────────────────────────
// MAIN DOWNLOADER
// ─────────────────────────────────────────────

export async function downloadInstagram(url, options = {}) {
    let lastError = null

    // ──── TAHAP 1: Coba local yt-dlp (Primary) ────
    try {
        logger.info('[Instagram] Trying: local yt-dlp (primary)')
        const result = await downloadYtdlp(url, options)
        logger.info('[Instagram] Downloaded successfully via local yt-dlp')
        return result
    } catch (err) {
        logger.warn(`[Instagram] Local yt-dlp failed: ${err.message}`)
        lastError = err
    }

    // ──── TAHAP 2: Fallback ke Embed Scrape ────
    try {
        logger.info('[Instagram] Trying fallback: Embed Scrape')
        const { mediaUrl, isVideo } = await downloadViaEmbed(url)
        logger.info(`[Instagram] Embed: Got CDN URL: ${mediaUrl.substring(0, 80)}...`)

        const { buffer } = await fetchBuffer(mediaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
                'Referer': 'https://www.instagram.com/',
            },
            timeout: 180_000,
            maxSizeMB: 50,
        })

        const ext = isVideo ? 'mp4' : 'jpg'
        const filename = sanitizeFilename(`ig_${Date.now()}.${ext}`)
        return {
            buffer,
            filename,
            caption: `📸 *Instagram ${isVideo ? 'Reels/Video' : 'Photo'}*\n_via Embed Scrape_`,
            mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
            ext,
            platform: 'instagram',
            type: isVideo ? 'video' : 'image',
            multiple: null,
        }
    } catch (err) {
        logger.warn(`[Instagram] Embed fallback failed: ${err.message}`)
        lastError = err
    }

    // ──── TAHAP 3: Fallback ke API pihak ke-3 ────
    for (const api of IG_APIS) {
        try {
            logger.debug(`[Instagram] Trying API: ${api.name}`)
            const parsed = await api.fetchMedia(url)
            if (!parsed?.downloadUrl) {
                logger.debug(`[Instagram] ${api.name} returned no URL, trying next...`)
                continue
            }

            logger.info(`[Instagram] Got URL via ${api.name}: ${parsed.downloadUrl.slice(0, 60)}`)

            const { buffer } = await fetchBuffer(parsed.downloadUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://www.instagram.com/',
                },
                timeout: 180_000,
                maxSizeMB: 50,
            })

            const ext = parsed.type === 'video' ? 'mp4' : 'jpg'
            const filename = sanitizeFilename(`ig_${Date.now()}.${ext}`)

            return {
                buffer,
                filename,
                caption: `📸 *Instagram ${parsed.type === 'video' ? 'Reels/Video' : 'Post'}*\n_via ${api.name}_`,
                mimeType: parsed.type === 'video' ? 'video/mp4' : 'image/jpeg',
                ext,
                platform: 'instagram',
                type: parsed.type,
                multiple: parsed.multiple ?? null,
            }

        } catch (err) {
            logger.warn(`[Instagram] ${api.name} failed: ${err.message}`)
            lastError = err
        }
    }

    throw new Error(`Gagal download Instagram. Link mungkin dari akun private atau postingan telah dihapus. (${lastError?.message ?? 'Semua scraper error'})`)
}