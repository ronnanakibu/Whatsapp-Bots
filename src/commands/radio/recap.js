// src/commands/radio/recap.js
// Spotify-like Monthly Recap and Wrapped statistics

import { db } from '../../services/db.js'

function getMonthRange(monthOffset = 0, targetYear = null, targetMonth = null) {
    const now = new Date();
    // Convert to Asia/Jakarta timezone equivalent Date
    const jakartaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    
    let year = targetYear !== null ? targetYear : jakartaTime.getFullYear();
    let month = targetMonth !== null ? targetMonth - 1 : jakartaTime.getMonth() + monthOffset;
    
    // Normalize month and year in case of offsets
    const dateObj = new Date(year, month, 1);
    year = dateObj.getFullYear();
    month = dateObj.getMonth();

    const monthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    
    // Asia/Jakarta offset is +7 hours = 7 * 3600 * 1000 ms.
    // To find the UTC time that represents local 00:00:00, we subtract 7 hours.
    const startEpoch = Math.floor(Date.UTC(year, month, 1, 0, 0, 0, 0) / 1000) - (7 * 3600);
    const endEpoch = Math.floor(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) / 1000) - (7 * 3600) - 1;
    
    return {
        startEpoch,
        endEpoch,
        monthName: monthNames[month],
        year
    };
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

export default {
    name: 'recap',
    aliases: ['wrapped', 'rekap', 'monthlyrecap'],
    category: 'radio',
    description: 'Tampilkan rekapitulasi & Spotify-style Wrapped bulanan radio',
    usage: '.recap [me] [last] [1-12]',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { reply, args, sender, pushName, react } = ctx

        let isMe = false
        let offset = 0
        let targetMonthNum = null

        // Parse arguments
        for (const arg of args.map(a => a.toLowerCase())) {
            if (arg === 'me' || arg === 'saya' || arg === 'aku') {
                isMe = true
            } else if (arg === 'last' || arg === 'lalu' || arg === 'kemarin') {
                offset = -1
            } else {
                const num = parseInt(arg)
                if (!isNaN(num) && num >= 1 && num <= 12) {
                    targetMonthNum = num
                }
            }
        }

        const { startEpoch, endEpoch, monthName, year } = getMonthRange(offset, null, targetMonthNum)
        await react('📊')

        // ─────────────────────────────────────────────
        // CASE 1: PERSONAL RECAP (.recap me)
        // ─────────────────────────────────────────────
        if (isMe) {
            try {
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
                let text = `🎧 *YOUR RADIO WRAPPED - ${monthName.toUpperCase()} ${year}* 🎧\n` +
                           `Halo, *${pushName}*! Ini rangkuman perjalanan musikmu bulan ini:\n\n` +
                           `⭐ *Level Anda:* ${level} (${xp} XP)\n` +
                           `🎵 *Total Request:* ${reqCount} lagu diputar\n` +
                           `⏱️ *Waktu Mendengar:* ${formatDuration(listenTime)}\n\n`

                if (topSongs && topSongs.length > 0) {
                    text += `🏆 *3 Lagu Favoritmu Bulan Ini:*\n`
                    topSongs.forEach((song, i) => {
                        text += `  ${i + 1}. *${song.title}* - _${song.artist}_ (${song.count}x request)\n`
                    })
                } else {
                    text += `🏆 *Lagu teratas:* Kamu belum banyak memutar musik bulan ini. Yuk request lebih banyak lagu!`
                }

                text += `\n_Ketik \`.recap\` untuk melihat statistik global radio bulan ini._`
                return reply(text)

            } catch (err) {
                return reply(`❌ Gagal menyusun rekap personal: ${err.message}`)
            }
        }

        // ─────────────────────────────────────────────
        // CASE 2: GLOBAL RECAP (.recap / .recap last)
        // ─────────────────────────────────────────────
        try {
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
            let text = `📻 *RADIO RECAP & WRAPPED - ${monthName.toUpperCase()} ${year}* 📻\n` +
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

            text += `_Ketik \`.recap me\` untuk melihat rangkuman musikmu sendiri bulan ini!_`
            return reply(text)

        } catch (err) {
            return reply(`❌ Gagal menyusun rekap global: ${err.message}`)
        }
    }
}
