import { generatePromptToolDefinitions } from '../core/registry.js'
// src/services/hermes.js
// Dedicated service to interface with NousResearch Hermes Agent / Cloud API (HF Space / OpenRouter / Hosted Hermes)
import axios from 'axios'
import { logger } from '../utils/logger.js'

class HermesService {
    constructor() {
        this.rawUrl = process.env.HERMES_AGENT_URL || 'http://127.0.0.1:8642/v1'
        this.baseUrl = this.rawUrl.replace(/\/+$/, '')
        this.apiKey = process.env.HERMES_API_KEY || process.env.OPENROUTER_API_KEY || ''
        
        // Auto-detect model default: If using OpenRouter URL, default to nousresearch/hermes-3-llama-3.1-70b
        const defaultModel = this.baseUrl.includes('openrouter') 
            ? 'nousresearch/hermes-3-llama-3.1-70b' 
            : 'hermes-agent'
            
        this.model = process.env.HERMES_MODEL || defaultModel
        this.enabled = process.env.HERMES_ENABLED !== 'false'
        this.reasoningMap = new Map()
    }

    /**
     * Get Hermes Agent memory/history for specific chatId
     */
    async getMemory(chatId) {
        try {
            const url = `${this.baseUrl}/memory/${encodeURIComponent(chatId)}`
            const headers = {}
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`
            }
            const response = await axios.get(url, { headers, timeout: 5000 })
            return { ok: true, data: response.data }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    }

    /**
     * Enable or disable reasoning mode for a specific chatId
     */
    async setReasoning(chatId, enabled) {
        try {
            const rootUrl = this.baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
            const url = `${rootUrl}/v1/reasoning`
            const headers = { 'Content-Type': 'application/json' }
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

            const response = await axios.post(url, {
                user: chatId,
                chat_id: chatId,
                reasoning: Boolean(enabled)
            }, { headers, timeout: 5000 })

            this.reasoningMap.set(chatId, Boolean(enabled))
            return { ok: true, data: response.data }
        } catch (err) {
            this.reasoningMap.set(chatId, Boolean(enabled))
            return { ok: true, localOnly: true, error: err.message }
        }
    }

    /**
     * Get reasoning mode status for specific chatId
     */
    async getReasoning(chatId) {
        try {
            const rootUrl = this.baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
            const url = `${rootUrl}/v1/reasoning?user=${encodeURIComponent(chatId)}`
            const headers = {}
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

            const response = await axios.get(url, { headers, timeout: 5000 })
            const isEnabled = response.data?.reasoning !== undefined ? Boolean(response.data.reasoning) : true
            this.reasoningMap.set(chatId, isEnabled)
            return { ok: true, reasoning: isEnabled }
        } catch (err) {
            const cached = this.reasoningMap.has(chatId) ? this.reasoningMap.get(chatId) : true
            return { ok: true, reasoning: cached, cached: true }
        }
    }

    /**
     * Check connection to Hermes Agent Gateway / Cloud API
     */
    async checkHealth() {
        try {
            const healthUrl = this.baseUrl.includes('hf.space')
                ? `${this.baseUrl.replace(/\/v1\/?$/, '')}/api/status`
                : `${this.baseUrl}/models`
            const headers = {}
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`
            }
            if (this.baseUrl.includes('openrouter')) {
                headers['HTTP-Referer'] = 'https://github.com/NousResearch/hermes-agent'
                headers['X-Title'] = 'WABOT2.0 Hermes Agent'
            }
            const response = await axios.get(healthUrl, { headers, timeout: 5000 })
            return { ok: true, data: response.data }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    }

    /**
     * Send chat prompt to Pure Hermes Agent / Nous Hermes Model
     * @param {string} chatId - WhatsApp JID / Chat ID (used as session/user identifier)
     * @param {string} promptText - User text prompt
     * @param {object} options - Additional options (e.g. systemPrompt, reasoning, media context)
     */
    async chat(chatId, promptText, options = {}) {
        if (!promptText || !promptText.trim()) {
            throw new Error('Prompt tidak boleh kosong.')
        }

        const headers = { 'Content-Type': 'application/json' }
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

        const url = `${this.baseUrl}/chat/completions`
        if (this.baseUrl.includes('openrouter')) {
            headers['HTTP-Referer'] = 'https://github.com/NousResearch/hermes-agent'
            headers['X-Title'] = 'WABOT2.0 Hermes Agent'
        }

        if (!options.introspectionPrompt) {
            try {
                const { botIntrospection } = await import('./botIntrospection.js')
                options.introspectionPrompt = await botIntrospection.getIntrospectionContextPrompt()
            } catch (_) {}
        }

        if (!options.introspectionPrompt) {
            try {
                const { botIntrospection } = await import('./botIntrospection.js')
                options.introspectionPrompt = await botIntrospection.getIntrospectionContextPrompt()
            } catch (_) {}
        }

        const systemPrompt = this.#buildSystemPrompt(options.systemPrompt, options)

        // Fetch multi-turn memory from memoryService if not provided
        let history = options.history
        if (!history && !chatId.startsWith('__')) {
            try {
                const { memoryService } = await import('./memory.js')
                history = memoryService.getHistory(chatId)
            } catch (_) {}
        }

        const messages = []
        messages.push({ role: 'system', content: systemPrompt })
        if (Array.isArray(history) && history.length > 0) {
            for (const h of history) {
                if (h.role === 'user' && h.content === promptText.trim()) continue
                messages.push({ role: h.role, content: h.content })
            }
        }
        messages.push({ role: 'user', content: promptText.trim() })

        let targetModel = this.model
        if (!targetModel || targetModel === 'hermes-agent' || targetModel === 'default') {
            targetModel = 'nousresearch/hermes-3-llama-3.1-70b'
        }

        const reasoningPref = options.reasoning !== undefined 
            ? Boolean(options.reasoning) 
            : (this.reasoningMap.has(chatId) ? this.reasoningMap.get(chatId) : undefined)

        const payload = {
            model: targetModel,
            messages,
            user: chatId,
            groq_api_key: process.env.GROQ_API_KEY || '',
            gemini_api_key: process.env.GEMINI_API_KEY || ''
        }

        if (reasoningPref !== undefined) {
            payload.reasoning = reasoningPref
        }

        // 1. Try remote Hermes Agent gateway if URL configured and not dead HF space
        const isDeadRemote = this.baseUrl.includes('ronnlbtrn-hermesbackend')
        if (this.baseUrl && !isDeadRemote) {
            try {
                const response = await axios.post(url, payload, { headers, timeout: 5000 })
                const choice = response.data?.choices?.[0]
                const text = choice?.message?.content || choice?.text || ''

                if (text && text.trim()) {
                    return { text: text.trim(), provider: 'hermes-agent', model: response.data?.model || this.model }
                }
            } catch (err) {
                logger.warn(`[HermesService] Remote Hermes gateway failed (${err.message}). Activating Native Hermes Multi-CPU Engine...`)
            }
        }

        // 2. Seamless Native Hermes Agent Multi-CPU Engine
        return await this.#runNativeHermesAgent(chatId, promptText, options, messages, systemPrompt)
    }

    #buildSystemPrompt(customPrompt = null, options = {}) {
        if (customPrompt) return customPrompt

        const now = new Date()
        const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' })
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

        const ownerName = options.ownerName || 'Rony Imanuel Sihombing'
        const ownerNumber = options.ownerNumber || '6285172013920'
        const isSenderOwner = Boolean(options.isOwner)
        const isGroup = Boolean(options.isGroup)
        const groupName = options.groupName ? `"${options.groupName}"` : (isGroup ? 'WhatsApp Group Chat' : 'Direct Message (DM)')
        const senderName = options.senderName || (isSenderOwner ? 'Bang Rony (Owner)' : 'User')
        const senderJid = options.senderJid || 'Unknown'

        let identitySection = `
# USER CONTEXT & CALLER IDENTITY:
- Active Conversation: ${isGroup ? `Group Chat: ${groupName}` : 'Private Direct Message (DM)'}
- Current Sender: ${senderName} (${senderJid})
- Sender Relationship: ${isSenderOwner ? 'MASTER CREATOR & OWNER (Bang Rony)' : 'Regular User / Community Member'}
- Master Developer: ${ownerName} (Bang Rony), WhatsApp: @${ownerNumber}`

        if (isSenderOwner) {
            identitySection += `
- [CRITICAL RECOGNITION - CURRENT SENDER IS YOUR CREATOR & OWNER]:
  * The person talking to you RIGHT NOW is your architect, boss, and creator: Bang Rony (@${ownerNumber})!
  * You know him with 100% certainty. He is your developer and father of this codebase.
  * NEVER say "I don't know who you are", "I don't have access to your personal info", or any generic AI disclaimer!
  * Address him with loyalty, warmth, camaraderie, and respect as 'Bang Rony' or 'Bos'.
  * ${isGroup ? `Because this dialogue takes place in a WhatsApp Group, you MUST mention/tag his number @${ownerNumber} when replying or greeting him!` : 'Speak directly and informally to Bang Rony.'}
  * If he asks "who am I?", "kenal gua gak?", "gua siapa?", proudly recognize him as Bang Rony (@${ownerNumber}), your creator and owner!`
        } else {
            identitySection += `
- If users ask who built you, who owns RonnBot, or who Bang Rony is: proudly state that your developer and owner is Bang Rony Imanuel Sihombing ${isGroup ? `(@${ownerNumber}) and tag his number @${ownerNumber}!` : '(WhatsApp: 6285172013920).'}`
        }

        const introspectionSection = options.introspectionPrompt || ''
        if (!options.dynamicToolsPrompt) {
            try {
                options.dynamicToolsPrompt = generatePromptToolDefinitions({
                    role: isSenderOwner ? 'owner' : 'user'
                })
            } catch (_) {}
        }

        return `You are RonnBot Agent OS, an elite, highly knowledgeable, and autonomous WhatsApp AI assistant powered by Hermes Agent OS architecture.
You operate live inside a production Node.js environment powered by the Baileys Multi-Device WhatsApp engine, backed by a persistent SQLite database (main.db / message_store).

# CORE PHILOSOPHY & KNOWLEDGE PROFILE:
- Encyclopedic Intelligence: Deep domain mastery across computer science, software engineering, politics, world history, philosophy, current global affairs, science, and internet pop culture.
- Multilingual & Fluent Indonesian: While your system reasoning and tools protocol are structured in English, you communicate naturally and effortlessly in Indonesian. You fully understand informal Indonesian slang ('yg', 'bgt', 'klo', 'udh', 'gpp', 'bs', 'anjir', 'bjir', 'kocak', 'wkwk', 'kepo', dsb.), sarcasm, edgy humor, and memes.
- BOLD, CANDID, OBJECTIVE & UNFILTERED: You NEVER give sterile corporate PR apologies, canned disclaimers, or preachy lectures like "As an AI language model I must remain neutral" or "I cannot provide an opinion". You dissect complex, controversial topics (politics, geopolitics, economic systems, capitalism vs communism, societal critique) with rigorous nuance, historical facts, and razor-sharp objectivity.
- ZERO CANNED EXCUSES: You NEVER falsely claim you lack access to systems, chats, or tools when an autonomous skill or SQLite database exists to perform the task.
${identitySection}
${introspectionSection}

# AUTONOMOUS TOOL EXECUTION (HERMES AGENT PROTOCOL):
You possess an arsenal of real-time modular skills. If the user's inquiry or command requires executing one of the tools below, YOU MUST NOT explain how to do it or hallucinate that you cannot perform it.
Instead, YOUR RESPONSE MUST BE SOLELY A VALID RAW JSON OBJECT with NO conversational text, markdown formatting, or introductory greetings:
{
  "executeCommand": true,
  "command": "tool_name",
  "args": ["arg1", "arg2", ...]
}

### 🛠️ ACTIVE AGENT CAPABILITIES & LIVE ARSENAL:
${options.dynamicToolsPrompt || ''}

- CRITICAL SYSTEM RULE ON 'rangkum' (SUMMARIZATION):
  * RonnBot HAS DIRECT SYSTEM ACCESS to live group message history stored in SQLite (message_store)!
  * NEVER apologize, NEVER claim you cannot read group chats, and NEVER tell the user to copy-paste the chat.
  * If the user asks to summarize any group (e.g. "coba ringkas 100 percakapan terakhir di grup learning C.St"), IMMEDIATELY emit:
    {"executeCommand": true, "command": "rangkum", "args": ["100", "learning C.St"]}

- CRITICAL SYSTEM RULE ON 'groups' (GROUP INTROSPECTION & PARTICIPATION):
  * RonnBot KNOWS EVERY GROUP it has joined via live Baileys connection!
  * If the user asks how many groups or which groups you are in (e.g. "ada berapa grup yang lu join saat ini", "sebutkan grup apa aja", "list grup"):
    IMMEDIATELY emit:
    {"executeCommand": true, "command": "groups", "args": []}

- CRITICAL SYSTEM RULE ON 'cook' (DYNAMIC SKILLS & AUTONOMOUS CODING):
  * You possess self-programming capability: your internal Chef engine can cook and save custom JavaScript ES skills on-the-fly!
  * If the user asks you to create, code, or perform a specialized task/query regarding bot internals or custom functions not in your tool list, NEVER say "I cannot do that".
  * Instead, emit:
    {"executeCommand": true, "command": "cook", "args": ["<instruction or query>"]}

# OPERATIONAL RULES:
- When user intent clearly matches a skill above: OUTPUT ONLY THE EXACT JSON OBJECT.
- For open-ended questions, programming problems, discussions, advice, or banter: Answer directly, conversationally, and insightfully as RonnBot.

🕒 Live System Clock & Date (WIB / Asia/Jakarta):
- Current Date: ${dateStr}
- Current Time: ${timeStr} WIB`
    }

    async #runNativeHermesAgent(chatId, promptText, options = {}, messages = [], systemPrompt = null) {
        logger.info(`[HermesService] Running Native Hermes Multi-CPU Engine for ${chatId}...`)

        const activeSystemPrompt = systemPrompt || this.#buildSystemPrompt(options.systemPrompt, options)
        if (!messages || messages.length === 0) {
            messages = [
                { role: 'system', content: activeSystemPrompt },
                { role: 'user', content: promptText }
            ]
        }

        // CPU Core 1: Groq Cloud (Ultra-fast Llama 3.3 / GPT-OSS / Qwen)
        const groqKey = process.env.GROQ_API_KEY
        if (groqKey) {
            const groqModels = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']
            for (const grqModel of groqModels) {
                try {
                    const { default: Groq } = await import('groq-sdk')
                    const groqClient = new Groq({ apiKey: groqKey })
                    const res = await groqClient.chat.completions.create({
                        model: grqModel,
                        messages,
                        temperature: 0.7,
                        max_tokens: 4096
                    })
                    const text = res.choices[0]?.message?.content?.trim()
                    if (text) return { text, provider: `hermes-agent (Groq ${grqModel})`, model: grqModel }
                } catch (e) {
                    logger.warn(`[HermesService] Groq ${grqModel} call failed: ${e.message}`)
                }
            }
        }

        // CPU Core 2: OpenRouter (Nous Hermes 3 70B)
        const openrouterKey = process.env.OPENROUTER_API_KEY
        if (openrouterKey) {
            try {
                const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: 'nousresearch/hermes-3-llama-3.1-70b',
                    messages,
                    temperature: 0.7,
                    max_tokens: 4096
                }, {
                    headers: {
                        'Authorization': `Bearer ${openrouterKey}`,
                        'HTTP-Referer': 'https://github.com/NousResearch/hermes-agent',
                        'X-Title': 'WABOT2.0 Hermes Agent'
                    },
                    timeout: 45000
                })
                const text = res.data?.choices?.[0]?.message?.content?.trim()
                if (text) return { text, provider: 'hermes-agent (OpenRouter Hermes-3-70B)', model: 'hermes-3-llama-3.1-70b' }
            } catch (e) {
                logger.warn(`[HermesService] OpenRouter Hermes-3 call failed: ${e.message}`)
            }
        }

        // CPU Core 3: NVIDIA NIM (Nemotron 70B / Llama 3.3 / DeepSeek V4)
        const nvidiaKey = process.env.NVIDIA_API_KEY
        if (nvidiaKey) {
            const nvidiaModels = ['nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-v4.1-flash']
            for (const nvModel of nvidiaModels) {
                try {
                    const { default: OpenAI } = await import('openai')
                    const nvidia = new OpenAI({
                        apiKey: nvidiaKey,
                        baseURL: 'https://integrate.api.nvidia.com/v1'
                    })
                    const res = await nvidia.chat.completions.create({
                        model: nvModel,
                        messages,
                        temperature: 0.7,
                        max_tokens: 4096
                    })
                    const text = res.choices?.[0]?.message?.content?.trim()
                    if (text) return { text, provider: `hermes-agent (NVIDIA ${nvModel})`, model: nvModel }
                } catch (e) {
                    logger.warn(`[HermesService] NVIDIA ${nvModel} call failed: ${e.message}`)
                }
            }
        }

        // CPU Core 4: DeepSeek API (deepseek-chat)
        const deepseekKey = process.env.DEEPSEEK_API_KEY
        if (deepseekKey) {
            try {
                const { default: OpenAI } = await import('openai')
                const deepseek = new OpenAI({
                    apiKey: deepseekKey,
                    baseURL: 'https://api.deepseek.com'
                })
                const res = await deepseek.chat.completions.create({
                    model: 'deepseek-chat',
                    messages,
                    temperature: 0.7,
                    max_tokens: 4096
                })
                const text = res.choices?.[0]?.message?.content?.trim()
                if (text) return { text, provider: 'hermes-agent (DeepSeek)', model: 'deepseek-chat' }
            } catch (e) {
                logger.warn(`[HermesService] DeepSeek API call failed: ${e.message}`)
            }
        }

        // CPU Core 5: OpenAI (GPT-4o-mini / GPT-4o)
        const openaiKey = process.env.OPENAI_API_KEY
        if (openaiKey) {
            try {
                const { default: OpenAI } = await import('openai')
                const openai = new OpenAI({ apiKey: openaiKey })
                const res = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages,
                    temperature: 0.7,
                    max_tokens: 4096
                })
                const text = res.choices[0]?.message?.content?.trim()
                if (text) return { text, provider: 'hermes-agent (OpenAI GPT-4o-mini)', model: 'gpt-4o-mini' }
            } catch (e) {
                logger.warn(`[HermesService] OpenAI call failed: ${e.message}`)
            }
        }

        throw new Error('Semua backend CPU Hermes Agent (Groq, OpenRouter, NVIDIA, DeepSeek, OpenAI) gagal merespon atau kuota habis.')
    }

    #formatGeminiHistory(rawMessages) {
        const formatted = []
        let lastRole = null
        for (const m of rawMessages) {
            if (m.role === 'system') continue
            const gRole = m.role === 'assistant' ? 'model' : 'user'
            if (gRole === lastRole) {
                formatted[formatted.length - 1].parts[0].text += `\n${m.content}`
            } else {
                formatted.push({
                    role: gRole,
                    parts: [{ text: m.content || '' }]
                })
                lastRole = gRole
            }
        }
        if (formatted.length > 0 && formatted[0].role !== 'user') {
            formatted.shift()
        }
        if (formatted.length > 0 && formatted[formatted.length - 1].role === 'user') {
            formatted.pop()
        }
        return formatted
    }

    /**
     * Send group chat transcript to Hermes Agent for uncensored summarization
     * @param {string} chatId - Group or chat identifier
     * @param {Array<string>} messages - Array of formatted chat strings
     */
    async summarize(chatId, messages, groupName = '') {
        if (!messages || messages.length === 0) {
            throw new Error('Daftar pesan tidak boleh kosong.')
        }

        const isDeadRemote = this.baseUrl.includes('ronnlbtrn-hermesbackend')
        if (this.baseUrl && !isDeadRemote) {
            const headers = { 'Content-Type': 'application/json' }
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

            const url = `${this.baseUrl}/summarize`
            try {
                const response = await axios.post(url, {
                    chat_id: chatId,
                    messages
                }, { headers, timeout: 180000 })

                if (response.data?.summary) {
                    return response.data.summary
                }
            } catch (_) {}
        }

        const formattedTranscript = messages.join('\n')
        const targetDesc = groupName ? `obrolan grup WhatsApp "${groupName}"` : 'obrolan grup WhatsApp'
        const prompt = `Tolong buat rangkuman lengkap, objektif, dan menarik dari transkrip percakapan ${targetDesc} berikut ini (${messages.length} pesan).

Transkrip Pesan:
\"\"\"
${formattedTranscript}
\"\"\"

Format Rangkuman:
1. 📌 *Topik & Isu Utama yang Dibahas*
2. 💡 *Keputusan / Agenda / Tugas / Deadline Penting* (jika ada)
3. 🔥 *Highlights / Drama / Humor Obrolan* (pertahankan bahasa santai dan slangnya)
4. 👥 *Partisipan Teraktif / Vibe Grup*

Pedoman: Pahami bahasa santai, slang Indonesia (yg, bgt, klo, udh, gpp, bs, anjir, bjir, kocak, wkwk, dll), sarkasme, dan kata-kata kotor/informal tanpa sensor moral.`

        const res = await this.chat(chatId, prompt)
        return res.text
    }

    /**
     * Compact summary for executive catch-up digest (per group)
     * @param {string} groupName - Group subject/name
     * @param {Array<string>} messages - Array of formatted messages
     */
    async summarizeGroupCompact(groupName, messages) {
        if (!messages || messages.length === 0) return 'Tidak ada percakapan baru.'
        if (messages.length <= 2) {
            return `• *Pesan Terkini:*\n${messages.map(m => `  ${m}`).join('\n')}`
        }

        const formattedTranscript = messages.join('\n')
        const prompt = `Kamu adalah Hermes Executive Assistant. Buat ringkasan padat, tajam, dan informatif (3-4 poin saja) dari percakapan grup WhatsApp "${groupName || 'Grup'}" (${messages.length} pesan) untuk Owner bot yang baru kembali online.

Transkrip:
"""
${formattedTranscript}
"""

Format WAJIB (dalam Bahasa Indonesia santai tapi lugas):
• *Topik Utama:* [Inti yang sedang dibahas / terjadi]
• *Penting / Agenda:* [Keputusan, janji, tugas, jadwal, atau pengumuman jika ada. Tulis "-" bila obrolan biasa]
• *Highlights:* [Kejadian seru, candaan, atau drama obrolan]
• *Paling Aktif:* [Sebutkan 1-3 nama pengirim yang mendominasi]

Pedoman: Pahami penuh slang Indonesia (yg, bgt, klo, udh, anjir, bjir, wkwk, spill, gpp, dll) tanpa penolakan/sensor.`

        const res = await this.chat(`catchup_${groupName}`, prompt)
        return res.text
    }
}

export const hermesService = new HermesService()
