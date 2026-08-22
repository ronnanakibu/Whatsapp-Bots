// src/services/interactive.js
// Menyimpan sesi interaktif yang menunggu balasan user (Teks & Tombol Interaktif) dengan persistensi SQLite

import { dbService } from './db.js'
import { logger, botLogger } from '../utils/logger.js'

class InteractiveService {
    constructor() {
        this.sessions = new Map()
        this.typeRunners = new Map()
    }

    /**
     * Mendaftarkan handler dispatcher berdasarkan sessionType (e.g. 'anti_snitch', 'view_once')
     */
    registerTypeRunner(type, runnerFn) {
        this.typeRunners.set(type, runnerFn)
    }

    /**
     * Membuat sesi interaktif baru (default tanpa batas waktu / infinite)
     * @param {string} msgId - ID pesan bot yang akan di-reply oleh user / di-klik tombolnya
     * @param {string|string[]} chatId - Chat ID
     * @param {string|string[]} sender - Pengirim yang berhak merespon
     * @param {Function|string} handlerOrType - Fungsi callback ATAU nama tipe sesi yang terdaftar
     * @param {Object} [payload=null] - Data serializable untuk disimpan di SQLite
     * @param {number|null} [ttlMs=null] - Masa berlaku sesi (default null = permanen sampai dijawab)
     */
    createSession(msgId, chatId, sender, handlerOrType, payload = null, ttlMs = null) {
        if (!msgId) return

        const isFn = typeof handlerOrType === 'function'
        const sessionType = isFn ? (payload?.sessionType || 'custom') : String(handlerOrType)

        // 1. Simpan di In-Memory Cache
        this.sessions.set(msgId, {
            chatId,
            sender,
            handler: isFn ? handlerOrType : null,
            sessionType,
            payload,
            timestamp: Date.now()
        })

        // 2. Simpan di SQLite Database untuk persistensi permanen
        if (payload || !isFn) {
            dbService.saveInteractiveSession({
                id: msgId,
                chatId,
                sender,
                sessionType,
                payload: payload || {}
            })
        }

        botLogger.info('interactive', `✨ [SESSION REGISTERED] Prompt ${msgId} (Type: ${sessionType}) for ${Array.isArray(sender) ? sender.join(', ') : sender}`)

        // 3. Optional Auto-cleanup jika ttlMs ditentukan (> 0)
        if (ttlMs && ttlMs > 0) {
            setTimeout(() => {
                this.deleteSession(msgId)
            }, ttlMs)
        }
    }

    /**
     * Hapus sesi dari memory dan SQLite
     */
    deleteSession(msgId) {
        if (!msgId) return
        this.sessions.delete(msgId)
        dbService.deleteInteractiveSession(msgId)
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
     * Helper pengenal jawaban "Ya / Setuju / Spill / Teruskan"
     */
    isAffirmative(answer = '') {
        const clean = String(answer).trim().toLowerCase()
        const positives = [
            '1', 'ya', 'yes', 'spill', 'kirim', 'gas', 'lanjut', 'y', 'oke', 'ok',
            'teruskan', 'terusin', 'forward', 'share', 'buka', 'antisnitch_1', 'viewonce_1', 'true'
        ]
        return positives.includes(clean)
    }

    /**
     * Helper pengenal jawaban "Tidak / Batal / Abaikan / Simpan"
     */
    isNegative(answer = '') {
        const clean = String(answer).trim().toLowerCase()
        const negatives = [
            '0', 'ga', 'gak', 'ngga', 'nggak', 'tidak', 'no', 'batal', 'abaikan', 'skip',
            'n', 'simpan', 'save', 'antisnitch_0', 'viewonce_0', 'false', 'privasi'
        ]
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

        // 1. Cek memory session terlebih dahulu
        let session = this.sessions.get(targetMsgId)

        // 2. Fallback: Load dari SQLite jika session di memory hilang (misal setelah restart bot)
        if (!session) {
            const dbSession = dbService.getInteractiveSession(targetMsgId)
            if (dbSession) {
                session = {
                    chatId: dbSession.chatId,
                    sender: dbSession.sender,
                    sessionType: dbSession.sessionType,
                    payload: dbSession.payload,
                    handler: null
                }
            }
        }

        if (!session) return false

        // 3. Pastikan chat dan pengirim cocok
        const normalize = (j) => String(j || '').replace(/[^0-9]/g, '')
        const senderNorm = normalize(sender)
        const chatNorm = normalize(chatId)

        const matchSender = (allowed) => {
            if (Array.isArray(allowed)) return allowed.some(s => normalize(s) === senderNorm)
            return normalize(allowed) === senderNorm
        }

        const matchChat = (allowed) => {
            if (Array.isArray(allowed)) return allowed.some(c => normalize(c) === chatNorm)
            return normalize(allowed) === chatNorm
        }

        if (matchChat(session.chatId) && matchSender(session.sender)) {
            const answer = this.extractAnswer(ctx)
            botLogger.info('interactive', `🎯 [INTERACTIVE TRIGGER] User answered "${answer}" to prompt ${targetMsgId} (Type: ${session.sessionType})`)

            // Eksekusi handler
            if (typeof session.handler === 'function') {
                this.deleteSession(targetMsgId)
                await session.handler(ctx, answer)
                return true
            } else if (session.sessionType && this.typeRunners.has(session.sessionType)) {
                this.deleteSession(targetMsgId)
                const runner = this.typeRunners.get(session.sessionType)
                await runner(ctx, answer, session.payload)
                return true
            } else {
                botLogger.warn('interactive', `Session ${targetMsgId} matched but no runner found for type "${session.sessionType}"`)
            }
        }

        return false
    }
}

export const interactiveService = new InteractiveService()
