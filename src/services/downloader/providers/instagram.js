// src/services/downloader/providers/instagram.js
// Instagram Downloader — Reels, Posts, Stories, IGTV
// Strategy: Embed scrape (fastest, no auth) → fallback API publik
// Priority: Embed → SaveIG → SnapSave → InstaFinsta

import { fetchBuffer, sanitizeFilename } from '../utils.js'
import { logger } from '../../../utils/logger.js'
import https from 'https'
import http from 'http'

// ─────────────────────────────────────────────
// EMBED SCRAPER — Metode tercepat, langsung dari IG
// Mengekstrak video_url dari halaman /embed/
// ─────────────────────────────────────────────

/**
 * Ekstrak shortcode dari URL Instagram
 */
function extractShortcode(url) {
    const match = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/)
    return match ? match[1] : null
}

/**
 * Fetch HTML mentah pakai http/https native (lebih reliable dari fetch)
 */
function fetchHtml(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url)
        const mod = parsed.protocol === 'https:' ? https : http
        const req = mod.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            family: 4,
            timeout,
        }, (res) => {
            // Follow redirects
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
 * Download video dari Instagram melalui halaman embed (METODE UTAMA)
 * Cara kerja: IG /embed/ page mengekspose video_url langsung di HTML
 * Keunggulan: Tidak perlu API pihak ke-3, tidak perlu cookies, langsung dari CDN IG
 */
async function downloadViaEmbed(url) {
    const shortcode = extractShortcode(url)
    if (!shortcode) throw new Error('Shortcode tidak ditemukan di URL')

    const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/`
    logger.info(`[Instagram] Embed: fetching ${embedUrl}`)
    
    const html = await fetchHtml(embedUrl)
    
    let videoUrl = null

    // Method 1: Escaped format (paling umum di embed page)
    // Format: \"video_url\":\"https:\\/\\/...\"
    const escapedMatch = html.match(/\\"video_url\\":\\"(https?:[^"]*?)\\"/)
    if (escapedMatch) {
        // Two-step unescape: \\\\/ → \\/ → /
        videoUrl = escapedMatch[1]
            .replace(/\\\\\//g, '/')   // Step 1: \\/ → /  (double escaped)
            .replace(/\\\//g, '/')      // Step 2: \/ → /   (single escaped)
            .replace(/\\u0026/g, '&')   // Step 3: \u0026 → &
    }

    // Method 2: Direct format (kadang muncul)
    if (!videoUrl) {
        const directMatch = html.match(/"video_url":"(https?:[^"]+)"/)
        if (directMatch) {
            videoUrl = directMatch[1]
                .replace(/\\\//g, '/')
                .replace(/\\u0026/g, '&')
        }
    }

    if (!videoUrl) throw new Error('video_url tidak ditemukan di embed page')
    
    return videoUrl
}

// ─────────────────────────────────────────────
// FALLBACK API ENDPOINTS (publik, no key required)
// Digunakan jika embed scrape gagal
// ─────────────────────────────────────────────

const IG_APIS = [
    {
        name: 'SaveIG',
        buildUrl: (url) => `https://v3.saveig.app/api/ajaxSearch?q=${encodeURIComponent(url)}&t=media&lang=id`,
        parse: parseSaveIG,
    },
    {
        name: 'SSYouTube/SnapSave',
        buildUrl: (url) => `https://snapsave.app/action.php?lang=id&url=${encodeURIComponent(url)}`,
        parse: parseSnapSave,
    },
    {
        name: 'InstaFinsta',
        buildUrl: (url) => `https://instafinsta.com/ig?url=${encodeURIComponent(url)}`,
        parse: parseInstaFinsta,
    },
]

// ─────────────────────────────────────────────
// PARSERS — tiap API punya format response beda
// ─────────────────────────────────────────────

function parseSaveIG(data) {
    // SaveIG returns { status: 'ok', data: [{ url, type, ... }] }
    if (data?.status !== 'ok' || !data?.data?.length) return null

    const items = data.data
    // Prioritas: video > image
    const video = items.find(i => i.type === 'mp4' || i.url?.includes('.mp4'))
    const image = items.find(i => i.type === 'jpg' || i.type === 'jpeg' || i.url?.includes('.jpg'))
    const chosen = video ?? image ?? items[0]

    return {
        downloadUrl: chosen.url,
        type: video ? 'video' : 'image',
        thumbnail: data.data.find(i => i.type === 'jpg')?.url ?? null,
        multiple: items.length > 1 ? items.map(i => i.url) : null,
    }
}

function parseSnapSave(html) {
    // SnapSave returns HTML — scrape URL dari dalam
    if (!html || typeof html !== 'string') return null

    const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i)
    const imageMatch = html.match(/href="(https:\/\/[^"]+\.jpg[^"]*)"/i)

    const url = videoMatch?.[1] ?? imageMatch?.[1]
    if (!url) return null

    return {
        downloadUrl: decodeURIComponent(url),
        type: videoMatch ? 'video' : 'image',
        thumbnail: null,
        multiple: null,
    }
}

function parseInstaFinsta(data) {
    // InstaFinsta returns { url, thumbnail, ... }
    if (!data?.url) return null
    return {
        downloadUrl: data.url,
        type: data.url.includes('.mp4') ? 'video' : 'image',
        thumbnail: data.thumbnail ?? null,
        multiple: null,
    }
}

// ─────────────────────────────────────────────
// MAIN DOWNLOADER
// ─────────────────────────────────────────────

/**
 * Download Instagram content (Reel, Post, Story, IGTV)
 * Returns: { buffer, filename, caption, mimeType, ext, platform, type }
 */
export async function downloadInstagram(url, options = {}) {
    let lastError = null

    // ──── TAHAP 1: Coba Embed Scrape (tercepat, paling reliable) ────
    try {
        logger.info('[Instagram] Trying: Embed Scrape (primary)')
        const videoUrl = await downloadViaEmbed(url)
        logger.info(`[Instagram] Embed: Got CDN URL: ${videoUrl.substring(0, 80)}...`)

        const { buffer, mimeType } = await fetchBuffer(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                'Referer': 'https://www.instagram.com/',
            },
            timeout: 300_000,
            maxSizeMB: 50,
        })

        const filename = sanitizeFilename(`ig_${Date.now()}.mp4`)
        return {
            buffer,
            filename,
            caption: '📸 *Instagram Reels/Video*\n_via Embed Scrape_',
            mimeType: 'video/mp4',
            ext: 'mp4',
            platform: 'instagram',
            type: 'video',
            multiple: null,
        }
    } catch (err) {
        logger.warn(`[Instagram] Embed failed: ${err.message}`)
        lastError = err
    }

    // ──── TAHAP 2: Fallback ke API pihak ke-3 ────
    for (const api of IG_APIS) {
        try {
            logger.debug(`[Instagram] Trying API: ${api.name}`)

            const apiUrl = api.buildUrl(url)
            // Use dynamic import for fetchJson to keep it lazy
            const { fetchJson } = await import('../utils.js')
            const raw = await fetchJson(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
                    'Referer': 'https://saveig.app/',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                timeout: 15_000,
            })

            const parsed = api.parse(raw)
            if (!parsed?.downloadUrl) {
                logger.debug(`[Instagram] ${api.name} returned no URL, trying next...`)
                continue
            }

            logger.info(`[Instagram] Got URL via ${api.name}: ${parsed.downloadUrl.slice(0, 60)}`)

            // Download the actual media buffer
            const { buffer, mimeType } = await fetchBuffer(parsed.downloadUrl, {
                headers: {
                    'User-Agent': 'Instagram 219.0.0.12.117 Android',
                    'Referer': 'https://www.instagram.com/',
                },
                timeout: 300_000, // 5 menit karena server sering dilimit ~30kbps oleh IG
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

    throw new Error(`Gagal download Instagram. ${lastError?.message ?? 'Semua API error.'}`)
}