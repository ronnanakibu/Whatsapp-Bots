import { commands } from '../core/loader.js'
import { botLogger } from './logger.js'

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
            /\b(cuaca|weather|prakiraan\s+cuaca|cek\s+cuaca|info\s+cuaca|temperature|suhu)\b/i,
        ],
        extractArgs: (text) => {
            const match = text.match(/(?:cuaca|weather|di|di\s+kota|kota)\s+([a-zA-Z\s]+?)(?:\s*[?,!.]|$)/i)
            return match ? [match[1].trim()] : []
        }
    },
    {
        command: 'dl',
        requiresMedia: false,
        patterns: [
            /(https?:\/\/(www\.)?(instagram\.com|tiktok\.com|youtu\.be|youtube\.com|fb\.watch|facebook\.com)\/\S+)/i,
            /\b(download|unduh|dl)\s+.*(instagram|tiktok|youtube|facebook|reels|video)\b/i,
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
    const detected = detectCommandFromText(userMessage, ctx)
    if (!detected) return false

    const command = commands.get(detected.command)
    if (!command) return false

    botLogger.info('agent', `[PreRouter] Direct route → "${detected.command}" args: ${JSON.stringify(detected.args)}`)

    const newCtx = {
        ...ctx,
        args: detected.args,
        commandName: detected.command
    }

    await command.execute(newCtx)
    return true
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

    // Fallback: Reply as normal text
    const sent = await reply(text)
    if (sent?.key?.id) {
        const { seamlessTracker } = await import('../services/seamless.js')
        seamlessTracker.track(sent.key.id)
    }
    return false
}
