// src/services/orchestrator/contextEngine.js
// Context & Tool Schema Pruning Engine
// WABOT 2.0 v6 Autonomous AI Operating System

import { botLogger } from '../../utils/logger.js'
import { isAllowedForRole, compileParameters } from '../../core/registry.js'

// ─────────────────────────────────────────────
// CANONICAL DOMAIN KEYWORDS FOR INTENT EXTRACTION
// ─────────────────────────────────────────────

const DOMAIN_KEYWORDS = Object.freeze({
    downloader: [
        'download', 'unduh', 'tiktok', 'instagram', 'ig', 'youtube', 'yt', 'reels',
        'fb', 'facebook', 'twitter', 'x.com', 'mp3', 'mp4', 'video', 'music', 'link'
    ],
    media: [
        'stiker', 'sticker', 'brat', 'anomali', 'quote', 'ocr', 'bikin stiker',
        'jadikan stiker', 'buatin stiker', 'gambar', 'foto', 'edit'
    ],
    ai: [
        'generate', 'buat gambar', 'bikin gambar', 'image', 'flux', 'dalle',
        'cekhoax', 'factcheck', 'vision', 'tanya', 'ai', 'rangkum', 'ringkas'
    ],
    group: [
        'kick', 'promote', 'demote', 'tagall', 'hidetag', 'link', 'linkgrup',
        'admin', 'keluar', 'bubar', 'setname', 'setdesc', 'mute', 'unmute', 'group'
    ],
    tools: [
        'cuaca', 'weather', 'aqi', 'kualitas udara', 'suhu', 'kalkulator', 'hitung',
        'ping', 'uptime', 'speed', 'shorturl', 'qr', 'qrcode', 'whois'
    ],
    audio: [
        'radio', 'play', 'lagu', 'musik', 'lyrics', 'lirik', 'tts', 'voice', 'sound'
    ],
    entertainment: [
        'tebak', 'quiz', 'meme', 'joke', 'lelucon', 'game', 'suit', 'truth', 'dare'
    ],
    owner: [
        'eval', 'exec', 'restart', 'update', 'broadcast', 'bc', 'backup', 'whitelist', 'ban'
    ],
    engineering: [
        'cook', 'racik', 'dynamicskill', 'bikin fitur', 'heal', 'fix', 'debug',
        'patch', 'error', 'stack', 'syntax', 'diagnose', 'repair'
    ]
})

// ─────────────────────────────────────────────
// CONTEXT ENGINE CLASS
// ─────────────────────────────────────────────

export class ContextEngine {
    constructor(options = {}) {
        this.defaultTopK = options.defaultTopK || 8
        this.maxHistoryTokens = options.maxHistoryTokens || 1500
        this.maxMessageChars = options.maxMessageChars || 800
        this.relevanceThreshold = options.relevanceThreshold || 12
    }

    /**
     * Fast Token Estimator Heuristic (~4 chars/token English/Code, ~2.5 chars/token Indonesian/Unicode).
     */
    estimateTokenCount(input) {
        if (!input) return 0
        if (typeof input === 'string') {
            // Check non-ASCII density
            const nonAsciiCount = (input.match(/[^\x00-\x7F]/g) || []).length
            const isHeavyNonAscii = nonAsciiCount > input.length * 0.15
            const ratio = isHeavyNonAscii ? 2.5 : 3.8
            return Math.ceil(input.length / ratio)
        }
        if (Array.isArray(input)) {
            let total = 0
            for (const item of input) {
                total += 4 // overhead per message envelope
                if (item.role) total += 1
                if (item.content) total += this.estimateTokenCount(item.content)
            }
            return total
        }
        if (typeof input === 'object') {
            return this.estimateTokenCount(JSON.stringify(input))
        }
        return 0
    }

    /**
     * Extracts Task Intent, Domain Categories, Action Types, and WhatsApp Entities.
     * 
     * @param {string} userPrompt - Raw user text input
     * @param {object} ctx - Ingress message context
     * @returns {object} TaskIntent
     */
    extractTaskIntent(userPrompt, ctx = {}) {
        const raw = (userPrompt || '').trim()
        const clean = raw.toLowerCase().replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
        const words = clean ? clean.split(/\s+/) : []

        // 1. Detect matching domains
        const detectedDomains = []
        for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
            const matches = keywords.some(kw => {
                if (kw.length <= 3) {
                    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    return new RegExp(`\\b${escaped}\\b`, 'i').test(clean)
                }
                return clean.includes(kw)
            })
            if (matches && !detectedDomains.includes(domain)) {
                detectedDomains.push(domain)
            }
        }

        // 2. Action Type Classification
        let actionType = 'qa_conversation'
        if (detectedDomains.includes('engineering')) {
            actionType = 'code_engineering'
        } else if (/\b(ringkas|rangkum|recap|summarize)\b/i.test(clean)) {
            actionType = 'summarization'
        } else if (/\b(generate\s+gambar|buat\s+gambar|bikin\s+gambar|dalle|flux)\b/i.test(clean)) {
            actionType = 'media_generation'
        } else if (/^(uptime|ping|status\s+bot|jam\s+berapa)$/i.test(clean)) {
            actionType = 'system_query'
        } else if (detectedDomains.length > 0) {
            actionType = 'command_execution'
        }

        // 3. WhatsApp Entity Binding
        const sender = ctx.sender || ''
        const chatId = ctx.chatId || ''
        const isGroup = Boolean(ctx.isGroup)

        // Pronoun & reference bindings
        const entityBindings = {
            senderJid: sender,
            chatId: chatId,
            isGroup: isGroup,
            hasMedia: Boolean(
                ctx.type === 'imageMessage' || ctx.type === 'videoMessage' || ctx.type === 'stickerMessage' ||
                ctx.messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
            ),
            hasUrl: /(https?:\/\/\S+)/i.test(raw),
            mentions: []
        }

        // Extract mentioned JIDs
        const mentionMatches = raw.match(/@(\d{8,16})\b/g)
        if (mentionMatches) {
            entityBindings.mentions = mentionMatches.map(m => `${m.replace('@', '')}@s.whatsapp.net`)
        }

        return {
            rawPrompt: raw,
            cleanText: clean,
            keywords: words,
            domains: detectedDomains,
            actionType,
            entities: entityBindings
        }
    }

    /**
     * Semantic Tool Schema Pruning (Filters 103 commands down to Top-K relevant schemas).
     * 
     * @param {Map|Array} availableTools - All commands from registry.getAllCommands()
     * @param {object} taskIntent - Output from extractTaskIntent
     * @param {object} options - Filtering options (role, topK, isGroup, botIsAdmin, format)
     * @returns {object} PruningResult
     */
    pruneTools(availableTools, taskIntent, options = {}) {
        const role = options.role || 'user'
        const topK = Math.max(1, options.topK || this.defaultTopK)
        const isGroup = Boolean(options.isGroup)
        const botIsAdmin = Boolean(options.botIsAdmin)
        const format = options.format || 'openai' // 'openai' | 'hermes_prompt' | 'raw'
        const allowEmpty = options.allowEmpty !== false // If pure chat, allow 0 tools to save tokens

        // Normalize availableTools into an Array
        let toolList = []
        if (availableTools instanceof Map) {
            toolList = Array.from(availableTools.values())
        } else if (Array.isArray(availableTools)) {
            toolList = availableTools
        } else if (availableTools && typeof availableTools === 'object') {
            toolList = Object.values(availableTools)
        }

        const totalAvailable = toolList.length
        const scoredTools = []

        const isWordMatch = (token) => {
            if (!token) return false
            if (token.length <= 2) {
                return taskIntent.keywords.includes(token)
            }
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            return new RegExp(`\\b${escaped}\\b`, 'i').test(taskIntent.cleanText)
        }

        // ─────────────────────────────────────────────
        // STAGE 1 & 2: Permission Gate & Relevance Scoring
        // ─────────────────────────────────────────────
        for (const cmd of toolList) {
            if (!cmd || cmd.enabled === false) continue
            // Conversational entrypoint 'q' is the agent itself, not an external tool
            if (cmd.name === 'q') continue

            // 1. Role Permission Gate
            if (!isAllowedForRole(cmd, role)) continue

            // 2. Group Context Gate (group-only commands excluded in DMs)
            if (cmd.category === 'group' && !isGroup) continue

            // 3. Bot Admin Constraint (deprioritize if bot is not group admin)
            const botAdminPenalty = (cmd.requireBotAdmin && !botIsAdmin) ? -50 : 0

            // 4. Calculate Relevance Score
            let score = 0
            const cmdName = (cmd.name || '').toLowerCase()
            const cmdDesc = (cmd.description || cmd.desc || '').toLowerCase()
            const cmdCat = (cmd.category || '').toLowerCase()
            const cmdAliases = Array.isArray(cmd.aliases) ? cmd.aliases.map(a => String(a).toLowerCase()) : []
            const cmdTags = Array.isArray(cmd.tags) ? cmd.tags.map(t => String(t).toLowerCase()) : []

            // A. Exact Name or Alias Match (+60 points name, +50 points alias)
            if (isWordMatch(cmdName)) {
                score += 60
            }
            for (const alias of cmdAliases) {
                if (isWordMatch(alias)) {
                    score += 50
                    break
                }
            }

            // B. Category / Domain Match (+30 points)
            if (taskIntent.domains.includes(cmdCat)) {
                score += 30
            }

            // C. Tag Match (+15 points each, up to 30)
            let tagMatches = 0
            for (const tag of cmdTags) {
                if (isWordMatch(tag)) {
                    score += 15
                    tagMatches++
                    if (tagMatches >= 2) break
                }
            }

            // D. Description Word Overlap (+8 points each, up to 24)
            let descMatches = 0
            for (const word of taskIntent.keywords) {
                if (word.length >= 3 && cmdDesc.includes(word)) {
                    score += 8
                    descMatches++
                    if (descMatches >= 3) break
                }
            }

            // E. Entity Heuristics (+25 points)
            if (taskIntent.entities.hasMedia && ['media', 'sticker', 'image'].includes(cmdCat)) {
                score += 25
            }
            if (taskIntent.entities.hasUrl) {
                if (cmdCat === 'downloader') {
                    score += 35
                } else if (cmdTags.some(t => ['url', 'link', 'download'].includes(t)) || cmdName.includes('link') || cmdName.includes('url')) {
                    score += 20
                }
            }

            score += botAdminPenalty

            if (score > 0) {
                scoredTools.push({ cmd, score })
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 3: Sort & Select Top-K
        // ─────────────────────────────────────────────
        scoredTools.sort((a, b) => b.score - a.score)

        // Filter by relevance threshold
        let selectedCandidates = scoredTools.filter(item => item.score >= this.relevanceThreshold)

        // If no tool met threshold:
        if (selectedCandidates.length === 0) {
            if (allowEmpty) {
                // Pure conversation / knowledge query: 0 tools = massive token savings!
                return {
                    tools: [],
                    totalAvailable,
                    selectedCount: 0,
                    prunedCount: totalAvailable,
                    estimatedTokens: 0,
                    tokenSavings: totalAvailable * 200 // estimated ~20,000 tokens saved
                }
            } else {
                // Include top 2 fallback utilities
                selectedCandidates = scoredTools.slice(0, 2)
            }
        } else {
            // Slice top-K
            selectedCandidates = selectedCandidates.slice(0, topK)
        }

        const selectedCommands = selectedCandidates.map(item => item.cmd)

        // ─────────────────────────────────────────────
        // STAGE 4: Output Schema Formatting
        // ─────────────────────────────────────────────
        let formattedOutput = []

        if (format === 'openai') {
            formattedOutput = selectedCommands.map(cmd => ({
                type: 'function',
                function: {
                    name: cmd.name,
                    description: cmd.description || `${cmd.name} command`,
                    parameters: compileParameters(cmd)
                }
            }))
        } else if (format === 'hermes_prompt') {
            const lines = []
            for (const cmd of selectedCommands) {
                const aliasStr = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(', ')})` : ''
                lines.push(`- **${cmd.name}**${aliasStr}: ${cmd.description || 'No description'} | Usage: \`${cmd.usage || `.${cmd.name}`}\``)
            }
            formattedOutput = lines.join('\n')
        } else {
            formattedOutput = selectedCommands
        }

        const estimatedTokens = this.estimateTokenCount(formattedOutput)
        const tokenSavings = Math.max(0, (totalAvailable * 200) - estimatedTokens)

        botLogger?.info?.('orchestrator', `[ContextEngine] Pruned ${totalAvailable} tools down to ${selectedCommands.length} tools (Tokens: ${estimatedTokens}, Saved: ~${tokenSavings})`)

        return {
            tools: formattedOutput,
            totalAvailable,
            selectedCount: selectedCommands.length,
            prunedCount: totalAvailable - selectedCommands.length,
            estimatedTokens,
            tokenSavings
        }
    }

    /**
     * Compresses and prunes conversation history while preserving doctrine and identity invariants.
     * 
     * @param {Array} history - Array of { role, content, ... } messages
     * @param {object} options - Pruning options (maxTokens, keepLastN, maxMessageChars)
     * @returns {Array} Pruned & compressed message history
     */
    pruneHistory(history, options = {}) {
        if (!Array.isArray(history) || history.length === 0) return []

        const maxTokens = options.maxTokens || this.maxHistoryTokens
        const keepLastN = Math.max(2, options.keepLastN || 4)
        const maxMessageChars = options.maxMessageChars || this.maxMessageChars

        // ─────────────────────────────────────────────
        // STEP 1: Compact Verbose Tool Results & Huge Messages
        // ─────────────────────────────────────────────
        const compacted = history.map(msg => {
            const copy = { ...msg }
            let content = copy.content || ''

            // Tool execution JSON compaction
            if (content.includes('{') && content.includes('executeCommand')) {
                try {
                    const startIdx = content.indexOf('{')
                    const endIdx = content.lastIndexOf('}')
                    if (startIdx !== -1 && endIdx > startIdx) {
                        const parsed = JSON.parse(content.substring(startIdx, endIdx + 1))
                        if (parsed.executeCommand && parsed.command) {
                            copy.content = `[Tool Invocation: ${parsed.command} args: ${JSON.stringify(parsed.args || [])}]`
                            return copy
                        }
                    }
                } catch (_) {}
            }

            // Truncate individual oversized messages (preserve head and tail)
            if (content.length > maxMessageChars) {
                const half = Math.floor(maxMessageChars / 2) - 30
                copy.content = `${content.substring(0, half)}\n... [${content.length - half * 2} characters omitted for brevity] ...\n${content.substring(content.length - half)}`
            }

            return copy
        })

        // ─────────────────────────────────────────────
        // STEP 2: Sliding Window & Token Budget Rollup
        // ─────────────────────────────────────────────
        const totalTokens = this.estimateTokenCount(compacted)
        if (totalTokens <= maxTokens || compacted.length <= keepLastN) {
            return compacted
        }

        // Split history into older turns and recent window turns
        const splitIdx = Math.max(0, compacted.length - keepLastN)
        const olderTurns = compacted.slice(0, splitIdx)
        const recentTurns = compacted.slice(splitIdx)

        // Generate synthetic summary for older turns
        const olderSummaryPoints = []
        for (const m of olderTurns) {
            if (m.role === 'system') continue // preserve separate if needed
            const snippet = (m.content || '').replace(/\s+/g, ' ').substring(0, 100)
            olderSummaryPoints.push(`${m.role === 'user' ? 'User asked' : 'Bot responded'}: "${snippet}..."`)
        }

        const summaryText = `[Prior Conversation Context (${olderTurns.length} earlier turns): ${olderSummaryPoints.slice(-3).join('; ')}]`
        const syntheticTurn = { role: 'system', content: summaryText }

        return [syntheticTurn, ...recentTurns]
    }

    /**
     * Builds end-to-end optimized context payload ready for provider dispatch.
     * 
     * @param {string} chatId - WhatsApp Chat ID / JID
     * @param {string} userPrompt - User prompt
     * @param {object} options - Options including registry, memory, introspection, and caller context
     * @returns {object} OptimizedContext
     */
    async buildOptimizedContext(chatId, userPrompt, options = {}) {
        const ctx = options.ctx || {}
        const availableTools = options.tools || []
        const history = options.history || []
        const role = options.role || (ctx.isOwner ? 'owner' : ctx.isAdmin ? 'admin' : 'user')

        // 1. Intent Extraction
        const intent = this.extractTaskIntent(userPrompt, ctx)

        // 2. Semantic Tool Pruning
        const toolPruningResult = this.pruneTools(availableTools, intent, {
            role,
            topK: options.topK || this.defaultTopK,
            isGroup: Boolean(ctx.isGroup),
            botIsAdmin: Boolean(ctx.botIsAdmin),
            format: options.toolFormat || 'openai'
        })

        // 3. Conversation History Pruning
        const prunedHistory = this.pruneHistory(history, {
            maxTokens: options.maxHistoryTokens || this.maxHistoryTokens,
            keepLastN: options.keepLastN || 4
        })

        // 4. Token Metrics & Telemetry
        const estimatedPromptTokens = this.estimateTokenCount(userPrompt)
        const estimatedHistoryTokens = this.estimateTokenCount(prunedHistory)
        const estimatedToolTokens = toolPruningResult.estimatedTokens
        const totalEstimatedTokens = estimatedPromptTokens + estimatedHistoryTokens + estimatedToolTokens

        return {
            taskIntent: intent,
            prunedTools: toolPruningResult.tools,
            prunedHistory,
            telemetry: {
                totalEstimatedTokens,
                toolTokens: estimatedToolTokens,
                historyTokens: estimatedHistoryTokens,
                toolsSelectedCount: toolPruningResult.selectedCount,
                toolsPrunedCount: toolPruningResult.prunedCount,
                tokensSaved: toolPruningResult.tokenSavings
            }
        }
    }
}

export const contextEngine = new ContextEngine()
export default contextEngine
