import { logger } from './logger.js'

export async function logToChannel(sock, messageContent) {
    try {
        const logJid = process.env.LOG_CHANNEL_JID
        if (!logJid) return // Tidak ada channel log yang diset

        // Tambahkan konteks forwarding agar kelihatan lebih rapi di channel
        await sock.sendMessage(logJid, messageContent)
    } catch (err) {
        logger.error('❌ [ChannelLogger] Gagal mengirim log ke channel:', err.message)
    }
}
