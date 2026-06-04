// src/services/downloader/index.js
// Downloader Service — Unified entry point
// Provider priority: Instagram → TikTok → YouTube → Facebook → Auto-detect

import { detectPlatform } from './detector.js'
import { downloadInstagram } from './providers/instagram.js'
import { downloadTikTok } from './providers/tiktok.js'
import { downloadFacebook } from './providers/facebook.js'
import { downloadYtdlp } from './providers/ytdlp.js'
import { DownloadQueue } from './queue.js'
import { logger } from '../../utils/logger.js'
import { metricsService } from '../metrics.js'

// Singleton queue — shared across all providers
export const downloadQueue = new DownloadQueue({ concurrency: 3, timeout: 90_000 })

const PROVIDERS = {
    instagram: downloadInstagram,
    tiktok: downloadTikTok,
    youtube: downloadYtdlp,
    facebook: downloadFacebook,
    twitter: downloadYtdlp,
}

/**
 * Main download function.
 * Auto-detects platform, routes to correct provider.
 * Returns { buffer, filename, caption, mimeType, ext, platform }
 */
export async function download(url, options = {}) {
    let platform = detectPlatform(url)

    if (!platform) {
        // Fallback ke ytdlp meskipun platform tidak terdeteksi secara eksplisit (seperti twitter, dll)
        platform = 'unknown'
    }

    let provider = PROVIDERS[platform] || downloadYtdlp

    // Override: Jika HF API aktif, paksa SEMUA platform pakai HF (melalui ytdlp)
    if (process.env.HF_API_URL) {
        provider = downloadYtdlp
    }

    logger.info(`[Downloader] Platform: ${platform} | URL: ${url.slice(0, 60)}`)

    // Queue-based execution — mencegah overload
    const result = await downloadQueue.add(() => provider(url, options), {
        label: `${platform}:${url.slice(-20)}`
    })
    metricsService.incrementDownloads()
    return result
}

export { detectPlatform }