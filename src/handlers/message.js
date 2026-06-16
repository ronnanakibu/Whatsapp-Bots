// src/handlers/message.js
import fs from 'fs' // Tambahkan import fs di paling atas
import { commands } from '../core/loader.js'
import { logger, botLogger } from '../utils/logger.js'
import { aiService } from '../services/ai.js'
import { memoryService } from '../services/memory.js'
import { seamlessTracker } from '../services/seamless.js'
import { checkPermission } from '../middleware/permission.js'
import { isSpamming } from '../middleware/antispam.js'
import { checkCooldown } from '../middleware/cooldown.js'
import { validateArgs } from '../middleware/validator.js'
import { groupGuard } from '../middleware/groupGuard.js'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { normalizeNumber } from '../utils/permissions.js'
import { metricsService } from '../services/metrics.js'
import { interactiveService } from '../services/interactive.js'
import { processAiResponse, tryDirectRoute } from '../utils/aiRouter.js'
import { unwrapMessage, getCleanQuoted } from '../utils/message.js'

export async function handleIncomingMessage(sock, { messages }) {
    try {
        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith('@g.us')
        const isDM = !isGroup && from.endsWith('@s.whatsapp.net')
        const sender = isGroup ? (msg.key.participant || from) : from
        const pushName = msg.pushName || (sender ? sender.split(':')[0].split('@')[0] : 'System')

        // Unwrap nested wrappers recursively (ephemeral, viewonce, documentWithCaption)
        const messageContent = unwrapMessage(msg.message)
        if (!messageContent) return

        const type = Object.keys(messageContent)[0]
        const body =
            messageContent?.conversation
            || messageContent?.extendedTextMessage?.text
            || messageContent?.imageMessage?.caption
            || messageContent?.videoMessage?.caption
            || messageContent?.documentMessage?.caption
            || ''

        // Hook Anti-Delete
        if (type === 'protocolMessage') {
            const { checkRevokeUpsert } = await import('./revoke.js')
            await checkRevokeUpsert(sock, msg)
        }

        // Filter: abaikan pesan dari bot sendiri
        if (msg.key.fromMe) return

        // ── ANTI-SPAM MIDDLEWARE ──
        if (isSpamming(sender)) {
            botLogger.warn('handler', `Anti-spam: blocked message from ${sender}`)
            return
        }

        // Log setiap incoming message
        botLogger.message({ sender, type, body, isGroup, chatId: from })

        // ─────────────────────────────────────────────
        // CONTEXT BUILDER
        // ─────────────────────────────────────────────

        const rawBotId = sock.user?.id ?? ''
        const msgTypeObj = messageContent[type]
        const contextInfo = msgTypeObj?.contextInfo || messageContent?.extendedTextMessage?.contextInfo
        const quotedMsgId = contextInfo?.stanzaId ?? null
        const isReplyToBot = seamlessTracker.isReplyToBot(quotedMsgId)

        const mentionedJids = contextInfo?.mentionedJid ?? []

        // Collect all possible bot JID numbers (phone number, LID number, etc.)
        const botNumbers = new Set([
            normalizeNumber(rawBotId),
            normalizeNumber(sock.user?.lid ?? ''),
            normalizeNumber(process.env.BOT_NUMBER ?? '')
        ].filter(Boolean))

        const isMentionedInGroup = isGroup && mentionedJids.some(jid => {
            const norm = jid ? normalizeNumber(jid) : ''
            return norm && botNumbers.has(norm)
        })

        const prefix = process.env.BOT_PREFIX || '!'
        const isCommand = body.startsWith(prefix)
        const isDMTrigger = isDM && !isCommand && body.trim().length > 0

        // ── 😴 GLOBAL SLEEP / DEAFEN MODE INTERCEPTOR ──
        if (fs.existsSync('./storage/sleep.flag')) {
            const { isOwner } = await import('../utils/permissions.js')
            const masterOwner = isOwner(sender)

            // Ekstrak nama command secara mentah untuk keperluan validasi bangun
            const cmdName = isCommand ? body.slice(prefix.length).trim().split(/ +/)[0].toLowerCase() : ''
            const wakeupCommands = ['wake', 'bangun', 'pagi', 'resume']

            // JIKA bot tidur, matikan total seluruh respon KECUALI jika pemicunya adalah owner yang mau bangunin bot
            if (!masterOwner || !isCommand || !wakeupCommands.includes(cmdName)) {
                return // Drop event senyap tanpa log tambahan, emulasi status deafen
            }
        }

        const bodyWithoutMention = body
            .replace(/@\d+/g, '')
            .replace(/\s+/g, ' ')
            .trim()

        // ─────────────────────────────────────────────
        // HELPERS
        // ─────────────────────────────────────────────

        const reply = async (text, options = {}) => {
            const sent = await sock.sendMessage(from, { text, ...options }, { quoted: getCleanQuoted(msg) })
            return sent
        }

        const react = async (emoji) => {
            await sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
        }

        const downloadMedia = async (targetMsg = msg) => {
            try {
                botLogger.debug('handler', 'Downloading media...')
                return await downloadMediaMessage(targetMsg, 'buffer', {})
            } catch (err) {
                botLogger.err('handler', err, 'downloadMedia')
                return null
            }
        }

        const ctx = {
            sock,
            msg,
            messageContent,
            from,
            chatId: from,
            sender,
            pushName,
            isGroup,
            isDM,
            body,
            bodyWithoutMention,
            type,
            quotedMsgId,
            isReplyToBot,
            isMentioned: isMentionedInGroup,
            isDMTrigger,
            reply,
            react,
            downloadMedia,
            mentionedJids,
            replyMedia: async (content, mediaType, options = {}) => {
                return sock.sendMessage(from, { [mediaType]: content, ...options }, { quoted: getCleanQuoted(msg) })
            }
        }

        // ── AI MODERATOR CHECK ──
        if (isGroup && !isCommand && body.trim().length > 0) {
            const { moderatorService } = await import('../services/moderator.js')
            if (await moderatorService.isModerationEnabled(from)) {
                const bypass = await moderatorService.isAdminOrOwner(sock, from, sender)
                if (!bypass) {
                    const check = await moderatorService.checkMessage(body)
                    if (check.isToxic && check.confidence >= 0.75) {
                        await moderatorService.handleViolation(sock, from, sender, check.reason, msg, reply, react)
                        return
                    }
                }
            }
        }

        // ─────────────────────────────────────────────
        // ROUTE 1: COMMAND (prefix)
        // ─────────────────────────────────────────────

        if (isCommand) {
            const rawArgs = body.slice(prefix.length).trim().split(/ +/)
            const commandName = rawArgs.shift().toLowerCase()

            ctx.args = rawArgs
            ctx.commandName = commandName

            const command = commands.get(commandName)

            if (!command) {
                botLogger.warn('handler', `Unknown command: "${commandName}" from ${sender}`)
                return
            }

            if (command.enabled === false) {
                await react('🚫')
                await reply(`🚫 Command *!${commandName}* sedang dinonaktifkan oleh owner secara realtime.`)
                botLogger.warn('handler', `Attempted to use disabled command "${commandName}" from ${sender}`)
                return
            }

            // ── VALIDATOR MIDDLEWARE ──
            const valResult = validateArgs(rawArgs)
            if (!valResult.valid) {
                await react('⚠️')
                await reply(`⚠️ *Gagal Validasi:* ${valResult.reason}`)
                botLogger.warn('handler', `Validation failed for cmd "${commandName}" from ${sender}: ${valResult.reason}`)
                return
            }

            // ── PERMISSION CHECK ──
            const permResult = await checkPermission(ctx, command)
            if (!permResult.allowed) {
                await react('🚫')
                await reply(permResult.reason ?? '🚫 Akses ditolak.')
                botLogger.warn('handler', `Permission denied: ${commandName} for ${sender}`)
                return
            }

            // ── GROUP GUARD MIDDLEWARE ──
            if (command.requireBotAdmin) {
                const guardResult = await groupGuard(ctx, {
                    requireBotAdmin: true,
                    requireSenderAdmin: false // Already checked by permission middleware
                })
                if (!guardResult.ok) return
            }

            // ── COOLDOWN CHECK ──
            const cooldownSecs = command.cooldown ?? 3
            const cooldownRemaining = checkCooldown(sender, command.name, cooldownSecs)
            if (cooldownRemaining !== null) {
                await react('⏳')
                await reply(`⏳ *Cooldown!* Mohon tunggu *${cooldownRemaining}* detik sebelum menggunakan command *${commandName}* kembali.`)
                botLogger.warn('handler', `Cooldown active for cmd "${commandName}" from ${sender}`)
                return
            }

            // ── EXECUTE ──
            botLogger.command(commandName, sender, rawArgs)
            const startMs = Date.now()

            try {
                metricsService.incrementCommands(commandName)

                try {
                    const db = memoryService.db
                    if (db) {
                        db.prepare(`
                            INSERT INTO users (jid, name, commands_count, last_seen)
                            VALUES (?, ?, 1, ?)
                            ON CONFLICT(jid) DO UPDATE SET 
                                name = excluded.name,
                                commands_count = commands_count + 1,
                                last_seen = excluded.last_seen
                        `).run(sender, pushName, Date.now())
                    }
                } catch (dbErr) {
                    logger.error('[Memory/Users] Failed to track user stats:', dbErr.message)
                }

                await command.execute(ctx)
                botLogger.commandDone(commandName, Date.now() - startMs)
            } catch (err) {
                botLogger.err('handler', err, `cmd:${commandName}`)
                await react('❌')
                await reply(`❌ Error di command *${commandName}*:\n${err.message}`)
            }

            return
        }

        // ─────────────────────────────────────────────
        // ROUTE 2: ROUTE TO CENTRAL AI FLOW
        // ─────────────────────────────────────────────

        if (isReplyToBot && (body.trim() || type === 'imageMessage')) {
            if (!memoryService.isAiEnabled(from)) return

            botLogger.aiTrigger('seamless', body)
            const { executeAiFlow } = await import('../utils/aiRouter.js')
            await executeAiFlow(ctx, body)
            return
        }

        // ─────────────────────────────────────────────
        // ROUTE 3: MENTION DI GRUP
        // ─────────────────────────────────────────────

        if (isMentionedInGroup && (bodyWithoutMention || type === 'imageMessage')) {
            if (!memoryService.isAiEnabled(from)) return

            botLogger.aiTrigger('mention', bodyWithoutMention)
            const { executeAiFlow } = await import('../utils/aiRouter.js')
            await executeAiFlow(ctx, bodyWithoutMention)
            return
        }

        // ─────────────────────────────────────────────
        // ROUTE 5: INTERACTIVE SESSIONS
        // ─────────────────────────────────────────────

        if (quotedMsgId && !isCommand) {
            const isInteractive = await interactiveService.handleReply(ctx)
            if (isInteractive) return
        }

        // ─────────────────────────────────────────────
        // ROUTE 4: DM TRIGGER
        // ─────────────────────────────────────────────

        if (isDMTrigger) {
            if (!memoryService.isAiEnabled(from)) return

            botLogger.aiTrigger('dm', body)
            const { executeAiFlow } = await import('../utils/aiRouter.js')
            await executeAiFlow(ctx, body)
            return
        }

    } catch (err) {
        botLogger.err('handler', err, 'fatal')
        logger.error(err)
    }
}