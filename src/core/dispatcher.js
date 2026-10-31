// src/core/dispatcher.js
// Unified Command Dispatcher with 6-layer security pipeline, parameter bridging, and output interception.

import { validateArgs } from '../middleware/validator.js'
import { checkPermission, isOwner } from '../middleware/permission.js'
import { groupGuard } from '../middleware/groupGuard.js'
import { checkCooldown } from '../middleware/cooldown.js'
import { metricsService } from '../services/metrics.js'
import { memoryService } from '../services/memory.js'
import { botLogger, logger } from '../utils/logger.js'

/**
 * Resolves a command module by name or alias.
 * Checks registry.js first, then falls back to loader.js commands Map.
 */
export async function resolveCommand(commandName) {
    if (!commandName || typeof commandName !== 'string') return null
    const cleanName = commandName.trim().toLowerCase()

    // 1. Try registry.js
    try {
        const registry = await import('./registry.js')
        if (typeof registry.getCommand === 'function') {
            const cmd = registry.getCommand(cleanName)
            if (cmd) return cmd
        }
    } catch (_) {}

    // 2. Fallback to loader.js commands map
    try {
        const loader = await import('./loader.js')
        if (loader.commands && typeof loader.commands.get === 'function') {
            const cmd = loader.commands.get(cleanName)
            if (cmd) return cmd
        }
    } catch (_) {}

    return null
}

/**
 * Normalizes input arguments or parameter objects into both ctx.args (string[]) and ctx.params (object).
 */
export function normalizeArgsAndParams(argsOrParams, command = null) {
    let args = []
    let params = {}

    if (Array.isArray(argsOrParams)) {
        args = argsOrParams.map(a => String(a ?? ''))
        params = {}
        const paramProps = command?.parameters?.properties || command?.params?.properties
        if (paramProps && typeof paramProps === 'object') {
            const keys = Object.keys(paramProps)
            keys.forEach((k, idx) => {
                if (idx < args.length) {
                    params[k] = args[idx]
                }
            })
        }
    } else if (argsOrParams && typeof argsOrParams === 'object') {
        params = { ...argsOrParams }
        const paramProps = command?.parameters?.properties || command?.params?.properties
        if (paramProps && typeof paramProps === 'object') {
            const keys = Object.keys(paramProps)
            for (const key of keys) {
                if (params[key] !== undefined && params[key] !== null) {
                    args.push(String(params[key]))
                }
            }
        }
        if (args.length === 0) {
            args = Object.values(params)
                .filter(v => v !== undefined && v !== null)
                .map(v => String(v))
        }
    } else if (typeof argsOrParams === 'string') {
        const trimmed = argsOrParams.trim()
        args = trimmed ? trimmed.split(/\s+/) : []
        params = { query: trimmed }
    } else {
        args = []
        params = {}
    }

    return { args, params }
}

/**
 * Creates the Context Bridge and Output Interceptor.
 * Wraps reply, replyMedia, react, and sock.sendMessage.
 */
export function createContextBridge(ctx, options = {}) {
    const isAi = options.source === 'ai'
    const shouldSendToChat = options.sendToChat !== undefined 
        ? Boolean(options.sendToChat) 
        : (!isAi || options.tee === true)

    const capturedOutputs = []
    const capturedMedia = []
    const capturedReactions = []

    const originalReply = typeof ctx.reply === 'function' ? ctx.reply.bind(ctx) : null
    const wrappedReply = async (text, replyOpts = {}) => {
        if (text !== undefined && text !== null) {
            capturedOutputs.push(String(text))
        }
        if (shouldSendToChat && originalReply) {
            return await originalReply(text, replyOpts)
        }
        return {
            key: {
                remoteJid: ctx.from || ctx.chatId,
                fromMe: true,
                id: `intercepted-${Date.now()}`
            },
            message: { conversation: String(text ?? '') }
        }
    }

    const originalReplyMedia = typeof ctx.replyMedia === 'function' ? ctx.replyMedia.bind(ctx) : null
    const wrappedReplyMedia = async (content, mediaType, mediaOpts = {}) => {
        const caption = mediaOpts?.caption || ''
        capturedMedia.push({ type: mediaType, caption })
        capturedOutputs.push(`[Media sent: ${mediaType}${caption ? ` - ${caption}` : ''}]`)

        const allowSendMedia = options.sendMedia !== false && (shouldSendToChat || isAi)
        if (allowSendMedia && originalReplyMedia) {
            return await originalReplyMedia(content, mediaType, mediaOpts)
        }
        return {
            key: {
                remoteJid: ctx.from || ctx.chatId,
                fromMe: true,
                id: `intercepted-media-${Date.now()}`
            },
            mediaType
        }
    }

    const originalReact = typeof ctx.react === 'function' ? ctx.react.bind(ctx) : null
    const wrappedReact = async (emoji) => {
        if (emoji) capturedReactions.push(emoji)
        if (shouldSendToChat && originalReact) {
            return await originalReact(emoji)
        }
    }

    // Proxy Baileys sock.sendMessage so commands calling sock directly are intercepted
    let activeSock = ctx.sock
    if (ctx.sock && typeof ctx.sock.sendMessage === 'function') {
        const originalSendMessage = ctx.sock.sendMessage.bind(ctx.sock)
        activeSock = Object.create(ctx.sock)
        activeSock.sendMessage = async (jid, content, sendOpts) => {
            if (content?.text) {
                capturedOutputs.push(String(content.text))
                if (!shouldSendToChat) {
                    return {
                        key: { remoteJid: jid, fromMe: true, id: `intercepted-sock-${Date.now()}` },
                        message: { conversation: content.text }
                    }
                }
            }
            if (content?.react) {
                if (content.react.text) capturedReactions.push(content.react.text)
                if (!shouldSendToChat) return
            }
            const mediaKey = Object.keys(content || {}).find(k =>
                ['image', 'video', 'audio', 'sticker', 'document'].includes(k)
            )
            if (mediaKey) {
                capturedMedia.push({ type: mediaKey, caption: content.caption || '' })
                capturedOutputs.push(`[Media sent: ${mediaKey}${content.caption ? ` - ${content.caption}` : ''}]`)
                if (options.sendMedia === false && !shouldSendToChat) {
                    return {
                        key: { remoteJid: jid, fromMe: true, id: `intercepted-media-${Date.now()}` },
                        mediaKey
                    }
                }
            }
            return await originalSendMessage(jid, content, sendOpts)
        }
    }

    const activeCtx = {
        ...ctx,
        sock: activeSock,
        reply: wrappedReply,
        replyMedia: wrappedReplyMedia,
        react: wrappedReact
    }

    return {
        activeCtx,
        getCapturedOutput: () => capturedOutputs.join('\n').trim(),
        getCapturedMedia: () => [...capturedMedia],
        getCapturedReactions: () => [...capturedReactions]
    }
}

/**
 * Dispatches a command through the complete 6-layer security and tracking pipeline.
 *
 * @param {string} commandName - Primary command name or alias.
 * @param {string[]|object|string} argsOrParams - Command arguments or parameter object.
 * @param {object} ctx - Incoming message context.
 * @param {object} [options] - Execution options:
 *        - source: 'manual' | 'ai' (default: 'manual')
 *        - captureOutput: boolean (default: source === 'ai')
 *        - sendToChat: boolean (default: source === 'manual' || tee === true)
 *        - tee: boolean (default: false)
 *        - sendMedia: boolean (default: true)
 * @returns {Promise<{
 *    success: boolean,
 *    reason?: 'NOT_FOUND'|'DISABLED'|'DENIED'|'BOT_NOT_ADMIN'|'COOLDOWN'|'ERROR',
 *    message?: string,
 *    output?: string,
 *    error?: Error|null
 * }>}
 */
export async function dispatchCommand(commandName, argsOrParams, ctx, options = {}) {
    const source = options.source || 'manual'
    const isManual = source === 'manual'
    const cleanCmdName = String(commandName || '').trim().toLowerCase()
    const sender = ctx.sender || ctx.from || ''
    const pushName = ctx.pushName || (sender ? sender.split(':')[0].split('@')[0] : 'User')

    // 0. Resolve Command
    const command = await resolveCommand(cleanCmdName)
    if (!command) {
        botLogger.warn('dispatcher', `Unknown command: "${cleanCmdName}" from ${sender}`)
        return {
            success: false,
            reason: 'NOT_FOUND',
            message: `Unknown command: "${cleanCmdName}" tidak ditemukan.`,
            output: '',
            error: null
        }
    }

    // Normalize parameters & arguments
    const { args, params } = normalizeArgsAndParams(argsOrParams, command)

    // Construct Context Bridge & Interceptor
    const { activeCtx, getCapturedOutput } = createContextBridge(ctx, options)
    activeCtx.args = args
    activeCtx.params = params
    activeCtx.commandName = cleanCmdName

    // ── LAYER 1: ENABLED STATUS CHECK ──
    if (command.enabled === false) {
        botLogger.warn('dispatcher', `Attempted to use disabled command "${cleanCmdName}" from ${sender}`)
        if (isManual) {
            await activeCtx.react('🚫')
            await activeCtx.reply(`🚫 Command *!${cleanCmdName}* sedang dinonaktifkan oleh owner secara realtime.`)
        }
        return {
            success: false,
            reason: 'DISABLED',
            message: `Command "${cleanCmdName}" sedang dinonaktifkan oleh owner.`,
            output: getCapturedOutput(),
            error: null
        }
    }

    // ── LAYER 2: VALIDATOR MIDDLEWARE ──
    const valResult = validateArgs(args)
    if (!valResult.valid) {
        botLogger.warn('dispatcher', `Validation failed for cmd "${cleanCmdName}" from ${sender}: ${valResult.reason}`)
        if (isManual) {
            await activeCtx.react('⚠️')
            await activeCtx.reply(`⚠️ *Gagal Validasi:* ${valResult.reason}`)
        }
        return {
            success: false,
            reason: 'VALIDATION_FAILED',
            message: valResult.reason,
            output: getCapturedOutput(),
            error: null
        }
    }

    // ── LAYER 3: PERMISSION MIDDLEWARE ──
    const permResult = await checkPermission(activeCtx, command)
    if (!permResult.allowed) {
        botLogger.warn('dispatcher', `Permission denied: ${cleanCmdName} for ${sender}`)
        if (isManual) {
            await activeCtx.react('🚫')
            await activeCtx.reply(permResult.reason ?? '🚫 Akses ditolak.')
        }
        return {
            success: false,
            reason: 'DENIED',
            message: permResult.reason || 'Akses ditolak.',
            output: getCapturedOutput(),
            error: null
        }
    }

    // ── LAYER 4: GROUP GUARD MIDDLEWARE ──
    if (command.requireBotAdmin) {
        const guardResult = await groupGuard(activeCtx, {
            requireBotAdmin: true,
            requireSenderAdmin: false
        })
        if (!guardResult.ok) {
            return {
                success: false,
                reason: 'BOT_NOT_ADMIN',
                message: 'Bot bukan admin grup atau command hanya dapat digunakan di dalam grup.',
                output: getCapturedOutput(),
                error: null
            }
        }
    }

    // ── LAYER 5: COOLDOWN TRACKING ──
    const cooldownSecs = command.cooldown ?? 3
    const senderIsOwner = isOwner(sender)
    const cooldownRemaining = senderIsOwner ? null : checkCooldown(sender, command.name || cleanCmdName, cooldownSecs)

    if (cooldownRemaining !== null) {
        botLogger.warn('dispatcher', `Cooldown active for cmd "${cleanCmdName}" from ${sender}`)
        if (isManual) {
            await activeCtx.react('⏳')
            await activeCtx.reply(`⏳ *Cooldown!* Mohon tunggu *${cooldownRemaining}* detik sebelum menggunakan command *${cleanCmdName}* kembali.`)
        }
        return {
            success: false,
            reason: 'COOLDOWN',
            message: `Cooldown active: Mohon tunggu ${cooldownRemaining} detik sebelum menggunakan command ${cleanCmdName} kembali.`,
            output: getCapturedOutput(),
            error: null
        }
    }

    // ── LAYER 6: METRICS & DATABASE TRACKING ──
    botLogger.command(command.name || cleanCmdName, sender, args)
    const startMs = Date.now()

    try {
        metricsService.incrementCommands(command.name || cleanCmdName)

        try {
            const db = memoryService.db
            if (db && sender) {
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
            logger.error('[Dispatcher/Users] Failed to track user stats:', dbErr.message)
        }

        // Isolate context topic if supported
        try {
            if (typeof memoryService?.setActiveTopic === 'function') {
                const topicChatId = activeCtx.chatId || activeCtx.from
                if (topicChatId) {
                    memoryService.setActiveTopic(topicChatId, command.name || cleanCmdName)
                }
            }
        } catch (_) {}

        // ── COMMAND EXECUTION ──
        const execResult = await command.execute(activeCtx)
        botLogger.commandDone(command.name || cleanCmdName, Date.now() - startMs)

        let finalOutput = getCapturedOutput()
        if (!finalOutput && typeof execResult === 'string') {
            finalOutput = execResult
        } else if (!finalOutput && execResult && typeof execResult === 'object') {
            finalOutput = JSON.stringify(execResult)
        }

        return {
            success: true,
            output: finalOutput,
            error: null
        }

    } catch (err) {
        botLogger.err('dispatcher', err, `cmd:${cleanCmdName}`)
        if (isManual) {
            await activeCtx.react('❌')
            await activeCtx.reply(`❌ Error di command *${cleanCmdName}*:\n${err.message}`)
        }
        return {
            success: false,
            reason: 'ERROR',
            message: err.message,
            output: getCapturedOutput(),
            error: err
        }
    }
}

export default {
    dispatchCommand,
    createContextBridge,
    normalizeArgsAndParams,
    resolveCommand
}
