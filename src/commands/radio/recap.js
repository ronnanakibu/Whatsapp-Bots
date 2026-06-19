// src/commands/radio/recap.js
// Spotify-like Weekly Recap and Wrapped statistics

import { db } from '../../services/db.js'
import { logger } from '../../utils/logger.js'

function getWeekRange(offset = 0) {
    const now = new Date()
    // Convert to Asia/Jakarta timezone equivalent Date
    const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
    
    // Dapatkan hari dalam minggu (0 = Minggu, 1 = Senin, ..., 6 = Sabtu)
    const currentDay = jakartaTime.getDay()
    // Awal minggu adalah Senin (1). Jika Minggu (0), kita anggap hari ke-7
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1
    
    // Dapatkan hari Senin minggu target
    const monday = new Date(jakartaTime)
    monday.setDate(jakartaTime.getDate() - distanceToMonday + (offset * 7))
    monday.setHours(0, 0, 0, 0)
    
    // Dapatkan hari Minggu minggu target
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    
    const startEpoch = Math.floor(monday.getTime() / 1000)
    const endEpoch = Math.floor(sunday.getTime() / 1000)
    
    // Format nama tanggal, misal "15 Juni - 21 Juni 2026"
    const options = { day: 'numeric', month: 'long' }
    const startStr = monday.toLocaleDateString('id-ID', options)
    const endStr = sunday.toLocaleDateString('id-ID', { ...options, year: 'numeric' })
    
    return {
        startEpoch,
        endEpoch,
        weekRangeStr: `${startStr} - ${endStr}`
    }
}

function formatDuration(seconds) {
    if (!seconds) return '0 menit'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    
    if (hours > 0) {
        return `${hours} jam ${minutes} menit`
    }
    return `${minutes} menit`
}

export function generateWeeklyRecap(offset = 0) {
    const { startEpoch, endEpoch, weekRangeStr } = getWeekRange(offset)
    
    // 1. Total songs played
    const totalPlayed = db.prepare(`
        SELECT COUNT(*) as count 
        FROM play_history 
        WHERE played_at >= ? AND played_at <= ?
    `).get(startEpoch, endEpoch)?.count || 0

    // 2. Top played songs
    const topSongs = db.prepare(`
        SELECT s.title, s.artist, COUNT(*) as count
        FROM play_history ph
        JOIN songs s ON ph.song_id = s.song_id
        WHERE ph.played_at >= ? AND ph.played_at <= ?
        GROUP BY ph.song_id
        ORDER BY count DESC
        LIMIT 5
    `).all(startEpoch, endEpoch)

    // 3. Top requesters
    const topRequesters = db.prepare(`
        SELECT u.name, COUNT(*) as count
        FROM requests r
        JOIN users u ON r.user_jid = u.jid
        WHERE r.created_at >= ? AND r.created_at <= ? AND r.status = 'played'
        GROUP BY r.user_jid
        ORDER BY count DESC
        LIMIT 3
    `).all(startEpoch, endEpoch)

    // 4. Top listeners (listening duration)
    const topListeners = db.prepare(`
        SELECT u.name, SUM(ls.duration_seconds) as total_duration
        FROM listening_sessions ls
        JOIN users u ON ls.user_jid = u.jid
        WHERE ls.joined_at >= ? AND ls.joined_at <= ?
        GROUP BY ls.user_jid
        ORDER BY total_duration DESC
        LIMIT 3
    `).all(startEpoch, endEpoch)

    // Render Global Wrapped
    let text = `📻 *RADIO WEEKLY RECAP & WRAPPED* 📻\n` +
               `Periode: *${weekRangeStr}*\n\n` +
               `Statistik siaran dan pendengar radio global:\n\n` +
               `📊 *Total Lagu Diputar:* ${totalPlayed} kali\n\n`

    if (topSongs && topSongs.length > 0) {
        text += `🔥 *5 Lagu Paling Banyak Diputar:*\n`
        topSongs.forEach((song, i) => {
            text += `  ${i + 1}. *${song.title}* - _${song.artist}_ (${song.count}x diputar)\n`
        })
        text += `\n`
    }

    if (topRequesters && topRequesters.length > 0) {
        text += `👑 *Top Requester Teraktif:*\n`
        topRequesters.forEach((req, i) => {
            text += `  ${i + 1}. *${req.name}* (${req.count} lagu)\n`
        })
        text += `\n`
    }

    if (topListeners && topListeners.length > 0) {
        text += `🎧 *Pendengar Paling Setia:*\n`
        topListeners.forEach((lis, i) => {
            text += `  ${i + 1}. *${lis.name}* (${formatDuration(lis.total_duration)})\n`
        })
        text += `\n`
    }

    text += `_Ketik \`.recap me\` untuk melihat rangkuman musikmu sendiri minggu ini!_`
    return text
}

// ─────────────────────────────────────────────
// SCHEDULER WEEKLY RECAP
// ─────────────────────────────────────────────

let _recapSchedulerStarted = false

export function initRecapScheduler(sock) {
    if (_recapSchedulerStarted) return
    _recapSchedulerStarted = true

    logger.info('Weekly recap scheduler initialized')

    let lastTriggerWeekStr = ''

    setInterval(async () => {
        try {
            // Gunakan manual offset (GMT+7)
            const offsetMs = 7 * 60 * 60 * 1000
            const nowJakarta = new Date(Date.now() + offsetMs)
            
            const dayOfWeek = nowJakarta.getUTCDay() // 0 = Minggu, 1 = Senin, ...
            const hours = nowJakarta.getUTCHours()
            const minutes = nowJakarta.getUTCMinutes()
            
            // Jam 00:00 hari Senin
            if (dayOfWeek === 1 && hours === 0 && minutes === 0) {
                const currentWeekStr = `${nowJakarta.getUTCDate()}-${nowJakarta.getUTCMonth()}-${nowJakarta.getUTCFullYear()}`
                if (lastTriggerWeekStr === currentWeekStr) return
                lastTriggerWeekStr = currentWeekStr

                db.exec(`
                    CREATE TABLE IF NOT EXISTS recap_subscriptions (
                        chat_id TEXT PRIMARY KEY,
                        created_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                `)

                const subs = db.prepare('SELECT chat_id FROM recap_subscriptions').all()
                if (subs.length === 0) return

                logger.info(`[Recap Scheduler] Running weekly automatic reports for ${subs.length} chats...`)

                // Meringkas minggu lalu (-1) karena dijalankan tepat di hari Senin dini hari
                const text = generateWeeklyRecap(-1)

                for (const sub of subs) {
                    try {
                        await sock.sendMessage(sub.chat_id, {
                            text: `🔔 *LAPORAN REKAP RADIO MINGGUAN OTOMATIS*\n\n${text}`
                        })
                    } catch (err) {
                        logger.error(`[Recap Scheduler] Gagal kirim laporan mingguan ke ${sub.chat_id}: ${err.message}`)
                    }
                }
            }
        } catch (err) {
            logger.error('[Recap Scheduler] Error in recap scheduler tick:', err.message)
        }
    }, 30_000)
}

export default {
    name: 'recap',
    aliases: ['wrapped', 'rekap', 'weeklyrecap'],
    category: 'radio',
    description: 'Tampilkan rekapitulasi & Spotify-style Wrapped mingguan radio',
    usage: '.recap [me] [last]',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args, sender, pushName, react, sock } = ctx

        // Pastikan scheduler berjalan
        initRecapScheduler(sock)

        let isMe = false
        let offset = 0

        // Parse arguments
        for (const arg of args.map(a => a.toLowerCase())) {
            if (arg === 'me' || arg === 'saya' || arg === 'aku') {
                isMe = true
            } else if (arg === 'last' || arg === 'lalu' || arg === 'kemarin') {
                offset = -1
            }
        }

        await react('📊')

        if (isMe) {
            try {
                const { startEpoch, endEpoch, weekRangeStr } = getWeekRange(offset)

                // 1. Get user profile
                const userProfile = db.prepare('SELECT level, experience_points FROM users WHERE jid = ?').get(sender)
                const level = userProfile?.level || 1
                const xp = userProfile?.experience_points || 0

                // 2. Total requests played
                const reqCount = db.prepare(`
                    SELECT COUNT(*) as count 
                    FROM requests 
                    WHERE user_jid = ? AND created_at >= ? AND created_at <= ? AND status = 'played'
                `).get(sender, startEpoch, endEpoch)?.count || 0

                // 3. Estimated listening duration
                const listenTime = db.prepare(`
                    SELECT SUM(duration_seconds) as total 
                    FROM listening_sessions 
                    WHERE user_jid = ? AND joined_at >= ? AND joined_at <= ?
                `).get(sender, startEpoch, endEpoch)?.total || 0

                // 4. Top requested / played songs
                const topSongs = db.prepare(`
                    SELECT s.title, s.artist, COUNT(*) as count
                    FROM play_history ph
                    JOIN songs s ON ph.song_id = s.song_id
                    WHERE ph.requested_by_jid = ? AND ph.played_at >= ? AND ph.played_at <= ?
                    GROUP BY ph.song_id
                    ORDER BY count DESC
                    LIMIT 3
                `).all(sender, startEpoch, endEpoch)

                // Render Personal Wrapped
                let text = `🎧 *YOUR RADIO WEEKLY WRAPPED* 🎧\n` +
                           `Periode: *${weekRangeStr}*\n` +
                           `Halo, *${pushName}*! Ini rangkuman perjalanan musikmu minggu ini:\n\n` +
                           `⭐ *Level Anda:* ${level} (${xp} XP)\n` +
                           `🎵 *Total Request:* ${reqCount} lagu diputar\n` +
                           `⏱️ *Waktu Mendengar:* ${formatDuration(listenTime)}\n\n`

                if (topSongs && topSongs.length > 0) {
                    text += `🏆 *3 Lagu Favoritmu Minggu Ini:*\n`
                    topSongs.forEach((song, i) => {
                        text += `  ${i + 1}. *${song.title}* - _${song.artist}_ (${song.count}x request)\n`
                    })
                } else {
                    text += `🏆 *Lagu teratas:* Kamu belum banyak memutar musik minggu ini. Yuk request lebih banyak lagu!`
                }

                text += `\n_Ketik \`.recap\` untuk melihat statistik global radio minggu ini._`
                return reply(text)

            } catch (err) {
                return reply(`❌ Gagal menyusun rekap personal: ${err.message}`)
            }
        }

        // Global Wrapped
        try {
            const text = generateWeeklyRecap(offset)
            return reply(text)
        } catch (err) {
            return reply(`❌ Gagal menyusun rekap global: ${err.message}`)
        }
    }
}
