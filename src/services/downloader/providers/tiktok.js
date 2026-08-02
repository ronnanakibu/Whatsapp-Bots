// src/services/downloader/providers/tiktok.js
// TikTok Downloader — No Watermark & Guaranteed Playable MP4 Video
// Strategy: Multi-fallback web APIs + H.264 transcode guard + yt-dlp fallback

import { fetchBuffer, fetchJson, resolveShortUrl, sanitizeFilename } from '../utils.js'
import { logger } from '../../../utils/logger.js'
import mediaService from '../../media.js'
import { downloadYtdlp } from './ytdlp.js'

// ─────────────────────────────────────────────
// API ENDPOINTS
// ─────────────────────────────────────────────

const TT_APIS = [
    {
        name: 'TikWM',
        // TikWM: prefer res.data.play (H.264 MP4) over hdplay (which can be H.265/HEVC)
        fetch: async (url) => {
            const res = await fetchJson('https://www.tikwm.com/api/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                body: `url=${encodeURIComponent(url)}`, // Tanpa &hd=1 agar default ke H.264 MP4 no-watermark
                timeout: 20_000,
            })

            if (!res?.data?.play && !res?.data?.wmplay && !res?.data?.hdplay) return null

            // Prioritaskan 'play' (standard H.264 no-watermark MP4)
            const downloadUrl = res.data.play ?? res.data.wmplay ?? res.data.hdplay

            return {
                downloadUrl,
                audioUrl: res.data.music_info?.play ?? res.data.music,
                thumbnail: res.data.cover,
                title: res.data.title ?? '',
                author: res.data.author?.nickname ?? '',
                duration: res.data.duration,
                isSlideshow: Array.isArray(res.data.images) && res.data.images.length > 0,
            }
        }
    },
    {
        name: 'SSSTik',
        fetch: async (url) => {
            const html = await fetchJson('https://ssstik.io/abc?url=dl', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://ssstik.io/',
                    'Origin': 'https://ssstik.io',
                },
                body: `id=${encodeURIComponent(url)}&locale=id&tt=aHR0cHM6Ly9zc3N0aWsuaW8v`,
                timeout: 20_000,
                isText: true,
            })

            if (!html || typeof html !== 'string') return null

            const noWmMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>\s*Without watermark/i)
            const fallbackMatch = html.match(/class="pure-button[^"]*"[^>]*href="(https:\/\/tikcdn[^"]+)"/i)
            const videoUrl = noWmMatch?.[1] ?? fallbackMatch?.[1]

            if (!videoUrl) return null

            return {
                downloadUrl: videoUrl,
                audioUrl: null,
                thumbnail: null,
                title: '',
                author: '',
                duration: null,
                isSlideshow: false,
            }
        }
    },
    {
        name: 'TikMate',
        fetch: async (url) => {
            const res = await fetchJson('https://api.tikmate.app/api/lookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                body: `url=${encodeURIComponent(url)}`,
                timeout: 20_000,
            })

            if (!res?.token || !res?.id) return null

            return {
                downloadUrl: `https://tikmate.app/download/${res.token}/${res.id}.mp4`,
                audioUrl: null,
                thumbnail: null,
                title: res.author_name ?? '',
                author: res.author_id ?? '',
                duration: null,
                isSlideshow: false,
            }
        }
    },
    {
        name: 'LoVetik',
        fetch: async (url) => {
            const res = await fetchJson('https://lovetik.com/api/ajax/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                body: `query=${encodeURIComponent(url)}`,
                timeout: 20_000,
            })

            if (!res?.links || !Array.isArray(res.links)) return null
            const videoLink = res.links.find(l => l.ft === 'nowatermark')?.a ?? res.links[0]?.a
            if (!videoLink) return null

            return {
                downloadUrl: videoLink,
                audioUrl: res.links.find(l => l.ft === 'audio')?.a ?? null,
                thumbnail: res.cover ?? null,
                title: res.desc ?? '',
                author: res.author ?? '',
                duration: null,
                isSlideshow: false,
            }
        }
    },
    {
        name: 'SnapTik',
        fetch: async (url) => {
            const res = await fetchJson(`https://api.snaptik.app/tiktok?url=${encodeURIComponent(url)}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 20_000,
            })

            if (!res?.video) return null

            return {
                downloadUrl: res.video,
                audioUrl: res.music ?? null,
                thumbnail: res.thumbnail ?? null,
                title: res.title ?? '',
                author: res.author ?? '',
                duration: null,
                isSlideshow: false,
            }
        }
    }
]

// ─────────────────────────────────────────────
// MAIN DOWNLOADER
// ─────────────────────────────────────────────

export async function downloadTikTok(rawUrl, options = {}) {
    // Resolve short URLs (vm.tiktok.com, vt.tiktok.com, /t/)
    let url = rawUrl
    if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com') || url.includes('/t/')) {
        try {
            url = await resolveShortUrl(rawUrl)
            logger.debug(`[TikTok] Resolved short URL: ${url}`)
        } catch {
            // Lanjut dengan URL original kalau resolve gagal
        }
    }

    let lastError = null

    for (const api of TT_APIS) {
        try {
            logger.debug(`[TikTok] Trying: ${api.name}`)

            const parsed = await api.fetch(url)
            if (!parsed?.downloadUrl) {
                logger.debug(`[TikTok] ${api.name} returned no URL`)
                continue
            }

            logger.info(`[TikTok] Got URL via ${api.name}`)

            let { buffer, mimeType } = await fetchBuffer(parsed.downloadUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6)',
                    'Referer': 'https://www.tiktok.com/',
                },
                timeout: 300_000, // 5 menit
                maxSizeMB: 50,
            })

            // Transcode / remux ke MP4 H.264 standard jika bukan format yang bisa diputar di WhatsApp
            buffer = await mediaService.convertToPlayableMp4(buffer)

            const filename = sanitizeFilename(
                parsed.title
                    ? `tt_${parsed.title.slice(0, 30)}_${Date.now()}.mp4`
                    : `tiktok_${Date.now()}.mp4`
            )

            // Build caption
            let caption = `🎵 *TikTok*`
            if (parsed.author) caption += `\n👤 ${parsed.author}`
            if (parsed.title) caption += `\n📝 ${parsed.title}`
            caption += `\n_No watermark via ${api.name}_`

            return {
                buffer,
                filename,
                caption,
                mimeType: 'video/mp4',
                ext: 'mp4',
                platform: 'tiktok',
                type: 'video',
                thumbnail: parsed.thumbnail ?? null,
                audioUrl: parsed.audioUrl ?? null,
            }

        } catch (err) {
            logger.warn(`[TikTok] ${api.name} failed: ${err.message}`)
            lastError = err
        }
    }

    // Fallback terakhir: Coba download via yt-dlp jika semua web API gagal
    try {
        logger.info(`[TikTok] Web APIs failed, trying yt-dlp fallback...`)
        const result = await downloadYtdlp(url, { ...options, format: 'video' })
        if (result?.buffer) {
            result.buffer = await mediaService.convertToPlayableMp4(result.buffer)
            result.mimeType = 'video/mp4'
            result.ext = 'mp4'
            result.type = 'video'
            result.platform = 'tiktok'
            return result
        }
    } catch (ytdlpErr) {
        logger.warn(`[TikTok] yt-dlp fallback failed: ${ytdlpErr.message}`)
    }

    throw new Error(`Gagal download TikTok. ${lastError?.message ?? 'Semua API error.'}`)
}