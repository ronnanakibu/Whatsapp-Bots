// src/services/interactive.js
// Menyimpan sesi interaktif yang menunggu balasan user (Teks & Tombol Interaktif)

class InteractiveService {
    constructor() {
        this.sessions = new Map()
    }

    /**
     * Membuat sesi interaktif baru
     * @param {string} msgId - ID pesan bot yang akan di-reply oleh user / di-klik tombolnya
     * @param {string|string[]} chatId - Chat ID
     * @param {string|string[]} sender - Pengirim yang berhak merespon
     * @param {Function} handler - Fungsi yang akan dipanggil saat ada balasan
     * @param {number} [ttlMs=300000] - Masa berlaku sesi (default 5 menit)
     */
    createSession(msgId, chatId, sender, handler, ttlMs = 5 * 60 * 1000) {
        if (!msgId) return
        this.sessions.set(msgId, {
            chatId,
            sender,
            handler,
            timestamp: Date.now()
        })

        // Auto-cleanup
        setTimeout(() => {
            this.sessions.delete(msgId)
        }, ttlMs)
    }

    /**
     * Helper untuk mengekstrak respons teks atau tombol ID dari message context
     */
    extractAnswer(ctx) {
        const { msg, body } = ctx
        const message = msg?.message || {}

        // 1. Native Flow Interactive Button
        if (message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
            try {
                const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)
                if (params.id) return String(params.id).trim()
            } catch (_) {}
        }

        // 2. Buttons Response Message
        if (message.buttonsResponseMessage?.selectedButtonId) {
            return String(message.buttonsResponseMessage.selectedButtonId).trim()
        }

        // 3. Template Button Reply Message
        if (message.templateButtonReplyMessage?.selectedId) {
            return String(message.templateButtonReplyMessage.selectedId).trim()
        }

        // 4. List Response Message
        if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
            return String(message.listResponseMessage.singleSelectReply.selectedRowId).trim()
        }

        return (body || '').trim()
    }

    /**
     * Helper pengenal jawaban "Ya / Setuju / Spill"
     */
    isAffirmative(answer = '') {
        const clean = String(answer).trim().toLowerCase()
        const positives = ['1', 'ya', 'yes', 'spill', 'kirim', 'gas', 'lanjut', 'y', 'oke', 'ok', 'antisnitch_1', 'true']
        return positives.includes(clean)
    }

    /**
     * Helper pengenal jawaban "Tidak / Batal / Abaikan"
     */
    isNegative(answer = '') {
        const clean = String(answer).trim().toLowerCase()
        const negatives = ['0', 'ga', 'gak', 'ngga', 'tidak', 'no', 'batal', 'abaikan', 'skip', 'n', 'antisnitch_0', 'false', 'privasi']
        return negatives.includes(clean)
    }

    /**
     * Mengecek dan memproses pesan jika itu adalah balasan sesi interaktif
     * @param {Object} ctx - Context pesan dari message handler
     * @returns {boolean} - True jika pesan diproses sebagai sesi interaktif
     */
    async handleReply(ctx) {
        const { quotedMsgId, sender, chatId } = ctx
        const targetMsgId = quotedMsgId ||
            ctx.msg?.message?.buttonsResponseMessage?.contextInfo?.stanzaId ||
            ctx.msg?.message?.templateButtonReplyMessage?.contextInfo?.stanzaId ||
            ctx.msg?.message?.interactiveResponseMessage?.contextInfo?.stanzaId

        if (!targetMsgId) return false

        const session = this.sessions.get(targetMsgId)
        if (!session) return false

        // Pastikan chat dan pengirim cocok
        const isChatMatch = Array.isArray(session.chatId) ? session.chatId.includes(chatId) : session.chatId === chatId
        const isSenderMatch = Array.isArray(session.sender) ? session.sender.includes(sender) : session.sender === sender

        if (isChatMatch && isSenderMatch) {
            this.sessions.delete(targetMsgId)
            const answer = this.extractAnswer(ctx)
            await session.handler(ctx, answer)
            return true
        }

        return false
    }
}

export const interactiveService = new InteractiveService()
