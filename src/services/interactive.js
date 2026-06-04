// src/services/interactive.js
// Menyimpan sesi interaktif yang menunggu balasan user

class InteractiveService {
    constructor() {
        this.sessions = new Map()
    }

    /**
     * Membuat sesi interaktif baru
     * @param {string} msgId - ID pesan bot yang akan di-reply oleh user
     * @param {string} chatId - Chat ID
     * @param {string} sender - Pengirim yang berhak merespon
     * @param {Function} handler - Fungsi yang akan dipanggil saat ada balasan
     */
    createSession(msgId, chatId, sender, handler) {
        this.sessions.set(msgId, {
            chatId,
            sender,
            handler,
            timestamp: Date.now()
        })
        
        // Auto-cleanup setelah 5 menit
        setTimeout(() => {
            this.sessions.delete(msgId)
        }, 5 * 60 * 1000)
    }

    /**
     * Mengecek dan memproses pesan jika itu adalah balasan sesi interaktif
     * @param {Object} ctx - Context pesan dari message handler
     * @returns {boolean} - True jika pesan diproses sebagai sesi interaktif
     */
    async handleReply(ctx) {
        const { quotedMsgId, sender, chatId, body } = ctx
        if (!quotedMsgId) return false

        const session = this.sessions.get(quotedMsgId)
        if (!session) return false

        // Pastikan hanya pengirim asli yang bisa merespon
        const isChatMatch = Array.isArray(session.chatId) ? session.chatId.includes(chatId) : session.chatId === chatId;
        const isSenderMatch = Array.isArray(session.sender) ? session.sender.includes(sender) : session.sender === sender;

        if (isChatMatch && isSenderMatch) {
            this.sessions.delete(quotedMsgId)
            await session.handler(ctx, body.trim())
            return true
        }

        return false
    }
}

export const interactiveService = new InteractiveService()
