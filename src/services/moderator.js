// src/services/moderator.js
import Groq from 'groq-sdk'
import { memoryService } from './memory.js'
import { isGroupAdmin, isOwner } from '../middleware/permission.js'
import { logger } from '../utils/logger.js'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

class ModeratorService {
    /**
     * Cek apakah moderation aktif untuk chatId tertentu.
     */
    async isModerationEnabled(chatId) {
        try {
            const db = memoryService.db
            const row = db.prepare('SELECT enabled FROM moderation_config WHERE chat_id = ?').get(chatId)
            return row ? Boolean(row.enabled) : false
        } catch (err) {
            logger.error('[Moderator] Failed to check status:', err.message)
            return false
        }
    }

    /**
     * Mengatur status AI Moderator (aktif/nonaktif).
     */
    async setModerationEnabled(chatId, enabled) {
        try {
            const db = memoryService.db
            db.prepare(`
                INSERT INTO moderation_config (chat_id, enabled)
                VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET enabled = excluded.enabled, updated_at = unixepoch()
            `).run(chatId, enabled ? 1 : 0)
        } catch (err) {
            logger.error('[Moderator] Failed to set status:', err.message)
        }
    }

    /**
     * Mengatur batas maksimum peringatan.
     */
    async setMaxWarnings(chatId, maxWarnings) {
        try {
            const db = memoryService.db
            db.prepare(`
                INSERT INTO moderation_config (chat_id, max_warnings)
                VALUES (?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET max_warnings = excluded.max_warnings, updated_at = unixepoch()
            `).run(chatId, maxWarnings)
        } catch (err) {
            logger.error('[Moderator] Failed to set max warnings:', err.message)
        }
    }

    /**
     * Mendapatkan config moderasi untuk chatId.
     */
    async getModerationConfig(chatId) {
        try {
            const db = memoryService.db
            const row = db.prepare('SELECT enabled, max_warnings FROM moderation_config WHERE chat_id = ?').get(chatId)
            return {
                enabled: row ? Boolean(row.enabled) : false,
                max_warnings: row ? row.max_warnings : 3
            }
        } catch (err) {
            logger.error('[Moderator] Failed to get config:', err.message)
            return { enabled: false, max_warnings: 3 }
        }
    }

    /**
     * Mendapatkan daftar warning per grup.
     */
    async getGroupWarnings(chatId) {
        try {
            const db = memoryService.db
            return db.prepare('SELECT user_id, warning_count FROM moderation_warnings WHERE chat_id = ? AND warning_count > 0').all(chatId)
        } catch (err) {
            logger.error('[Moderator] Failed to get group warnings:', err.message)
            return []
        }
    }

    /**
     * Mendapatkan jumlah warning pengguna.
     */
    async getWarningCount(chatId, userId) {
        try {
            const db = memoryService.db
            const row = db.prepare('SELECT warning_count FROM moderation_warnings WHERE chat_id = ? AND user_id = ?').get(chatId, userId)
            return row ? row.warning_count : 0
        } catch (err) {
            logger.error('[Moderator] Failed to get warning count:', err.message)
            return 0
        }
    }

    /**
     * Menambahkan/menaikkan warning pengguna. Returns warning count baru.
     */
    async addWarning(chatId, userId) {
        try {
            const db = memoryService.db
            db.prepare(`
                INSERT INTO moderation_warnings (chat_id, user_id, warning_count)
                VALUES (?, ?, 1)
                ON CONFLICT(chat_id, user_id) DO UPDATE SET warning_count = warning_count + 1, updated_at = unixepoch()
            `).run(chatId, userId)

            return await this.getWarningCount(chatId, userId)
        } catch (err) {
            logger.error('[Moderator] Failed to add warning:', err.message)
            return 0
        }
    }

    /**
     * Reset warning pengguna ke 0.
     */
    async resetWarnings(chatId, userId) {
        try {
            const db = memoryService.db
            db.prepare('DELETE FROM moderation_warnings WHERE chat_id = ? AND user_id = ?').run(chatId, userId)
        } catch (err) {
            logger.error('[Moderator] Failed to reset warnings:', err.message)
        }
    }

    /**
     * Cek apakah sender adalah admin atau owner bot agar di-bypass.
     */
    async isAdminOrOwner(sock, chatId, jid) {
        if (isOwner(jid)) return true
        return await isGroupAdmin(sock, chatId, jid)
    }

    /**
     * Memeriksa toxic menggunakan Groq.
     */
    async checkMessage(body) {
        const systemPrompt = `Kamu adalah AI Group Moderator. Tugasmu adalah menganalisis pesan obrolan grup dan mendeteksi apakah pesan tersebut melanggar aturan kesopanan.
Deteksi hal-hal berikut:
1. Ujaran kebencian (SARA, rasisme berat, pelecehan seksual/verbal parah).
2. Makian kasar/kotor berlebihan yang ditujukan untuk menyerang orang lain (bukan candaan akrab santai).
3. Percobaan penipuan / spam promosi mencurigakan (scam, link judi, link phishing, promosi spam massal).

Jawab dengan format JSON murni:
{
  "isToxic": true/false,
  "reason": "Penjelasan singkat dalam bahasa Indonesia mengapa melanggar, atau kosong jika aman",
  "confidence": 0.0 s/d 1.0
}`

        try {
            const res = await groq.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Pesan: "${body}"` }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
            })

            const parsed = JSON.parse(res.choices[0]?.message?.content?.trim() || '{}')
            return {
                isToxic: Boolean(parsed.isToxic),
                reason: parsed.reason || '',
                confidence: parsed.confidence || 0.0
            }
        } catch (err) {
            logger.error('[Moderator] Groq evaluation error:', err.message)
            return { isToxic: false, reason: '', confidence: 0.0 }
        }
    }

    /**
     * Menangani pelanggaran jika pesan terbukti toxic.
     */
    async handleViolation(sock, chatId, userJid, reason, originalMsg, reply, react) {
        try {
            // Hapus pesan pelanggaran untuk menjaga kebersihan grup
            try {
                await sock.sendMessage(chatId, {
                    delete: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: originalMsg.key.id,
                        participant: originalMsg.key.participant || originalMsg.key.remoteJid
                    }
                })
            } catch (_) {
                // Ignore jika gagal hapus karena bot bukan admin
            }

            const config = await this.getModerationConfig(chatId)
            const warnings = await this.addWarning(chatId, userJid)
            const max = config.max_warnings

            await react('⚠️')

            if (warnings >= max) {
                // Reset warnings dulu
                await this.resetWarnings(chatId, userJid)

                // Cek bot admin
                const { isBotAdmin } = await import('./permission.js')
                const botAdmin = await isBotAdmin(sock, chatId)

                if (!botAdmin) {
                    return reply(
                        `⚠️ *Peringatan AI Moderator* untuk *@${userJid.split('@')[0]}* (${warnings}/${max}):\n` +
                        `Alasan: ${reason}\n\n` +
                        `⚠️ _Pengguna ini seharusnya dikeluarkan, tetapi bot bukan admin grup._`,
                        { mentions: [userJid] }
                    )
                }

                // Kick
                await reply(
                    `❌ *AI Moderator Tindakan Tegas* ❌\n\n` +
                    `Anggota *@${userJid.split('@')[0]}* telah melanggar aturan sebanyak *${max}x* dan dikeluarkan dari grup.\n` +
                    `Pelanggaran terakhir: ${reason}`,
                    { mentions: [userJid] }
                )
                await sock.groupParticipantsUpdate(chatId, [userJid], 'remove')
            } else {
                return reply(
                    `⚠️ *Peringatan AI Moderator* untuk *@${userJid.split('@')[0]}* (${warnings}/${max}):\n` +
                    `Alasan: ${reason}\n\n` +
                    `_Harap jaga kesopanan dalam grup._`,
                    { mentions: [userJid] }
                )
            }
        } catch (err) {
            logger.error('[Moderator] Failed to handle violation:', err.message)
        }
    }
}

export const moderatorService = new ModeratorService()
