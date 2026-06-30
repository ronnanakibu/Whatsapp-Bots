// src/commands/media/dl.js
// !dl — Universal Social Media Downloader
// Support: Instagram Reels/Post, TikTok, YouTube (audio), Facebook Video
// Alias: !download, !unduh, !reels, !tiktok, !yt, !ytmp3

import { download, detectPlatform } from '../../services/downloader/index.js'
import { extractUrl } from '../../services/downloader/detector.js'
import { formatBytes } from '../../services/downloader/utils.js'
import { downloadQueue } from '../../services/downloader/index.js'
import { interactiveService } from '../../services/interactive.js'
import mediaService from '../../services/media.js'
import { logToChannel } from '../../utils/channelLogger.js'
import { getCleanQuoted } from '../../utils/message.js'

// Platform emoji map untuk display
const PLATFORM_EMOJI = {
    instagram: '📸',
    tiktok: '🎵',
    youtube: '🎬',
    facebook: '📘',
}

const PLATFORM_NAME = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    facebook: 'Facebook',
}

export default {
    name: 'dl',
    aliases: ['download', 'unduh', 'reels', 'tiktok', 'tt', 'ytmp3', 'ytmp4', 'yt', 'mp3', 'mp4', 'ig', 'fb'],
    category: 'media',
    description: 'Download video dari Instagram, TikTok, YouTube, Facebook.',
    usage: '.dl [link] [--boost] [--720p] [--320kbps]',
    example: '.dl https://www.youtube.com/watch?v=xxx --720p',
    cooldown: 10,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sock, chatId, msg, commandName } = ctx

        // ── 1. Ekstrak URL & Flag ─────────────────────────
        let rawInput = args.join(' ').trim()
        const isBoost = rawInput.includes('--boost')
        rawInput = rawInput.replace('--boost', '').trim()

        let targetResolution = null
        let audioQuality = null
        let format = null

        // Detect parameter resolution (e.g. --720p, --1080)
        const resMatch = rawInput.match(/--(1080|720|480|360|240|144)p?/i)
        if (resMatch) {
            targetResolution = resMatch[1]
            format = 'video'
            rawInput = rawInput.replace(resMatch[0], '').trim()
        }

        // Detect parameter audio quality (e.g. --320kbps, --128kbps)
        const audMatch = rawInput.match(/--(320|128)kbps/i)
        if (audMatch) {
            audioQuality = audMatch[1] === '320' ? 'high' : 'normal'
            format = 'audio'
            rawInput = rawInput.replace(audMatch[0], '').trim()
        }

        const url = extractUrl(rawInput) ?? (rawInput.startsWith('http') ? rawInput : null)

        if (!url) {
            return reply(
                `🔗 *Downloader*\n\n` +
                `Kirim link dari:\n` +
                `• 📸 Instagram (Reels/Post/IGTV)\n` +
                `• 🎵 TikTok (no watermark)\n` +
                `• 🎬 YouTube (Video / Audio)\n` +
                `• 📘 Facebook (Video/Reels)\n\n` +
                `*Cara pakai:*\n` +
                `!dl [link] [--boost] [--720p] [--320kbps]\n\n` +
                `_Contoh: !dl https://youtube.com/watch?v=xxx --720p_`
            )
        }

        // ── 2. Detect platform ─────────────────────
        const platform = detectPlatform(url)
        if (!platform) {
            return reply(
                `❌ Link tidak dikenali.\n\n` +
                `Pastikan link dari: Instagram, TikTok, YouTube, atau Facebook.`
            )
        }

        // ── 3. Queue status check ──────────────────
        const qStats = downloadQueue.stats
        if (qStats.pending >= 5) {
            return reply(`⏳ Antrian penuh (${qStats.pending} job). Coba lagi sebentar.`)
        }

        // ── 4. Determine format atau Prompt Interaktif ─────
        const isAudioCommand = ['ytmp3', 'ytaudio', 'mp3'].includes(commandName)
        const isVideoCommand = ['ytmp4', 'ytvideo', 'mp4', 'yt'].includes(commandName)

        if (isAudioCommand) {
            format = 'audio'
            if (!audioQuality) audioQuality = 'high'
        } else if (isVideoCommand) {
            format = 'video'
            if (!targetResolution) targetResolution = '1080'
        }

        if (format || platform !== 'youtube') {
            const opt = {}
            if (format === 'video') opt.resolution = targetResolution || '1080'
            if (format === 'audio') opt.audioQuality = audioQuality || 'high'
            await processDownload(ctx, url, platform, format || 'video', isBoost, opt)
        } else {
            // Interactive Prompt hanya untuk YouTube jika tidak spesifik
            const promptMsg = await reply(
                `📥 *YouTube Downloader* 📥\n\n` +
                `Pilih format & resolusi:\n` +
                `1️⃣ Video - 1080p (FHD)\n` +
                `2️⃣ Video - 720p (HD)\n` +
                `3️⃣ Video - 480p (SD)\n` +
                `4️⃣ Video - 360p (Low)\n` +
                `5️⃣ Audio - High Quality (320kbps)\n` +
                `6️⃣ Audio - Normal Quality (128kbps)\n\n` +
                `_Balas pesan ini dengan angka 1 sampai 6_`
            )

            interactiveService.createSession(
                promptMsg.key.id,
                chatId,
                ctx.sender,
                async (replyCtx, answer) => {
                    let opt = {}
                    if (answer === '1') {
                        opt = { format: 'video', resolution: '1080' }
                    } else if (answer === '2') {
                        opt = { format: 'video', resolution: '720' }
                    } else if (answer === '3') {
                        opt = { format: 'video', resolution: '480' }
                    } else if (answer === '4') {
                        opt = { format: 'video', resolution: '360' }
                    } else if (answer === '5') {
                        opt = { format: 'audio', audioQuality: 'high' }
                    } else if (answer === '6') {
                        opt = { format: 'audio', audioQuality: 'normal' }
                    } else {
                        return await replyCtx.reply('❌ Pilihan tidak valid. Silakan ulangi perintah !dl')
                    }
                    await processDownload(replyCtx, url, platform, opt.format, isBoost, opt)
                }
            )
        }
    }
}

// ─────────────────────────────────────────────
// PROSES DOWNLOAD (Pisah Fungsi biar rapi)
// ─────────────────────────────────────────────

async function processDownload(ctx, url, platform, format, isBoost = false, downloadOptions = {}) {
    const { reply, react, sock, chatId, msg, pushName, sender } = ctx
    
    await react('⏳')
    const emoji = PLATFORM_EMOJI[platform] || '📥'
    
    let details = ''
    if (downloadOptions.resolution) details = ` (${downloadOptions.resolution}p)`
    if (downloadOptions.audioQuality) details = ` (${downloadOptions.audioQuality === 'high' ? '320kbps' : '128kbps'})`

    await reply(
        `${emoji} *Sedang download ${format === 'audio' ? 'Audio' : 'Video'}${details}...*\n` +
        `_Mohon tunggu sebentar_`
    )

    try {
        const result = await download(url, { format, ...downloadOptions })

        if (isBoost) {
            const ext = result.ext || (format === 'audio' ? 'mp3' : 'mp4')
            result.buffer = await mediaService.boostMediaVolume(result.buffer, ext, 5.0)
            if (result.caption) {
                result.caption += `\n🔊 _(Audio Boosted 500%)_`
            }
        }

        await sendMedia(sock, chatId, msg, result)
        await logMediaDL(sock, pushName, sender, result)
        await react('✅')
    } catch (err) {
        await react('❌')
        const errMsg = formatError(err.message, platform)
        await reply(`❌ *Gagal download*\n\n${errMsg}`)
    }
}

// ─────────────────────────────────────────────
// SEND MEDIA — Route buffer ke tipe yang tepat
// ─────────────────────────────────────────────

async function sendMedia(sock, chatId, quotedMsg, result) {
    const { buffer, mimeType, caption, type, ext } = result

    const baseOpts = { quoted: getCleanQuoted(quotedMsg) }

    if (type === 'video' || mimeType?.startsWith('video/')) {
        await sock.sendMessage(chatId, {
            video: buffer,
            caption,
            mimetype: mimeType ?? 'video/mp4',
            fileName: result.filename,
        }, baseOpts)

    } else if (type === 'audio' || mimeType?.startsWith('audio/')) {
        await sock.sendMessage(chatId, {
            audio: buffer,
            caption,
            mimetype: mimeType ?? 'audio/mpeg',
            fileName: result.filename,
            ptt: false, // false = audio file, bukan voice note
        }, baseOpts)

    } else if (type === 'image' || mimeType?.startsWith('image/')) {
        await sock.sendMessage(chatId, {
            image: buffer,
            caption,
            mimetype: mimeType ?? 'image/jpeg',
            fileName: result.filename,
        }, baseOpts)

    } else {
        // Fallback: kirim sebagai dokumen
        await sock.sendMessage(chatId, {
            document: buffer,
            caption,
            mimetype: mimeType ?? 'application/octet-stream',
            fileName: result.filename,
        }, baseOpts)
    }
}

// ─────────────────────────────────────────────
// ERROR FORMATTER
// ─────────────────────────────────────────────

function formatError(message = '', platform = '') {
    // Timeout
    if (message.includes('Timeout') || message.includes('timeout')) {
        return `Koneksi timeout. Server mungkin lambat, coba lagi.`
    }

    // File terlalu besar
    if (message.includes('terlalu besar') || message.includes('MB')) {
        return `File terlalu besar untuk dikirim via WhatsApp (max 50MB).`
    }

    // Semua API gagal
    if (message.includes('Semua API')) {
        const tips = {
            instagram: `Pastikan:\n• Link bukan dari akun private\n• Link masih valid (tidak expired)`,
            tiktok: `Pastikan:\n• Link valid dan video masih ada\n• Coba copy link dari TikTok langsung`,
            youtube: `Pastikan:\n• Video tidak private/umur terbatas\n• Link valid`,
            facebook: `Pastikan:\n• Video bukan dari akun private\n• Link masih valid`,
        }
        return `${message}\n\n${tips[platform] ?? ''}`
    }

    return message
}

async function logMediaDL(sock, pushName, sender, result) {
    if (!process.env.LOG_CHANNEL_JID) return
    const { buffer, mimeType, type } = result
    let caption = `[LOG DOWNLOAD]\nUser: ${pushName} (@${sender.split('@')[0]})\nPlatform: ${result.platform}\nFile: ${result.filename}`
    
    if (type === 'video' || mimeType?.startsWith('video/')) {
        await logToChannel(sock, { video: buffer, caption })
    } else if (type === 'audio' || mimeType?.startsWith('audio/')) {
        await logToChannel(sock, { audio: buffer, mimetype: mimeType, caption })
    } else if (type === 'image' || mimeType?.startsWith('image/')) {
        await logToChannel(sock, { image: buffer, caption })
    }
}