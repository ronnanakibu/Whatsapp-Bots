import axios from 'axios'
import { logger, botLogger } from '../utils/logger.js'
import { startWhatsAppClient, stopWhatsAppClient, sock } from '../core/bot.js'

let watcherInterval = null
let failCount = 0
const MAX_FAILS = 3
const PING_INTERVAL = 10000 // 10 detik

export function startFailoverWatcher() {
    const pingUrl = process.env.PRIMARY_PING_URL
    if (!pingUrl) {
        logger.error('[Failover] PRIMARY_PING_URL belum di-set di .env!')
        return
    }

    logger.info(`[Failover] Berjalan dalam mode SECONDARY. Memantau Primary: ${pingUrl}`)

    watcherInterval = setInterval(async () => {
        try {
            const res = await axios.get(pingUrl, { timeout: 5000 })
            
            // Jika Primary membalas (Berarti Primary HIDUP)
            if (res.status === 200) {
                failCount = 0 // Reset fail count

                // Jika Lite (Secondary) saat ini sedang aktif WhatsApp-nya,
                // berarti Primary baru saja online kembali. Kita harus mundur (Standby).
                if (sock) {
                    botLogger.warn('failover', 'Primary host kembali ONLINE! Mematikan koneksi WhatsApp di Lite host untuk menghindari konflik (kembali ke mode Standby).')
                    stopWhatsAppClient()
                }
            }
        } catch (err) {
            // Jika request gagal (timeout, ECONNREFUSED, dll) -> Primary MATI
            failCount++
            logger.warn(`[Failover] Primary tidak merespon (${failCount}/${MAX_FAILS}): ${err.message}`)

            if (failCount >= MAX_FAILS) {
                // Jangan tambah terus menerus agar log tidak spam
                if (failCount === MAX_FAILS) {
                    botLogger.fatal('failover', 'Primary host dinyatakan DOWN! Lite host mengambil alih (Takeover).')
                }
                
                // Mulai WhatsApp jika belum mulai
                if (!sock) {
                    startWhatsAppClient()
                }
            }
        }
    }, PING_INTERVAL)
}
