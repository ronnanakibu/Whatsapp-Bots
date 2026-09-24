// src/services/storySync.js
// Layanan integrasi sinkronisasi otomatis Instagram Story ke Website Kelas CE F
// Mendukung: polling berkala, download media story, filter duplikasi, dan POST webhook ke API website

import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { logger, botLogger } from '../utils/logger.js'

// Konfigurasi & Variabel Lingkungan
const WEB_API_URL = process.env.CEF_WEB_URL || 'https://cef25.my.id/api/stories'
const API_SECRET_KEY = process.env.CEF_API_KEY || 'cef2024'
const TARGET_ACCOUNT = (process.env.CEF_STORY_TARGET_ACCOUNT || 'comeinone.f').replace(/^@/, '')
const CACHE_FILE = path.resolve(process.env.CEF_STORY_CACHE_PATH || './storage/synced_stories.json')
const INTERVAL_MINUTES = Math.max(1, parseInt(process.env.CEF_STORY_INTERVAL_MINUTES || '10', 10))

const CATEGORY_FILE = path.resolve(process.env.CEF_STORY_CATEGORY_PATH || './storage/story_category.json')

export function getAutoCategory() {
    try {
        if (fs.existsSync(CATEGORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(CATEGORY_FILE, 'utf-8'))
            if (data && data.category) return data.category
        }
    } catch (err) {}
    return 'General'
}

export function setAutoCategory(category) {
    try {
        const dir = path.dirname(CATEGORY_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(CATEGORY_FILE, JSON.stringify({ category }, null, 2), 'utf-8')
        return true
    } catch (err) {
        logger.error(`[STORY SYNC] Gagal set kategori: ${err.message}`)
        return false
    }
}

/**
 * Cek apakah story ID sudah pernah diarsipkan ke website
 */
export function isAlreadyArchived(igStoryId) {
    if (!igStoryId) return false
    if (!fs.existsSync(CACHE_FILE)) return false
    try {
        const synced = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
        return Array.isArray(synced) && synced.includes(String(igStoryId))
    } catch {
        return false
    }
}

/**
 * Catat story ID ke cache lokal agar tidak diunggah berulang
 */
export function markAsArchived(igStoryId) {
    if (!igStoryId) return
    try {
        const dir = path.dirname(CACHE_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        let synced = []
        if (fs.existsSync(CACHE_FILE)) {
            try {
                synced = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
                if (!Array.isArray(synced)) synced = []
            } catch {
                synced = []
            }
        }

        const idStr = String(igStoryId)
        if (!synced.includes(idStr)) {
            synced.push(idStr)
            fs.writeFileSync(CACHE_FILE, JSON.stringify(synced, null, 2), 'utf-8')
        }
    } catch (err) {
        logger.error(`[STORY SYNC] Gagal update cache: ${err.message}`)
    }
}

/**
 * Kirim file media story beserta metadatanya ke API website kelas CE F
 */
export async function forwardStoryToWebsite({
    mediaBuffer,
    thumbnailBuffer,
    filename,
    igStoryId,
    takenAt,
    caption = '',
    author = TARGET_ACCOUNT,
    category = 'General',
    mediaType,
}) {
    try {
        if (igStoryId && isAlreadyArchived(igStoryId)) {
            botLogger.info('story-sync', `Story ${igStoryId} sudah pernah diarsipkan. Lewati.`)
            return { skipped: true, igStoryId }
        }

        const isVideo = mediaType === 'video' || (filename && (filename.endsWith('.mp4') || filename.endsWith('.mov') || filename.endsWith('.webm')))
        const finalFilename = filename || `story_${igStoryId || Date.now()}.${isVideo ? 'mp4' : 'jpg'}`
        const mimeType = isVideo ? 'video/mp4' : 'image/jpeg'

        const buildFormData = () => {
            const form = new FormData()
            form.append('file', mediaBuffer, { filename: finalFilename, contentType: mimeType })
            
            if (thumbnailBuffer) {
                form.append('thumbnail', thumbnailBuffer, { filename: `thumb_${igStoryId || Date.now()}.jpg`, contentType: 'image/jpeg' })
            }
            
            if (takenAt) form.append('timestamp', String(takenAt))
            if (caption) form.append('caption', caption)
            form.append('author', author)
            form.append('category', category)
            if (igStoryId) form.append('igStoryId', String(igStoryId))
            form.append('apiKey', API_SECRET_KEY)
            return form
        }

        let targetUrl = WEB_API_URL
        let response

        try {
            const form = buildFormData()
            response = await axios.post(targetUrl, form, {
                headers: {
                    ...form.getHeaders(),
                    'x-api-key': API_SECRET_KEY,
                },
                timeout: 35000,
            })
        } catch (postErr) {
            // Fallback cerdas: Jika domain produksi cef25.my.id bermasalah/404 dan server dev lokal nyala, coba http://localhost:3000/api/stories
            if (targetUrl.includes('cef25.my.id')) {
                try {
                    botLogger.warn('story-sync', `Koneksi ke ${targetUrl} gagal (${postErr.message}), mencoba fallback ke http://localhost:3000/api/stories...`)
                    const localForm = buildFormData()
                    response = await axios.post('http://localhost:3000/api/stories', localForm, {
                        headers: {
                            ...localForm.getHeaders(),
                            'x-api-key': API_SECRET_KEY,
                        },
                        timeout: 10000,
                    })
                    targetUrl = 'http://localhost:3000/api/stories'
                } catch (_) {
                    throw postErr
                }
            } else {
                throw postErr
            }
        }

        if (response?.data?.success) {
            if (igStoryId) markAsArchived(igStoryId)
            botLogger.info('story-sync', `✅ Berhasil mengarsipkan story ${finalFilename} ke website (${targetUrl})`)
            return { success: true, story: response.data.story, targetUrl }
        } else {
            throw new Error(response?.data?.error || 'Gagal mengirim story ke website')
        }
    } catch (error) {
        botLogger.err('story-sync', error, 'forwardStoryToWebsite')
        throw error
    }
}

/**
 * Scrape media story aktif dari Instagram (@comeinone.f)
 */
export async function fetchTargetStories(username = TARGET_ACCOUNT) {
    const cleanUser = username.replace(/^@/, '').trim()
    const storyUrl = `https://www.instagram.com/stories/${cleanUser}/`

    botLogger.info('story-sync', `Memeriksa story terbaru untuk akun @${cleanUser}...`)

    // 1. Metode Utama: btch-downloader (igdl)
    try {
        const { igdl } = await import('btch-downloader')
        const res = await igdl(storyUrl)
        if (res?.status && Array.isArray(res.result) && res.result.length > 0) {
            const items = []
            for (let idx = 0; idx < res.result.length; idx++) {
                const item = res.result[idx]
                const downloadUrl = item.url
                if (!downloadUrl) continue

                let igStoryId = null

                // Coba ekstrak xpv_asset_id dari parameter token JWT (rapidcdn)
                if (downloadUrl.includes('token=')) {
                    try {
                        const token = downloadUrl.split('token=')[1]?.split('&')[0]
                        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
                        if (payload.efg) {
                            const decodedEfg = JSON.parse(decodeURIComponent(Buffer.from(payload.efg, 'base64').toString('utf8')))
                            if (decodedEfg.xpv_asset_id) {
                                igStoryId = String(decodedEfg.xpv_asset_id)
                            }
                        }
                        if (!igStoryId && payload.filename) {
                            igStoryId = payload.filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '')
                        }
                    } catch (_) {}
                }

                if (!igStoryId && item.filename) {
                    igStoryId = item.filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '')
                }

                if (!igStoryId) {
                    // Fallback hash konsisten dari URL
                    igStoryId = crypto.createHash('md5').update(downloadUrl).digest('hex').slice(0, 16)
                }

                const isVideo = downloadUrl.includes('.mp4') || (item.filename && item.filename.endsWith('.mp4')) || downloadUrl.includes('v2?')
                const filename = item.filename || `story_${igStoryId}.${isVideo ? 'mp4' : 'jpg'}`

                items.push({
                    igStoryId,
                    downloadUrl,
                    thumbnail: item.thumbnail,
                    isVideo: Boolean(isVideo),
                    filename,
                })
            }
            if (items.length > 0) {
                botLogger.info('story-sync', `Ditemukan ${items.length} story aktif dari @${cleanUser}`)
                return items
            }
        }
    } catch (err) {
        botLogger.warn('story-sync', `Scraper btch-downloader gagal: ${err.message}`)
    }

    botLogger.info('story-sync', `Tidak ada story aktif atau akun @${cleanUser} belum memposting story.`)
    return []
}

/**
 * Fungsi utama sinkronisasi: fetch story, download buffer, cek duplikasi, dan upload ke web
 */
export async function syncInstagramStories(sock = null, options = {}) {
    const { notifyChatId = null, targetUser = TARGET_ACCOUNT } = options
    const results = {
        totalFound: 0,
        synced: [],
        skipped: [],
        errors: [],
    }

    try {
        const stories = await fetchTargetStories(targetUser)
        results.totalFound = stories.length

        if (stories.length === 0) {
            return results
        }

        for (const story of stories) {
            if (isAlreadyArchived(story.igStoryId)) {
                results.skipped.push(story.igStoryId)
                continue
            }

            try {
                botLogger.info('story-sync', `Mengunduh media story [${story.igStoryId}] (${story.filename})...`)
                const mediaRes = await axios.get(story.downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 45000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
                    },
                })

                const mediaBuffer = Buffer.from(mediaRes.data)
                
                // Cegah duplikasi berdasarkan konten asli media menggunakan MD5 hash
                const crypto = await import('crypto')
                const mediaHash = crypto.createHash('md5').update(mediaBuffer).digest('hex')
                
                if (isAlreadyArchived(mediaHash)) {
                    botLogger.info('story-sync', `Media story [${story.igStoryId}] sudah diarsipkan sebelumnya (Hash match). Skipping.`)
                    markAsArchived(story.igStoryId) // Tandai ID baru dari snapsave agar ke depannya lgsg di-skip tanpa download
                    results.skipped.push(story.igStoryId)
                    continue
                }
                
                // Tandai hash konten ini sebagai sudah diupload
                markAsArchived(mediaHash)

                let thumbnailBuffer = null
                if (story.thumbnail) {
                    try {
                        const thumbRes = await axios.get(story.thumbnail, { responseType: 'arraybuffer', timeout: 15000 })
                        thumbnailBuffer = Buffer.from(thumbRes.data)
                    } catch (thumbErr) {
                        botLogger.warn('story-sync', `Gagal mengunduh thumbnail untuk [${story.igStoryId}]: ${thumbErr.message}`)
                    }
                }

                const uploadRes = await forwardStoryToWebsite({
                    mediaBuffer,
                    thumbnailBuffer,
                    filename: story.filename,
                    igStoryId: story.igStoryId,
                    author: targetUser,
                    category: getAutoCategory(),
                    mediaType: story.isVideo ? 'video' : 'image',
                })

                if (uploadRes.success) {
                    results.synced.push({
                        igStoryId: story.igStoryId,
                        filename: story.filename,
                        story: uploadRes.story,
                    })

                    // Kirim notifikasi WhatsApp ke room/grup tujuan jika ada
                    const notifyJid = notifyChatId || process.env.CEF_STORY_NOTIFY_JID || process.env.LOG_CHANNEL_JID
                    if (sock && notifyJid) {
                        try {
                            const notifMsg =
                                `✅ *Story Baru Berhasil Diarsipkan!* 📸\n\n` +
                                `👤 *Akun*: @${targetUser}\n` +
                                `📁 *ID*: \`${story.igStoryId}\`\n` +
                                `🎬 *Tipe*: ${story.isVideo ? 'Video' : 'Foto'}\n` +
                                `🏷️ *Kategori*: ${getAutoCategory()}\n` +
                                `🌐 *Portal Arsip*: https://cef25.my.id\n\n` +
                                `_Ketik .setkategori <nama> untuk mengubah target kategori otomatis_`
                            await sock.sendMessage(notifyJid, { text: notifMsg })
                        } catch (notifErr) {
                            botLogger.warn('story-sync', `Gagal kirim notifikasi WhatsApp: ${notifErr.message}`)
                        }
                    }
                }
            } catch (storyErr) {
                botLogger.err('story-sync', storyErr, `Sync story ${story.igStoryId}`)
                results.errors.push({ igStoryId: story.igStoryId, error: storyErr.message })
            }
        }
    } catch (err) {
        botLogger.err('story-sync', err, 'syncInstagramStories')
        results.errors.push({ error: err.message })
    }

    return results
}

/**
 * Inisialisasi background scheduler untuk polling story otomatis
 */
let _storySchedulerStarted = false

export function initStorySyncScheduler(sock) {
    if (_storySchedulerStarted) return
    _storySchedulerStarted = true

    botLogger.system(`Instagram Story Sync scheduler started ✓ (Interval: setiap ${INTERVAL_MINUTES} menit)`)

    // Polling pertama setelah bot online 10 detik agar koneksi stabil
    setTimeout(async () => {
        try {
            botLogger.info('story-sync', 'Menjalankan pengecekan story Instagram awal...')
            await syncInstagramStories(sock)
        } catch (err) {
            botLogger.warn('story-sync', `Pengecekan awal gagal: ${err.message}`)
        }
    }, 10000)

    // Polling berkala setiap INTERVAL_MINUTES menit
    setInterval(async () => {
        try {
            botLogger.info('story-sync', `[Scheduler] Menjalankan pengecekan story berkala (${INTERVAL_MINUTES}m)...`)
            await syncInstagramStories(sock)
        } catch (err) {
            botLogger.warn('story-sync', `[Scheduler] Gagal sync story: ${err.message}`)
        }
    }, INTERVAL_MINUTES * 60 * 1000)
}

export default {
    isAlreadyArchived,
    markAsArchived,
    getAutoCategory,
    setAutoCategory,
    forwardStoryToWebsite,
    fetchTargetStories,
    syncInstagramStories,
    initStorySyncScheduler,
}
