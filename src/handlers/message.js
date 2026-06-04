// src/handlers/message.js
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

export async function handleIncomingMessage(sock, { messages }) {
    try {
        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith('@g.us')
        const isDM = !isGroup && from.endsWith('@s.whatsapp.net')
        const sender = isGroup ? (msg.key.participant || from) : from
        const pushName = msg.pushName || (sender ? sender.split(':')[0].split('@')[0] : 'System')

        // Unwrap ephemeral / viewonce / documentWithCaption
        let messageContent = msg.message
        const wrapperTypes = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']
        const baseType = Object.keys(messageContent)[0]
        if (wrapperTypes.includes(baseType)) {
            messageContent = messageContent[baseType].message
        }
        if (!messageContent) return

        const type = Object.keys(messageContent)[0]
        const body =
            messageContent?.conversation
            || messageContent?.extendedTextMessage?.text
            || messageContent?.imageMessage?.caption
            || messageContent?.videoMessage?.caption
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
        const quotedMsgId = messageContent?.extendedTextMessage?.contextInfo?.stanzaId ?? null
        const isReplyToBot = seamlessTracker.isReplyToBot(quotedMsgId)

        const mentionedJids = messageContent?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
        
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

        const bodyWithoutMention = body
            .replace(/@\d+/g, '')
            .replace(/\s+/g, ' ')
            .trim()

        // ─────────────────────────────────────────────
        // HELPERS
        // ─────────────────────────────────────────────

        const reply = async (text, options = {}) => {
            const sent = await sock.sendMessage(from, { text, ...options }, { quoted: msg })
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
            replyMedia: async (content, mediaType, options = {}) => {
                return sock.sendMessage(from, { [mediaType]: content, ...options }, { quoted: msg })
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
        // ROUTE 2: SEAMLESS AI
        // ─────────────────────────────────────────────

        if (isReplyToBot && body.trim()) {
            if (!memoryService.isAiEnabled(from)) return

            botLogger.aiTrigger('seamless', body)
            await react('🤔')
            const startMs = Date.now()

            try {
                const result = await aiService.chat(from, body)
                botLogger.ai(result.provider, result.model, from, Date.now() - startMs)
                const sent = await reply(result.text)
                if (sent?.key?.id) seamlessTracker.track(sent.key.id)
                await react('✅')
            } catch (err) {
                await react('❌')
                botLogger.err('seamless', err)
            }
            return
        }

        // ─────────────────────────────────────────────
        // ROUTE 3: MENTION DI GRUP
        // ─────────────────────────────────────────────

        if (isMentionedInGroup && bodyWithoutMention) {
            if (!memoryService.isAiEnabled(from)) return

            botLogger.aiTrigger('mention', bodyWithoutMention)
            await react('🤔')
            const startMs = Date.now()

            try {
                const result = await aiService.chat(from, bodyWithoutMention)
                botLogger.ai(result.provider, result.model, from, Date.now() - startMs)
                const sent = await reply(result.text)
                if (sent?.key?.id) seamlessTracker.track(sent.key.id)
                await react('✅')
            } catch (err) {
                await react('❌')
                botLogger.err('mention', err)
            }
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
            await react('🤔')
            const startMs = Date.now()

            try {
                const result = await aiService.chat(from, body)
                botLogger.ai(result.provider, result.model, from, Date.now() - startMs)
                const sent = await reply(result.text)
                if (sent?.key?.id) seamlessTracker.track(sent.key.id)
                await react('✅')
            } catch (err) {
                await react('❌')
                botLogger.err('dm', err)
            }
            return
        }

    } catch (err) {
        botLogger.err('handler', err, 'fatal')
        logger.error(err)
    }
}