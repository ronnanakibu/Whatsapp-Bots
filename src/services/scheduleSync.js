import axios from 'axios'
import { logger } from '../utils/logger.js'
import Database from 'better-sqlite3'
import path from 'path'

let _sock = null
let _scheduleSyncStarted = false

/**
 * Format string waktu agar mudah dibaca
 */
function formatTimeRange(start, end) {
    return `${start} - ${end}`
}

/**
 * Helper mengubah HH:MM ke UNIX timestamp untuk hari ini
 */
function timeToTodayUnix(timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    const now = new Date()
    now.setHours(h, m, 0, 0)
    return Math.floor(now.getTime() / 1000)
}

/**
 * Sync jadwal setiap jam 05:00 AM
 */
export function initScheduleSync(sock) {
    if (_scheduleSyncStarted) return
    _scheduleSyncStarted = true
    _sock = sock

    logger.info('Schedule Sync scheduler started')

    // Cek setiap menit apakah jam 05:00 AM
    setInterval(async () => {
        const now = new Date()
        // Konversi ke Timezone bot jika perlu, atau gunakan waktu sistem (asumsi sudah diset via BOT_TIMEZONE)
        
        // Kita trigger hanya tepat di jam 5:00
        if (now.getHours() === 5 && now.getMinutes() === 0) {
            await runDailyScheduleBroadcast()
        }
    }, 60 * 1000)
}

/**
 * Fungsi untuk menjalankan proses ambil data dan broadcast
 */
export async function runDailyScheduleBroadcast() {
    try {
        const groupId = process.env.CEF_GROUP_JID
        if (!groupId) {
            logger.warn('[ScheduleSync] CEF_GROUP_JID belum diset. Lewati broadcast.')
            return
        }

        logger.info('[ScheduleSync] Mengambil jadwal hari ini dari web...')
        
        // Ambil data jadwal
        // TODO: Sesuaikan domain dengan endpoint yg aktif
        const response = await axios.get('https://cef25.my.id/api/absensi/schedules', { timeout: 10000 })
        const schedules = response.data?.schedules

        if (!schedules || !Array.isArray(schedules)) {
            logger.error('[ScheduleSync] Format data dari API jadwal tidak valid.')
            return
        }

        // Tentukan hari saat ini (1 = Senin, ... 6 = Sabtu)
        const today = new Date().getDay()
        
        // Filter jadwal untuk hari ini dan urutkan berdasarkan order/les
        const todaysSchedules = schedules
            .filter(s => s.dayOfWeek === today)
            .sort((a, b) => a.order - b.order)

        if (todaysSchedules.length === 0) {
            logger.info('[ScheduleSync] Tidak ada jadwal untuk hari ini.')
            // Bisa pilih untuk kirim "Tidak ada jadwal" atau cukup diam saja.
            // Kita diam saja agar tidak nyepam grup.
            return
        }

        // Format pesan
        const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
        let text = `📢 *JADWAL KULIAH HARI INI (${daysIndo[today]})*\n\n`
        text += `Halo kawan-kawan kelas F! Berikut adalah jadwal perkuliahan kita hari ini:\n\n`

        todaysSchedules.forEach(slot => {
            text += `📚 *${slot.courseName}*\n`
            text += `👨‍🏫 ${slot.teacherName}\n`
            text += `🕐 ${formatTimeRange(slot.startTime, slot.endTime)}\n`
            text += `⚡ Les ke-${slot.order}\n\n`
        })

        text += `Jangan sampai telat cuy! Semangat ngoding! 💻🔥`

        // Ambil metadata grup untuk memention semua member
        const metadata = await _sock.groupMetadata(groupId)
        const participants = metadata.participants.map(p => p.id)

        // Kirim pesan dengan mention all
        await _sock.sendMessage(groupId, {
            text,
            mentions: participants
        })

        logger.info(`[ScheduleSync] Berhasil broadcast jadwal hari ini ke grup ${groupId}`)

        // ── AUTO-INJECT BREAK REMINDERS ──
        try {
            const dbPath = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
            const db = new Database(dbPath)

            for (let i = 0; i < todaysSchedules.length - 1; i++) {
                const current = todaysSchedules[i]
                const next = todaysSchedules[i + 1]
                
                const currentEndUnix = timeToTodayUnix(current.endTime)
                const nextStartUnix = timeToTodayUnix(next.startTime)
                
                const gapMinutes = Math.floor((nextStartUnix - currentEndUnix) / 60)
                
                // Jika gap lebih dari 10 menit, anggap sebagai jam break
                if (gapMinutes >= 10) {
                    const fireAt = currentEndUnix
                    const msg = `☕ *WAKTU ISTIRAHAT!*\n\nBreak telah tiba sampai jam ${next.startTime} (${gapMinutes} menit). Jangan lupa regangkan badan & ngopi cuy! ☕`
                    
                    db.prepare(`
                        INSERT INTO reminders (user_jid, chat_id, message, fire_at, quoted_msg)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(_sock.user?.id || 'system', groupId, msg, fireAt, null)
                    
                    logger.info(`[ScheduleSync] Menambahkan auto-reminder istirahat pada ${current.endTime}`)
                }
            }
            db.close()
        } catch (dbErr) {
            logger.error(`[ScheduleSync] Gagal inject break reminder: ${dbErr.message}`)
        }
        
    } catch (err) {
        logger.error(`[ScheduleSync] Gagal runDailyScheduleBroadcast: ${err.message}`)
    }
}
