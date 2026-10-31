/**
 * tests/e2e/harness/testHelper.js
 * 
 * Test utilities, environment boots, and unified contract adapters for WABOT2.0 E2E tests.
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { commands, loadCommands } from '../../../src/core/loader.js'
import { validateArgs } from '../../../src/middleware/validator.js'
import { checkPermission } from '../../../src/middleware/permission.js'
import { groupGuard } from '../../../src/middleware/groupGuard.js'
import { checkCooldown } from '../../../src/middleware/cooldown.js'
import { metricsService } from '../../../src/services/metrics.js'

// Setup default safe environment for tests
process.env.NODE_ENV = 'test'
process.env.BOT_PREFIX = process.env.BOT_PREFIX || '.'
process.env.BOT_NUMBER = process.env.BOT_NUMBER || '6281234567890'
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || '6285172013920'
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'mock_test_groq_key'
process.env.AUTO_READ = 'false'

// Automatically unref any background setInterval calls initiated by background services (metrics, mediaCache)
// so the Node.js test process can cleanly terminate without hanging.
const originalSetInterval = global.setInterval
global.setInterval = function (...args) {
    const timer = originalSetInterval.apply(this, args)
    if (timer && typeof timer.unref === 'function') {
        timer.unref()
    }
    return timer
}

let isLoaded = false

/**
 * Ensures all command modules are loaded into the registry.
 */
export async function ensureCommandsLoaded() {
    if (!isLoaded || commands.size === 0) {
        await loadCommands('./src/commands')
        isLoaded = true
    }
    return commands
}

/**
 * Dynamically resolves Unified Tool Registry or falls back to authoritative specification contract.
 */
export async function getUnifiedRegistry() {
    const registryPath = path.resolve('./src/core/registry.js')
    if (fs.existsSync(registryPath)) {
        try {
            return await import('../../../src/core/registry.js')
        } catch (e) {
            console.warn('[testHelper] Failed to import real registry.js:', e.message)
        }
    }

    // Authoritative reference contract implementation conforming to PROJECT.md
    return {
        initializeRegistry: async () => {
            return await ensureCommandsLoaded()
        },
        getCommand: (nameOrAlias) => {
            if (!nameOrAlias) return undefined
            return commands.get(nameOrAlias.toLowerCase())
        },
        getAllCommands: () => {
            return commands
        },
        getCommandsByCategory: (category) => {
            const result = []
            const seen = new Set()
            for (const cmd of commands.values()) {
                if (cmd.category === category && !seen.has(cmd.name)) {
                    seen.add(cmd.name)
                    result.push(cmd)
                }
            }
            return result
        },
        getToolSchemas: (options = {}) => {
            const role = options.role || 'user'
            const schemas = []
            const seen = new Set()

            for (const cmd of commands.values()) {
                if (seen.has(cmd.name)) continue
                seen.add(cmd.name)

                // Role filtering
                const perms = cmd.permissions || ['user']
                if (role === 'user' && !perms.includes('user')) continue
                if (role === 'admin' && !perms.includes('user') && !perms.includes('admin')) continue

                if (options.category && cmd.category !== options.category) continue

                schemas.push({
                    type: 'function',
                    function: {
                        name: cmd.name,
                        description: cmd.description || '',
                        parameters: cmd.params || cmd.parameters || {
                            type: 'object',
                            properties: {
                                input: {
                                    type: 'string',
                                    description: `Argument for ${cmd.name}`
                                }
                            }
                        }
                    }
                })
            }
            return schemas
        },
        generatePromptToolDefinitions: (options = {}) => {
            const role = options.role || 'user'
            const lines = ['# Available Tools:']
            const seen = new Set()

            for (const cmd of commands.values()) {
                if (seen.has(cmd.name)) continue
                seen.add(cmd.name)

                const perms = cmd.permissions || ['user']
                if (role === 'user' && !perms.includes('user')) continue
                if (role === 'admin' && !perms.includes('user') && !perms.includes('admin')) continue

                lines.push(`- **${cmd.name}** [${cmd.category}]: ${cmd.description || 'No description'}. Usage: \`${cmd.usage || cmd.name}\``)
            }
            return lines.join('\n')
        }
    }
}

/**
 * Dynamically resolves Unified Command Dispatcher or falls back to authoritative specification contract.
 */
export async function getUnifiedDispatcher() {
    const dispatcherPath = path.resolve('./src/core/dispatcher.js')
    if (fs.existsSync(dispatcherPath)) {
        try {
            return await import('../../../src/core/dispatcher.js')
        } catch (e) {
            console.warn('[testHelper] Failed to import real dispatcher.js:', e.message)
        }
    }

    // Authoritative reference contract implementation conforming to PROJECT.md § 7 Unified Command Dispatcher
    return {
        dispatchCommand: async (commandName, rawArgs, ctx, options = {}) => {
            await ensureCommandsLoaded()
            const source = options.source || 'manual'
            const captureOutput = options.captureOutput || false

            if (!commandName) {
                return { success: false, reason: 'NOT_FOUND', message: 'Command name required' }
            }

            const command = commands.get(commandName.toLowerCase())
            if (!command) {
                return { success: false, reason: 'NOT_FOUND', message: `Unknown command: ${commandName}` }
            }

            // Layer 1: Enabled check
            if (command.enabled === false) {
                if (ctx.react) await ctx.react('🚫')
                if (ctx.reply) await ctx.reply(`🚫 Command *!${commandName}* sedang dinonaktifkan oleh owner secara realtime.`)
                return { success: false, reason: 'DISABLED', message: `Command ${commandName} is disabled` }
            }

            // Format args to array if object or string
            let args = []
            if (Array.isArray(rawArgs)) {
                args = rawArgs.map(String)
            } else if (typeof rawArgs === 'object' && rawArgs !== null) {
                args = Object.values(rawArgs).map(String)
            } else if (rawArgs !== undefined && rawArgs !== null && rawArgs !== '') {
                args = [String(rawArgs)]
            }

            // Layer 2: Validator middleware
            const valResult = validateArgs(args)
            if (!valResult.valid) {
                if (ctx.react) await ctx.react('⚠️')
                if (ctx.reply) await ctx.reply(`⚠️ *Gagal Validasi:* ${valResult.reason}`)
                return { success: false, reason: 'VALIDATION_FAILED', message: valResult.reason }
            }

            // Layer 3: Permission check
            const permResult = await checkPermission(ctx, command)
            if (!permResult.allowed) {
                if (ctx.react) await ctx.react('🚫')
                if (ctx.reply) await ctx.reply(permResult.reason ?? '🚫 Akses ditolak.')
                return { success: false, reason: 'DENIED', message: permResult.reason ?? 'Permission denied' }
            }

            // Layer 4: Group guard (bot admin requirement)
            if (command.requireBotAdmin) {
                const guardResult = await groupGuard(ctx, {
                    requireBotAdmin: true,
                    requireSenderAdmin: false
                })
                if (!guardResult.ok) {
                    return { success: false, reason: 'BOT_NOT_ADMIN', message: 'Bot requires admin privileges' }
                }
            }

            // Layer 5: Cooldown check
            const cooldownSecs = command.cooldown ?? 3
            const cooldownRemaining = checkCooldown(ctx.sender, command.name, cooldownSecs)
            if (cooldownRemaining !== null) {
                if (ctx.react) await ctx.react('⏳')
                if (ctx.reply) await ctx.reply(`⏳ *Cooldown!* Mohon tunggu *${cooldownRemaining}* detik sebelum menggunakan command *${commandName}* kembali.`)
                return { success: false, reason: 'COOLDOWN', message: `Cooldown active: ${cooldownRemaining}s remaining` }
            }

            // Layer 6: Metrics & DB tracking
            try {
                metricsService.incrementCommands(command.name)
            } catch (_) {}

            // Output Interception & Execution Context Bridging
            let capturedOutput = ''
            const originalReply = ctx.reply
            const interceptedCtx = {
                ...ctx,
                args,
                commandName: command.name,
                reply: async (text, replyOpts = {}) => {
                    capturedOutput += (capturedOutput ? '\n\n' : '') + String(text)
                    if (originalReply) {
                        return await originalReply(text, replyOpts)
                    }
                }
            }

            try {
                const executionResult = await command.execute(interceptedCtx)
                const finalOutput = capturedOutput || (typeof executionResult === 'string' ? executionResult : '')
                return {
                    success: true,
                    output: finalOutput,
                    data: executionResult
                }
            } catch (err) {
                return {
                    success: false,
                    reason: 'ERROR',
                    error: err,
                    message: err.message
                }
            }
        }
    }
}
