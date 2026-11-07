// src/services/orchestrator/modelTierRouter.js
// Tiered Model Routing (Tier 0-3) with Cheapest-First Strategy & Dynamic Escalation
// WABOT 2.0 v6 Autonomous AI Operating System

import { botLogger } from '../../utils/logger.js'

// ─────────────────────────────────────────────
// MODEL TIERS & CONSTANTS
// ─────────────────────────────────────────────

export const MODEL_TIERS = Object.freeze({
    TIER_0_DETERMINISTIC: 0,
    TIER_1_LIGHTWEIGHT: 1,
    TIER_2_GENERAL_REASONING: 2,
    TIER_3_SPECIALIST_ENGINEERING: 3
})

export const TASK_COMPLEXITY = Object.freeze({
    TRIVIAL: 'trivial',          // Deterministic, regex, math, ping, uptime
    SIMPLE: 'simple',            // Short Q&A, short summarization, simple categorization
    MODERATE: 'moderate',        // Contextual conversation, single-step tool execution
    COMPLEX: 'complex',          // Multi-step tool loop, debate, deep analysis
    ENGINEERING: 'engineering'   // Code diagnosis, self-healing, patch synthesis, AST analysis
})

/**
 * Model specifications and capabilities per tier.
 */
export const TIER_CONFIGS = Object.freeze({
    [MODEL_TIERS.TIER_0_DETERMINISTIC]: {
        name: 'Deterministic Local Engine',
        description: 'Zero LLM tokens, local regex matching, safe math, cache lookup, bot introspection',
        costPerMillionTokens: { input: 0, output: 0 },
        typicalLatencyMs: 2,
        maxTokens: 0,
        models: [
            { id: 'local-rule-engine', provider: 'local', priority: 1 }
        ]
    },
    [MODEL_TIERS.TIER_1_LIGHTWEIGHT]: {
        name: 'Lightweight Fast Model',
        description: 'High throughput, low latency intent classification, quick summaries, simple Q&A',
        costPerMillionTokens: { input: 0.05, output: 0.10 },
        typicalLatencyMs: 350,
        maxOutputTokens: 1024,
        models: [
            { id: 'llama-3.1-8b-instant', provider: 'groq', priority: 1, maxTokens: 1024 },
            { id: 'qwen/qwen3.8-27b', provider: 'groq', priority: 2, maxTokens: 1024 },
            { id: 'gemini-2.5-flash', provider: 'gemini', priority: 3, maxTokens: 1024 },
            { id: 'gemini-1.5-flash', provider: 'gemini', priority: 4, maxTokens: 1024 },
            { id: 'meta/llama-3.1-8b-instruct', provider: 'nvidia', priority: 5, maxTokens: 1024 }
        ]
    },
    [MODEL_TIERS.TIER_2_GENERAL_REASONING]: {
        name: 'General Reasoning Model',
        description: 'Multi-step reasoning, tool planning loop, contextual analysis, creative synthesis',
        costPerMillionTokens: { input: 0.35, output: 0.70 },
        typicalLatencyMs: 1400,
        maxOutputTokens: 2048,
        models: [
            { id: 'openai/gpt-oss-120b', provider: 'groq', priority: 1, maxTokens: 2048 },
            { id: 'openai/gpt-oss-20b', provider: 'groq', priority: 2, maxTokens: 2048 },
            { id: 'nousresearch/hermes-3-llama-3.1-70b', provider: 'openrouter', priority: 3, maxTokens: 2048 },
            { id: 'nvidia/llama-3.1-nemotron-70b-instruct', provider: 'nvidia', priority: 4, maxTokens: 2048 },
            { id: 'meta/llama-3.3-70b-instruct', provider: 'nvidia', priority: 5, maxTokens: 2048 },
            { id: 'gemini-1.5-pro', provider: 'gemini', priority: 6, maxTokens: 2048 }
        ]
    },
    [MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING]: {
        name: 'Specialist Engineering Model',
        description: 'Autonomous self-healing, stack trace diagnosis, minimal patch synthesis, code verification',
        costPerMillionTokens: { input: 1.50, output: 3.50 },
        typicalLatencyMs: 3200,
        maxOutputTokens: 4096,
        models: [
            { id: 'deepseek-ai/deepseek-v4-pro', provider: 'nvidia', priority: 1, maxTokens: 4096 },
            { id: 'deepseek-chat', provider: 'deepseek', priority: 2, maxTokens: 4096 },
            { id: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia', priority: 3, maxTokens: 4096 },
            { id: 'deepseek-ai/deepseek-v4.1-flash', provider: 'nvidia', priority: 4, maxTokens: 4096 },
            { id: 'gpt-4o', provider: 'openai', priority: 5, maxTokens: 4096 }
        ]
    }
})

// ─────────────────────────────────────────────
// SAFE DETERMINISTIC MATH EVALUATOR (NO EVAL)
// ─────────────────────────────────────────────

function safeEvaluateMath(expr) {
    if (!expr || typeof expr !== 'string') return null
    // Clean string to allowed tokens: digits, operators, parens, decimal point, math functions
    const sanitized = expr.toLowerCase()
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/:/g, '/')
        .replace(/,/g, '.')
        .replace(/\*\*/g, '^')
        .replace(/(?:math\.)?sqrt\(([^)]+)\)/g, 'Math.sqrt($1)')
        .trim()

    // Strict validation: only allowed characters
    if (!/^[0-9+\-*/().\sMathsqrt%^]+$/.test(sanitized)) {
        return null
    }

    try {
        // Safe evaluation without Function/eval using token arithmetic parser
        const tokens = sanitized.match(/Math\.sqrt|\d+\.?\d*|\^|[+\-*/()]/g)
        if (!tokens || tokens.length === 0) return null

        // Simple shunting-yard evaluator for safety
        const outputQueue = []
        const operatorStack = []
        const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'Math.sqrt': 4 }

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]
            if (!isNaN(parseFloat(token))) {
                outputQueue.push(parseFloat(token))
            } else if (token === 'Math.sqrt') {
                operatorStack.push(token)
            } else if (token in precedence) {
                while (
                    operatorStack.length > 0 &&
                    operatorStack[operatorStack.length - 1] in precedence &&
                    (token === '^'
                        ? precedence[operatorStack[operatorStack.length - 1]] > precedence[token]
                        : precedence[operatorStack[operatorStack.length - 1]] >= precedence[token])
                ) {
                    outputQueue.push(operatorStack.pop())
                }
                operatorStack.push(token)
            } else if (token === '(') {
                operatorStack.push(token)
            } else if (token === ')') {
                let foundOpen = false
                while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                    outputQueue.push(operatorStack.pop())
                }
                if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] === '(') {
                    operatorStack.pop()
                    foundOpen = true
                }
                if (!foundOpen) return null // Unmatched closing parenthesis
                if (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] === 'Math.sqrt') {
                    outputQueue.push(operatorStack.pop())
                }
            }
        }

        while (operatorStack.length > 0) {
            const op = operatorStack.pop()
            if (op === '(' || op === ')') return null
            outputQueue.push(op)
        }

        // Evaluate RPN
        const evalStack = []
        for (const token of outputQueue) {
            if (typeof token === 'number') {
                evalStack.push(token)
            } else if (token === 'Math.sqrt') {
                const a = evalStack.pop()
                if (a === undefined || a < 0) return null
                evalStack.push(Math.sqrt(a))
            } else {
                const b = evalStack.pop()
                const a = evalStack.pop()
                if (a === undefined || b === undefined) return null
                switch (token) {
                    case '+': evalStack.push(a + b); break
                    case '-': evalStack.push(a - b); break
                    case '*': evalStack.push(a * b); break
                    case '/': 
                        if (b === 0) return null // Avoid division by zero
                        evalStack.push(a / b); 
                        break
                    case '^':
                        evalStack.push(Math.pow(a, b));
                        break
                }
            }
        }

        if (evalStack.length === 1 && !isNaN(evalStack[0])) {
            const res = evalStack[0]
            return Number.isInteger(res) ? res : Number(res.toFixed(6))
        }
    } catch (_) {}

    return null
}

// ─────────────────────────────────────────────
// MODEL TIER ROUTER CLASS
// ─────────────────────────────────────────────

export class ModelTierRouter {
    constructor(options = {}) {
        this.cache = new Map() // LRU cache for deterministic / frequent queries
        this.maxCacheSize = options.maxCacheSize || 200
        this.cacheTtlMs = options.cacheTtlMs || 5 * 60 * 1000 // 5 minutes
    }

    /**
     * Check if task can be resolved deterministically in Tier 0.
     * Returns match result object or null.
     */
    checkTier0Deterministic(promptText, ctx = {}) {
        if (!promptText || typeof promptText !== 'string') return null
        const raw = promptText.trim()
        const clean = raw.toLowerCase().replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()

        // 1. Exact Cache Lookup
        const cached = this.#getFromCache(clean)
        if (cached) {
            return {
                type: 'cache_hit',
                text: cached,
                source: 'lru_cache'
            }
        }

        // 2. Safe Math & Arithmetic Check
        let mathExpr = null
        const mathPrefixMatch = raw.match(/^(?:hitung|kalkulator|calculate|math)(?:\s+|[:=]\s*)(.+)$/i)
        if (mathPrefixMatch) {
            mathExpr = mathPrefixMatch[1]
        } else if (/^[0-9+\-*/().\s^%×÷:]+$|sqrt/i.test(raw) && !/[a-z]/i.test(raw.replace(/(?:math\.)?sqrt/gi, ''))) {
            mathExpr = raw
        }

        if (mathExpr) {
            const result = safeEvaluateMath(mathExpr)
            if (result !== null) {
                const text = `🔢 *Hasil Perhitungan:*\n\`${mathExpr.trim()}\` = *${result}*`
                this.#setInCache(clean, text)
                return {
                    type: 'math',
                    text,
                    calculation: { expression: mathExpr, result }
                }
            }
        }

        // 3. System & Introspection Queries
        if (/^(uptime|bot\s*aktif|lama\s*aktif)$/i.test(clean)) {
            const uptimeSec = Math.floor(process.uptime())
            const d = Math.floor(uptimeSec / 86400)
            const h = Math.floor((uptimeSec % 86400) / 3600)
            const m = Math.floor((uptimeSec % 3600) / 60)
            const s = uptimeSec % 60
            const text = `⏱️ *Bot Uptime:* ${d > 0 ? `${d}h ` : ''}${h}j ${m}m ${s}d`
            return { type: 'system_uptime', text }
        }

        if (/^(ping|speed\s*bot|kecepatan\s*bot)$/i.test(clean)) {
            const text = `🏓 *Pong!* Kecepatan respon: ~1ms (Deterministic Tier 0)`
            return { type: 'system_ping', text }
        }

        if (/^(jam\s*berapa|waktu\s*sekarang|tanggal\s*berapa|hari\s*apa)$/i.test(clean)) {
            const now = new Date()
            const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' })
            const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })
            const text = `🕒 *Waktu Real-time (WIB):*\n- Hari/Tanggal: ${dateStr}\n- Jam: ${timeStr} WIB`
            return { type: 'system_time', text }
        }

        // 4. Owner & Creator Identity Easter Egg
        const senderIsOwner = Boolean(ctx.isOwner || ctx.msg?.key?.fromMe)
        const isGroup = Boolean(ctx.isGroup)
        const ownerNumber = '6285172013920'
        const ownerTag = `@${ownerNumber}`
        const ownerJid = `${ownerNumber}@s.whatsapp.net`

        const isWhoAmI = /\b(siapa\s*(aku|gw|gua|gue|saya)|(kamu|lo|lu|bot)\s*kenal\s*(aku|gw|gua|gue|saya)|(gua|gw|aku|gue|saya)\s*siapa)\b/i.test(clean)
        if (isWhoAmI) {
            if (senderIsOwner) {
                const text = isGroup
                    ? `Ya kenal lah Bang Rony ${ownerTag}! 😎🤙\n\nLu kan creator, developer, sekaligus owner & bos utama gua yang bikin RonnBot. Masa sama bapak sendiri gua lupa wkwk!`
                    : `Ya kenal lah Bang Rony! 😎🤙\n\nLu kan creator, developer, sekaligus owner & bos utama gua yang bikin RonnBot. Masa sama bapak sendiri gua lupa wkwk!`
                return { type: 'identity_owner', text, mentions: isGroup ? [ownerJid] : [] }
            } else {
                const name = ctx.pushName || 'kawan'
                const text = isGroup
                    ? `Halo ${name}! Kamu salah satu member di grup ini. Kalau mau kenalan sama yang bikin bot ini, dia Bang Rony ${ownerTag} (Creator & Owner RonnBot) 😎`
                    : `Halo ${name}! Aku RonnBot, asisten WhatsApp cerdas yang diciptakan oleh Bang Rony Imanuel Sihombing (${ownerNumber}) 🚀`
                return { type: 'identity_user', text, mentions: isGroup ? [ownerJid] : [] }
            }
        }

        const isCreatorQuery = /\b(siapa\s*(owner|creator|pembuat(mu|nya)?|pencipta(mu|nya)?|developer(mu)?|boss?)|siapa\s*yang\s*(bikin|buat|ciptakan)\s*(kamu|bot|lu))\b/i.test(clean)
        if (isCreatorQuery) {
            const text = isGroup
                ? `RonnBot diciptakan dan dikembangkan oleh Bang Rony Imanuel Sihombing (${ownerTag}) sebagai asisten AI cerdas berbasis Hermes Agent OS! 🚀`
                : `RonnBot diciptakan dan dikembangkan oleh Bang Rony Imanuel Sihombing (${ownerNumber}) sebagai asisten AI cerdas berbasis Hermes Agent OS! 🚀`
            return { type: 'identity_creator', text, mentions: isGroup ? [ownerJid] : [] }
        }

        // 5. Direct Regex Command Patterns (from WABOT2.0 aiRouter)
        const directCmd = this.#matchDirectCommand(raw, ctx)
        if (directCmd) {
            return {
                type: 'direct_command',
                command: directCmd.command,
                args: directCmd.args,
                isCommandDispatch: true
            }
        }

        return null
    }

    /**
     * Internal direct command matcher.
     */
    #matchDirectCommand(text, ctx) {
        // Direct command prefix (.ping, .menu, etc.)
        if (/^[.!/][a-zA-Z0-9_-]+/.test(text.trim())) {
            const parts = text.trim().slice(1).split(/\s+/)
            const cmd = parts[0].toLowerCase()
            const args = parts.slice(1)
            return { command: cmd, args }
        }

        // Rangkum
        if (/\b(ringkas|rangkum|recap|summarize|rangkuman)\b/i.test(text)) {
            const numMatch = text.match(/\b(\d{1,3})\b/)
            const count = numMatch ? numMatch[1] : '100'
            return { command: 'rangkum', args: [count, text] }
        }

        // Cuaca
        if (/\b(aqi|air\s*quality|kualitas\s*udara|polusi|cuaca|weather|prakiraan\s+cuaca|cek\s+cuaca)\b/i.test(text)) {
            const cleaned = text
                .replace(/\b(live\s*update|live|update|cek\s+cuaca|cek|info|prakiraan\s+cuaca|cuaca|weather|aqi|polusi|suhu|hari\s*ini|sekarang|di|kota)\b/gi, '')
                .replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ')
                .trim()
            return { command: 'cuaca', args: cleaned ? [cleaned] : ['Jakarta'] }
        }

        // Downloader
        const urlMatch = text.match(/(https?:\/\/(www\.)?(instagram\.com|tiktok\.com|youtu\.be|youtube\.com|fb\.watch|facebook\.com|x\.com|twitter\.com)\/\S+)/i)
        if (urlMatch) {
            return { command: 'dl', args: [urlMatch[1]] }
        }

        // Groups
        if (/\b(berapa|daftar|list|sebutkan)\s+grup\b/i.test(text) || /\bgrup\s+(apa\s+aja|mana\s+aja)\b/i.test(text)) {
            return { command: 'groups', args: [] }
        }

        return null
    }

    /**
     * Classify task complexity based on intent, syntax, and domain markers.
     */
    classifyComplexity(taskIntent) {
        if (!taskIntent) return TASK_COMPLEXITY.SIMPLE

        const text = (taskIntent.rawPrompt || taskIntent.promptText || '').toLowerCase()
        const domains = taskIntent.domains || []
        const actionType = taskIntent.actionType || ''

        // 1. Engineering / Self-Healing / AST / Code Repair -> ENGINEERING
        const isEngineering = domains.includes('engineering') ||
            actionType === 'code_engineering' ||
            /\b(error|syntaxerror|typeerror|uncaught|exception|stack\s*trace|reproduce|patch|repair|self-healing|diagnose|regression|ast|bytecode)\b/i.test(text)
        if (isEngineering) return TASK_COMPLEXITY.ENGINEERING

        // 2. Complex Reasoning / Multi-step Planning / Deep Analysis -> COMPLEX
        const isComplex = /\b(analisa\s+mendalam|bandingkan|filsafat|argumen|geopolitik|arsitektur|design\s*pattern|buatkan\s+rencana|pro\s+dan\s+kontra)\b/i.test(text) ||
            text.length > 600 ||
            (taskIntent.multiStep === true)
        if (isComplex) return TASK_COMPLEXITY.COMPLEX

        // 3. Moderate Context / Tool Planning -> MODERATE
        if (actionType === 'command_execution' || domains.length > 0 || text.length > 150) {
            return TASK_COMPLEXITY.MODERATE
        }

        // 4. Default: Simple Conversation / Direct Q&A -> SIMPLE
        return TASK_COMPLEXITY.SIMPLE
    }

    /**
     * Core Routing Method: Selects cheapest capable model tier.
     * Integrates with budgetManager and providerHealthManager.
     * 
     * @param {object} taskIntent - Output from ContextEngine.extractTaskIntent
     * @param {object} options - Execution context options
     * @returns {object} RoutingDecision
     */
    routeTask(taskIntent, options = {}) {
        const promptText = taskIntent.rawPrompt || taskIntent.promptText || ''
        const ctx = options.ctx || {}
        const budgetScope = options.budgetScope || null
        const providerHealth = options.providerHealth || null
        const forceTier = options.forceTier !== undefined ? options.forceTier : null

        // ─────────────────────────────────────────────
        // STEP 1: Forced Tier Override
        // ─────────────────────────────────────────────
        if (forceTier !== null) {
            return this.#buildTierDecision(forceTier, 'Forced Tier override specified in options', providerHealth)
        }

        // ─────────────────────────────────────────────
        // STEP 2: Tier 0 Deterministic Check (0 tokens, 0 API calls)
        // ─────────────────────────────────────────────
        const deterministicMatch = this.checkTier0Deterministic(promptText, ctx)
        if (deterministicMatch) {
            botLogger?.info?.('orchestrator', `[ModelTierRouter] Tier 0 match: ${deterministicMatch.type} (0 LLM tokens)`)
            return {
                tier: MODEL_TIERS.TIER_0_DETERMINISTIC,
                tierName: TIER_CONFIGS[MODEL_TIERS.TIER_0_DETERMINISTIC].name,
                isDeterministic: true,
                model: 'local-rule-engine',
                provider: 'local',
                matchType: deterministicMatch.type,
                directResult: deterministicMatch.text || null,
                command: deterministicMatch.command || null,
                args: deterministicMatch.args || [],
                mentions: deterministicMatch.mentions || [],
                estimatedTokens: { input: 0, output: 0 },
                estimatedCost: 0,
                fallbackChain: [],
                reason: `Resolved via deterministic local handler: ${deterministicMatch.type}`
            }
        }

        // ─────────────────────────────────────────────
        // STEP 3: Task Complexity Classification
        // ─────────────────────────────────────────────
        const complexity = this.classifyComplexity(taskIntent)
        let targetTier = MODEL_TIERS.TIER_1_LIGHTWEIGHT

        switch (complexity) {
            case TASK_COMPLEXITY.ENGINEERING:
                targetTier = MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING
                break
            case TASK_COMPLEXITY.COMPLEX:
            case TASK_COMPLEXITY.MODERATE:
                targetTier = MODEL_TIERS.TIER_2_GENERAL_REASONING
                break
            case TASK_COMPLEXITY.SIMPLE:
            default:
                targetTier = MODEL_TIERS.TIER_1_LIGHTWEIGHT
                break
        }

        // ─────────────────────────────────────────────
        // STEP 4: Budget Scope Constraint Reconciliation
        // ─────────────────────────────────────────────
        if (budgetScope && typeof budgetScope.getRemaining === 'function') {
            const remaining = budgetScope.getRemaining()
            const inputTokensLeft = remaining.inputTokens ?? remaining.tokens ?? 0
            
            // If remaining input or output token budget is too constrained for target tier, downgrade
            if (targetTier === MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING && inputTokensLeft < 2000) {
                botLogger?.warn?.('orchestrator', `[ModelTierRouter] Downgrading Tier 3 -> Tier 2 due to budget constraint (${inputTokensLeft} tokens left)`)
                targetTier = MODEL_TIERS.TIER_2_GENERAL_REASONING
            }
            if (targetTier === MODEL_TIERS.TIER_2_GENERAL_REASONING && inputTokensLeft < 800) {
                botLogger?.warn?.('orchestrator', `[ModelTierRouter] Downgrading Tier 2 -> Tier 1 due to budget constraint (${inputTokensLeft} tokens left)`)
                targetTier = MODEL_TIERS.TIER_1_LIGHTWEIGHT
            }
        }

        // ─────────────────────────────────────────────
        // STEP 5: Provider Health & Fallback Construction
        // ─────────────────────────────────────────────
        return this.#buildTierDecision(targetTier, `Selected via complexity classification: ${complexity}`, providerHealth)
    }

    /**
     * Builds standard RoutingDecision structure for a given tier.
     */
    #buildTierDecision(tier, reason, providerHealth = null) {
        const config = TIER_CONFIGS[tier] || TIER_CONFIGS[MODEL_TIERS.TIER_1_LIGHTWEIGHT]
        const availableModels = [...config.models]

        // Filter models using providerHealth if provided
        let healthyModels = availableModels
        if (providerHealth && typeof providerHealth.isAvailable === 'function') {
            healthyModels = availableModels.filter(m => providerHealth.isAvailable(m.provider))
            // If all providers in tier are down, fallback to availableModels to avoid empty chain
            if (healthyModels.length === 0) {
                botLogger?.warn?.('orchestrator', `[ModelTierRouter] All providers in Tier ${tier} reported unhealthy. Retaining original fallback chain.`)
                healthyModels = availableModels
            }
        }

        // Selected primary model is the top priority healthy model
        const primary = healthyModels[0] || availableModels[0]
        const fallbackChain = healthyModels.slice(1).map(m => ({ id: m.id, provider: m.provider }))

        const estimatedInput = tier === 1 ? 500 : tier === 2 ? 1500 : 3500
        const estimatedOutput = tier === 1 ? 250 : tier === 2 ? 600 : 1200
        const estimatedCost = (estimatedInput * config.costPerMillionTokens.input + estimatedOutput * config.costPerMillionTokens.output) / 1_000_000

        return {
            tier,
            tierName: config.name,
            isDeterministic: false,
            model: primary.id,
            provider: primary.provider,
            maxTokens: primary.maxTokens || config.maxOutputTokens,
            fallbackChain,
            estimatedTokens: { input: estimatedInput, output: estimatedOutput },
            estimatedCost: Number(estimatedCost.toFixed(6)),
            reason
        }
    }

    /**
     * Dynamic Escalation: Escalates to the next tier if the lower tier fails.
     */
    escalateTier(currentDecision, failureReason, options = {}) {
        if (currentDecision.tier >= MODEL_TIERS.TIER_3_SPECIALIST_ENGINEERING) {
            throw new Error(`Cannot escalate beyond Tier 3 (Specialist Engineering). Original failure: ${failureReason}`)
        }

        const nextTier = currentDecision.tier + 1
        botLogger?.warn?.('orchestrator', `[ModelTierRouter] Escalating Tier ${currentDecision.tier} -> Tier ${nextTier}. Reason: ${failureReason}`)

        const escalated = this.#buildTierDecision(nextTier, `Escalated from Tier ${currentDecision.tier}: ${failureReason}`, options.providerHealth)
        escalated.escalatedFrom = currentDecision.tier
        escalated.escalationReason = failureReason
        return escalated
    }

    // ─────────────────────────────────────────────
    // LRU CACHE HELPERS
    // ─────────────────────────────────────────────

    #getFromCache(key) {
        if (!this.cache.has(key)) return null
        const entry = this.cache.get(key)
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key)
            return null
        }
        // Move to end (most recently used)
        this.cache.delete(key)
        this.cache.set(key, entry)
        return entry.value
    }

    #setInCache(key, value) {
        if (this.cache.size >= this.maxCacheSize) {
            const oldestKey = this.cache.keys().next().value
            this.cache.delete(oldestKey)
        }
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.cacheTtlMs
        })
    }
}

export const modelTierRouter = new ModelTierRouter()
export default modelTierRouter
