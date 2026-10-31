import { commands } from '../core/loader.js'
import { botLogger } from './logger.js'
import { aiService } from '../services/ai.js'
import { isOwner } from './permissions.js'

// ─────────────────────────────────────────────
// KEYWORD PRE-ROUTER
// Deteksi intent dari teks user SEBELUM hasil AI diproses.
// Lebih reliable karena tidak bergantung pada AI mengikuti instruksi JSON.
// ─────────────────────────────────────────────

const COMMAND_PATTERNS = [
    {
        command: 'sticker',
        // Trigger jika ada kata stiker DAN ada media (gambar/video) — dicek di konteks
        requiresMedia: true,
        patterns: [
            /\b(stiker|sticker|jadiin\s+stiker|bikin\s+stiker|buatin\s+stiker|buat\s+stiker|make\s+sticker|create\s+sticker|convert\s+(to\s+)?sticker)\b/i,
        ],
        // Ekstrak args dari teks: ambil teks setelah kata kunci "dengan teks", "teks:", dll
        extractArgs: (text) => {
            const match = text.match(/(?:dengan\s+teks|teks\s*[:=]|caption\s*[:=]|text\s*[:=])\s*(.+)/i)
            if (match) {
                return match[1].trim().split(/\s*\|\s*/)
            }
            // Cek jika ada pattern "KATA BESAR | KATA BESAR"
            const memeMatch = text.match(/["']?([A-Z][^|"']+)\s*\|\s*([^"']+)["']?/)
            if (memeMatch) return [memeMatch[1].trim(), '|', memeMatch[2].trim()]
            return []
        }
    },
    {
        command: 'anomali',
        requiresMedia: false,
        patterns: [
            /\b(anomali|brat\s+stiker|quote\s+stiker|stiker\s+teks|bikin\s+brat|buatin\s+brat)\b/i,
        ],
        extractArgs: (text) => {
            const cleaned = text.replace(/\b(anomali|brat|quote|stiker|buatin|bikin)\b/gi, '').trim()
            return cleaned ? [cleaned] : []
        }
    },
    {
        command: 'cuaca',
        requiresMedia: false,
        patterns: [
            /\b(aqi|air\s*quality|kualitas\s*udara|polusi|cuaca|weather|prakiraan\s+cuaca|cek\s+cuaca|info\s+cuaca|temperature|suhu)\b/i,
        ],
        extractArgs: (text) => {
            const cleaned = text
                .replace(/\b(live\s*update|live|update|cek\s+cuaca|cek|info|prakiraan\s+cuaca|prakiraan|cuaca|weather|aqi|air\s*quality|kualitas\s*udara|polusi|suhu|temperature|hari\s*ini|sekarang|gimana|bagaimana|di|kota|wilayah|kabupaten)\b/gi, '')
                .replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
            return cleaned ? [cleaned] : ['Jakarta']
        }
    },
    {
        command: 'dl',
        requiresMedia: false,
        patterns: [
            /(https?:\/\/(www\.)?(instagram\.com|tiktok\.com|youtu\.be|youtube\.com|fb\.watch|facebook\.com|x\.com|twitter\.com)\/\S+)/i,
            /\b(download|unduh|dl)\s+.*(instagram|tiktok|youtube|facebook|reels|video|twitter|x)\b/i,
        ],
        extractArgs: (text) => {
            const urlMatch = text.match(/(https?:\/\/\S+)/i)
            return urlMatch ? [urlMatch[1]] : []
        }
    },
    {
        command: 'buat',
        requiresMedia: false,
        patterns: [
            /\b(generate\s+gambar|buat\s+gambar|bikin\s+gambar|buatin\s+gambar|generate\s+image|create\s+image|image\s+generation)\b/i,
        ],
        extractArgs: (text) => {
            const cleaned = text.replace(/\b(generate|buat|bikin|buatin|gambar|image|create)\b/gi, '').trim()
            return cleaned ? [cleaned] : []
        }
    },
    {
        command: 'cekhoax',
        requiresMedia: false,
        patterns: [
            /\b(cek\s+hoax|hoax\s+check|fakta\s+atau\s+hoax|fact\s+check|verifikasi|benar\s+gak|beneran\s+gak|klarifikasi)\b/i,
        ],
        extractArgs: (text) => {
            const cleaned = text.replace(/\b(cek|hoax|check|fakta|verifikasi|klarifikasi|benar|gak|beneran)\b/gi, '').trim()
            return cleaned ? [cleaned] : []
        }
    },
    {
        command: 'kalkulator',
        requiresMedia: false,
        patterns: [
            /^(hitung|kalkulator|calculate|math)\s*[:=]?\s*(.+)/i,
        ],
        extractArgs: (text) => {
            const match = text.match(/^(?:hitung|kalkulator|calculate|math)\s*[:=]?\s*(.+)/i)
            return match ? [match[1].trim()] : []
        }
    },
    {
        command: 'uptime',
        requiresMedia: false,
        patterns: [
            /^(uptime|bot\s+aktif|lama\s+aktif)$/i,
        ],
        extractArgs: () => []
    },
    {
        command: 'ping',
        requiresMedia: false,
        patterns: [
            /^(ping|speed\s+bot|kecepatan\s+bot)$/i,
        ],
        extractArgs: () => []
    },
]

/**
 * Coba deteksi command dari teks user secara langsung (keyword-based).
 * Returns { command, args } jika terdeteksi, atau null jika tidak ada match.
 * @param {string} userMessage
 * @param {object} ctx - Untuk mengecek apakah ada media/quoted media
 */
function detectCommandFromText(userMessage, ctx) {
    const { type, messageContent } = ctx
    const hasDirectMedia = type === 'imageMessage' || type === 'videoMessage' || type === 'stickerMessage'
    const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
    const quotedType = quotedMsg ? Object.keys(quotedMsg)[0] : null
    const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']
    const innerQuotedType = (wrappers.includes(quotedType) ? Object.keys(quotedMsg[quotedType]?.message ?? {})[0] : quotedType) ?? null
    const hasQuotedMedia = innerQuotedType === 'imageMessage' || innerQuotedType === 'videoMessage' || innerQuotedType === 'stickerMessage'
    const hasMedia = hasDirectMedia || hasQuotedMedia

    for (const rule of COMMAND_PATTERNS) {
        if (rule.requiresMedia && !hasMedia) continue
        const matched = rule.patterns.some(p => p.test(userMessage))
        if (matched) {
            const args = rule.extractArgs(userMessage)
            return { command: rule.command, args }
        }
    }
    return null
}

/**
 * Coba route command langsung dari pesan user tanpa membutuhkan AI response.
 * Returns true jika command berhasil dieksekusi, false jika tidak ada match.
 * @param {string} userMessage
 * @param {object} ctx
 */
export async function tryDirectRoute(userMessage, ctx) {
    if (!userMessage || typeof userMessage !== 'string') return false
    const detected = detectCommandFromText(userMessage, ctx)
    if (!detected) return false

    const command = commands.get(detected.command)
    if (!command) return false

    botLogger.info('agent', `[AIRouter] Direct routing to "${detected.command}" args: ${JSON.stringify(detected.args)}`)

    const newCtx = {
        ...ctx,
        args: detected.args,
        commandName: detected.command
    }

    try {
        await command.execute(newCtx)
        return true
    } catch (err) {
        botLogger.err('agent', err, `Direct route to "${detected.command}" failed`)
        return false
    }
}


/**
 * Easter Egg: Kenali identitas owner (Bang Rony) dan pembuat bot.
 * Jika di grup, wajib mention/tag nomor owner (@6285172013920) dengan formatting WhatsApp yang benar.
 */
export function checkEasterEgg(ctx, promptText = '') {
    if (!promptText || typeof promptText !== 'string') return null

    const raw = promptText.trim().toLowerCase()
    const clean = raw.replace(/[?!.,;:_`~*'"()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
    const sender = ctx.sender || ''
    const senderIsOwner = isOwner(sender) || ctx.msg?.key?.fromMe
    const isGroup = Boolean(ctx.isGroup)
    const ownerNumber = '6285172013920'
    const ownerTag = `@${ownerNumber}`
    const ownerJid = `${ownerNumber}@s.whatsapp.net`

    // 1. Query: "siapa aku", "kamu kenal aku", "gua siapa", "tau gua siapa", "who am i", etc.
    const WHO_AM_I_PATTERNS = [
        /\b(siapa\s*(aku|gw|gua|gue|saya))\b/i,
        /\b((kamu|lo|lu|bot)\s*kenal\s*(aku|gw|gua|gue|saya))\b/i,
        /\b(kenal\s*(aku|gw|gua|gue|saya)(\s*g[ak]+)?)\b/i,
        /\b((gua|gw|aku|gue|saya)\s*siapa)\b/i,
        /\b((lo|lu|kamu)\s*tau\s*(gua|gw|aku|gue|saya)\s*siapa)\b/i,
        /\b(tau\s*g[ak]+\s*(gua|gw|aku|gue|saya)\s*siapa)\b/i,
        /\b(who\s*am\s*i|do\s*you\s*know\s*me)\b/i
    ]

    const matchesWhoAmI = WHO_AM_I_PATTERNS.some(p => p.test(clean))
    if (matchesWhoAmI) {
        if (senderIsOwner) {
            const text = isGroup
                ? `Ya kenal lah Bang Rony ${ownerTag}! 😎🤙\n\nLu kan creator, developer, sekaligus owner & bos utama gua yang bikin RonnBot. Masa sama bapak sendiri gua lupa wkwk!`
                : `Ya kenal lah Bang Rony! 😎🤙\n\nLu kan creator, developer, sekaligus owner & bos utama gua yang bikin RonnBot. Masa sama bapak sendiri gua lupa wkwk!`
            return {
                text,
                mentions: isGroup ? [ownerJid] : []
            }
        } else {
            const name = ctx.pushName || 'kawan'
            const text = isGroup
                ? `Halo ${name}! Kamu salah satu member di grup ini. Kalau mau kenalan sama yang bikin bot ini, dia Bang Rony ${ownerTag} (Creator & Owner RonnBot) 😎`
                : `Halo ${name}! Aku RonnBot, asisten WhatsApp cerdas yang diciptakan oleh Bang Rony Imanuel Sihombing (${ownerNumber}) 🚀`
            return {
                text,
                mentions: isGroup ? [ownerJid] : []
            }
        }
    }

    // 2. Query: "siapa owner", "siapa pembuatmu", "siapa yang buat bot", "siapa rony", etc.
    const WHO_IS_CREATOR_PATTERNS = [
        /\b(siapa\s*(owner|creator|pembuat(mu|nya)?|pencipta(mu|nya)?|developer(mu)?|dev(mu)?|boss?))\b/i,
        /\b(siapa\s*yang\s*(bikin|buat|ciptakan)\s*(kamu|bot|lu))\b/i,
        /\b(bot\s*siapa|siapa\s*yang\s*punya\s*bot)\b/i,
        /\b(siapa\s*(bang\s*)?rony(\s*imanuel(\s*sihombing)?)?)\b/i,
        /\b(who\s*(made|created)\s*you|who\s*is\s*(the\s*)?(owner|creator))\b/i,
        /\b(kenal\s*(bang\s*)?rony(\s*g[ak]+)?|tau\s*(bang\s*)?rony(\s*g[ak]+)?)\b/i
    ]

    const matchesCreator = WHO_IS_CREATOR_PATTERNS.some(p => p.test(clean))
    if (matchesCreator) {
        const text = isGroup
            ? `RonnBot diciptakan dan dikembangkan oleh Bang Rony Imanuel Sihombing (${ownerTag}) sebagai asisten AI cerdas berbasis Hermes Agent OS! 🚀\n\nDia creator, developer, sekaligus owner utama bot ini.`
            : `RonnBot diciptakan dan dikembangkan oleh Bang Rony Imanuel Sihombing (${ownerNumber}) sebagai asisten AI cerdas berbasis Hermes Agent OS! 🚀\n\nDia creator, developer, sekaligus owner utama bot ini.`
        return {
            text,
            mentions: isGroup ? [ownerJid] : []
        }
    }

    return null
}

/**
 * Parses the AI response and determines whether to execute a command or reply with text.
 * @param {object} ctx - The message context.
 * @param {object} aiResponseResult - The result returned from aiService.chat.
 */
export async function processAiResponse(ctx, aiResponseResult) {
    const { reply } = ctx
    const text = aiResponseResult.text?.trim()

    if (!text) return false

    // Check if the response contains JSON
    if (text.includes('{') && text.includes('}')) {
        let cleanText = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/```\s*$/, '')
            .trim()

        try {
            const startIdx = cleanText.indexOf('{')
            const endIdx = cleanText.lastIndexOf('}')

            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const jsonStr = cleanText.substring(startIdx, endIdx + 1)
                const parsed = JSON.parse(jsonStr)

                if (parsed.executeCommand && parsed.command) {
                    const cmdName = parsed.command.toLowerCase()
                    const command = commands.get(cmdName)

                    if (command) {
                        botLogger.info('agent', `[AIRouter] Executing command "${cmdName}" args: ${JSON.stringify(parsed.args)}`)

                        let targetArgs = []
                        if (Array.isArray(parsed.args)) {
                            targetArgs = parsed.args.map(arg => String(arg))
                        } else if (parsed.args !== undefined && parsed.args !== null) {
                            targetArgs = [String(parsed.args)]
                        }

                        const newCtx = {
                            ...ctx,
                            args: targetArgs,
                            commandName: cmdName
                        }

                        await command.execute(newCtx)
                        return true
                    } else {
                        botLogger.warn('agent', `[AIRouter] Unknown command from AI: "${cmdName}"`)
                    }
                }
            }
        } catch (e) {
            botLogger.warn('agent', `[AIRouter] Failed to parse JSON: ${e.message}`)
        }
    }

    // Fallback: Reply as normal text with mention support
    const mentionMatches = text.match(/@(\d{8,16})\b/g)
    const mentionJids = []
    if (ctx.isGroup && mentionMatches) {
        for (const m of mentionMatches) {
            const num = m.replace('@', '')
            const jid = `${num}@s.whatsapp.net`
            if (!mentionJids.includes(jid)) {
                mentionJids.push(jid)
            }
        }
    }

    const sent = await reply(text, mentionJids.length ? { mentions: mentionJids } : {})
    if (sent?.key?.id) {
        const { seamlessTracker } = await import('../services/seamless.js')
        seamlessTracker.track(sent.key.id)
    }
    return false
}

export async function executeAiFlow(ctx, promptText, forcedProvider = null) {
    const { chatId, msg, reply, react, downloadMedia, type, messageContent, sock, from, isGroup } = ctx

    // 1. Detect image in direct or quoted message
    const directImage = msg.message?.imageMessage ?? null

    const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
    const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']
    let quotedInner = quotedMsg
    if (quotedMsg) {
        const qType = Object.keys(quotedMsg)[0]
        if (WRAPPERS.includes(qType)) {
            quotedInner = quotedMsg[qType]?.message ?? quotedMsg
        }
    }
    const quotedImage = quotedInner?.imageMessage ?? null

    const hasDirectImage = !!directImage
    const hasQuotedImage = !!quotedImage

    if (hasDirectImage || hasQuotedImage) {
        await react('👁️')
        try {
            const targetMsg = hasDirectImage ? msg : { message: quotedInner, key: msg.key }
            const buffer = await downloadMedia(targetMsg)
            if (!buffer) {
                throw new Error('Gagal download gambar untuk analisa vision.')
            }

            const cleanPrompt = promptText?.trim() || 'Deskripsikan gambar ini secara detail dan lengkap. Sebutkan semua yang kamu lihat: objek, teks, warna, suasana, dll.'
            
            // Vision analysis using Gemini
            const startMs = Date.now()
            const result = await aiService.analyzeImage(buffer, 'image/jpeg', cleanPrompt)
            botLogger.ai(result.provider, result.model, chatId, Date.now() - startMs)

            // Save to memory so subsequent chat turns have context about this image
            if (!chatId.startsWith('__')) {
                const { memoryService } = await import('../services/memory.js')
                memoryService.addMessage(chatId, 'user', `[Melihat Gambar] ${cleanPrompt}`)
                memoryService.addMessage(chatId, 'assistant', result.text)
            }

            await reply(result.text)
            await react('✅')
            return true
        } catch (err) {
            await react('❌')
            botLogger.err('vision', err)
            await reply(`❌ Gagal menganalisa gambar: ${err.message}`)
            return false
        }
    }

    // 2. Immediate Easter Egg Check (Fast path: no reasoning timer, instant reply with WhatsApp tag)
    const easterEgg = checkEasterEgg(ctx, promptText)
    if (easterEgg) {
        await react('😎')
        const sent = await reply(easterEgg.text, easterEgg.mentions?.length ? { mentions: easterEgg.mentions } : {})
        if (sent?.key?.id) {
            const { seamlessTracker } = await import('../services/seamless.js')
            seamlessTracker.track(sent.key.id)
        }
        return true
    }

    // 3. Fast Intent Direct Router (Instant skill execution for AQI, cuaca, sticker, download, etc.)
    const isDirectRouted = await tryDirectRoute(promptText, ctx)
    if (isDirectRouted) {
        await react('✅')
        return true
    }

    // 3.5. Dynamic Skills Fast Match (Pustaka skrip otomatis yang pernah diracik Chef & disimpan)
    try {
        const { dynamicSkills } = await import('../services/dynamicSkills.js')
        const matchedSkill = dynamicSkills.findMatchingSkill(promptText)
        if (matchedSkill) {
            botLogger.system(`⚡ [AIRouter] Executing cached dynamic skill: "${matchedSkill.name}"`)
            const resultText = await dynamicSkills.executeSkill(matchedSkill, ctx)
            if (resultText && typeof resultText === 'string') {
                await reply(resultText)
                await react('⚡')
                return true
            }
        }
    } catch (err) {
        botLogger.warn('agent', `[DynamicSkills] Fast match error: ${err.message}`)
    }

    // Normal Text Chat with Live Searching & Reasoning Timer
    // Send initial live status message
    let placeholderMsg = null
    try {
        placeholderMsg = await reply(`🔍 *Searching & Reasoning...* (1s)`)
    } catch (_) {}

    let seconds = 1
    const timer = setInterval(async () => {
        seconds += 2
        if (placeholderMsg?.key) {
            try {
                const statusPhase = seconds < 4 
                    ? `🌐 *Searching Web & Harvesting Knowledge...* (${seconds}s)`
                    : `🧠 *Synthesizing & Reasoning with DeepSeek R1...* (${seconds}s)`
                    
                await sock.sendMessage(from, {
                    text: statusPhase,
                    edit: placeholderMsg.key
                })
            } catch (_) {}
        }
    }, 2000)

    const startMs = Date.now()
    try {
        const isSenderOwner = isOwner(ctx.sender) || ctx.msg?.key?.fromMe
        const aiOptions = {
            isOwner: isSenderOwner,
            isGroup: Boolean(isGroup),
            senderName: ctx.pushName,
            senderJid: ctx.sender,
            ownerNumber: '6285172013920',
            ownerName: process.env.OWNER_NAME || 'Rony Imanuel Sihombing'
        }

        const result = await aiService.chat(chatId, promptText, forcedProvider, aiOptions)
        clearInterval(timer)
        botLogger.ai(result.provider, result.model, chatId, Date.now() - startMs)

        const text = result.text?.trim()

        // 4. Autonomous Skill / Tool Calling from Hermes Agent Mastermind
        if (text && text.includes('{') && text.includes('executeCommand')) {
            if (placeholderMsg?.key) {
                try {
                    await sock.sendMessage(from, { delete: placeholderMsg.key })
                } catch (_) {}
            }
            const executed = await processAiResponse(ctx, result)
            if (executed) {
                await react('✅')
                return true
            }
        }

        if (text && placeholderMsg?.key) {
            // Extract mentions (e.g. @6285172013920)
            const mentionMatches = text.match(/@(\d{8,16})\b/g)
            const mentionJids = []
            if (isGroup && mentionMatches) {
                for (const m of mentionMatches) {
                    const num = m.replace('@', '')
                    const jid = `${num}@s.whatsapp.net`
                    if (!mentionJids.includes(jid)) {
                        mentionJids.push(jid)
                    }
                }
            }

            // In WhatsApp groups, if there are user mentions, editing a message does NOT highlight
            // the tag in blue and does NOT trigger notification.
            if (isGroup && mentionJids.length > 0) {
                try {
                    await sock.sendMessage(from, { delete: placeholderMsg.key })
                } catch (_) {}
                const sent = await reply(text, { mentions: mentionJids })
                if (sent?.key?.id) {
                    const { seamlessTracker } = await import('../services/seamless.js')
                    seamlessTracker.track(sent.key.id)
                }
            } else {
                await sock.sendMessage(from, {
                    text,
                    edit: placeholderMsg.key
                })
                if (placeholderMsg.key.id) {
                    const { seamlessTracker } = await import('../services/seamless.js')
                    seamlessTracker.track(placeholderMsg.key.id)
                }
            }
            await react('✅')
            return true
        } else {
            const executed = await processAiResponse(ctx, result)
            if (!executed) await react('✅')
            return true
        }
    } catch (err) {
        clearInterval(timer)
        await react('❌')
        botLogger.err('aiChat', err)
        const errText = `Maaf, AI lagi error:\n${err.message}`
        if (placeholderMsg?.key) {
            try {
                await sock.sendMessage(from, { text: errText, edit: placeholderMsg.key })
            } catch (_) {
                await reply(errText)
            }
        } else {
            await reply(errText)
        }
        return false
    }
}

