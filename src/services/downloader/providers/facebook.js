// src/services/downloader/providers/facebook.js
// Facebook Video Downloader — Posts, Reels, Watch
// Strategy: Resolve Share Links -> yt-dlp -> Multi-API fallback

import https from 'https'
import { URL } from 'url'
import { fetchBuffer, fetchJson, sanitizeFilename } from '../utils.js'
import { logger } from '../../../utils/logger.js'
import { downloadYtdlp } from './ytdlp.js'

/**
 * Resolve Facebook short/share links (fb.watch, facebook.com/share/...)
 */
export async function resolveFbUrl(rawUrl) {
    if (!rawUrl) return rawUrl
    let cleanUrl = rawUrl.replace('fb.watch', 'www.facebook.com/watch?v=')

    if (cleanUrl.includes('/share/')) {
        try {
            const parsed = new URL(cleanUrl)
            const resolved = await new Promise((resolve) => {
                const req = https.request({
                    hostname: parsed.hostname,
                    port: 443,
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    family: 4,
                    headers: {
                        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                        'Accept': '*/*',
                    }
                }, (res) => {
                    req.destroy()
                    if (res.headers.location) {
                        const loc = res.headers.location
                        const cleanLoc = loc.split('?')[0]
                        return resolve(cleanLoc.startsWith('http') ? cleanLoc : `https://www.facebook.com${cleanLoc}`)
                    }
                    resolve(cleanUrl)
                })
                req.setTimeout(5000, () => { req.destroy(); resolve(cleanUrl) })
                req.on('error', () => resolve(cleanUrl))
                req.end()
            })
            if (resolved) cleanUrl = resolved
        } catch (_) {}
    }
    return cleanUrl
}

const FB_APIS = [
    {
        name: 'SaveFrom',
        fetch: async (url) => {
            const res = await fetchJson(
                `https://sfrom.net/api/button/1?url=${encodeURIComponent(url)}`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    timeout: 10_000,
                }
            )
            if (!res?.url?.length) return null
            const hd = res.url.find(u => u.id === 'hd')
            const sd = res.url.find(u => u.id === 'sd')
            return {
                downloadUrl: (hd ?? sd)?.url ?? null,
                quality: hd ? 'HD' : 'SD',
                title: res.title ?? '',
                thumbnail: res.thumb ?? null,
            }
        }
    },
    {
        name: 'SnapSave',
        fetch: async (url) => {
            const res = await fetchJson(
                'https://snapsave.app/action.php?lang=id',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Referer': 'https://snapsave.app/',
                    },
                    body: `url=${encodeURIComponent(url)}`,
                    timeout: 10_000,
                    isText: true,
                }
            )
            if (!res || typeof res !== 'string') return null
            const videoMatch = res.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i)
            if (!videoMatch) return null
            return {
                downloadUrl: decodeURIComponent(videoMatch[1]),
                quality: 'HD',
                title: '',
                thumbnail: null,
            }
        }
    }
]

export async function downloadFacebook(url, options = {}) {
    // 0. Resolve short / share links
    const cleanUrl = await resolveFbUrl(url)
    logger.debug(`[Facebook] Clean URL: ${cleanUrl}`)

    // ── 1. Coba via yt-dlp first (sangat stabil jika URL sudah resolved) ──
    try {
        logger.debug(`[Facebook] Trying local/HF yt-dlp first`)
        const ytdlpResult = await downloadYtdlp(cleanUrl, options)
        if (ytdlpResult && ytdlpResult.buffer) {
            logger.info(`[Facebook] Download success via yt-dlp`)
            ytdlpResult.platform = 'facebook'
            return ytdlpResult
        }
    } catch (err) {
        logger.warn(`[Facebook] yt-dlp fallback failed: ${err.message}`)
    }

    // ── 2. Fallback ke public APIs jika yt-dlp gagal ─────────
    let lastError = null

    for (const api of FB_APIS) {
        try {
            logger.debug(`[Facebook] Trying: ${api.name}`)
            const parsed = await api.fetch(cleanUrl)

            if (!parsed?.downloadUrl) continue

            logger.info(`[Facebook] Got URL via ${api.name}`)

            const { buffer, mimeType } = await fetchBuffer(parsed.downloadUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://www.facebook.com/',
                },
                timeout: 60_000,
                maxSizeMB: 80,
            })

            const filename = sanitizeFilename(
                parsed.title
                    ? `fb_${parsed.title.slice(0, 30)}_${Date.now()}.mp4`
                    : `facebook_${Date.now()}.mp4`
            )

            let caption = `📘 *Facebook Video*`
            if (parsed.title) caption += `\n📝 ${parsed.title}`
            if (parsed.quality) caption += `\n🎞️ Kualitas: ${parsed.quality}`
            caption += `\n_via ${api.name}_`

            return {
                buffer,
                filename,
                caption,
                mimeType: 'video/mp4',
                ext: 'mp4',
                platform: 'facebook',
                type: 'video',
                thumbnail: parsed.thumbnail ?? null,
            }

        } catch (err) {
            logger.warn(`[Facebook] ${api.name} failed: ${err.message}`)
            lastError = err
        }
    }

    throw new Error(`Gagal download Facebook. ${lastError?.message ?? 'Semua API fallback Facebook gagal.'}`)
}