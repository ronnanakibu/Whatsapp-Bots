/**
 * Converts standard Markdown formatting from LLMs into clean WhatsApp native formatting:
 * - Replaces Markdown bold `**text**` with WhatsApp bold `*text*`
 * - Replaces Markdown bold-italic `***text***` with WhatsApp bold-italic `*_text_*`
 * - Converts headers (`#`, `##`, `###`) into bold titles `*Title*`
 * - Cleanses redundant asterisks
 */
export function formatMarkdownForWhatsApp(text) {
    if (!text || typeof text !== 'string') return text

    // 1. Convert markdown headers: ### Title -> *Title*
    let formatted = text.replace(/^#{1,6}\s+([^\n]+)$/gm, '*$1*')

    // 2. Convert standard markdown bold **bold** -> *bold*
    // Using string splitting by '**' avoids regex nesting bugs across punctuation
    const boldParts = formatted.split('**')
    if (boldParts.length > 1) {
        formatted = boldParts.reduce((acc, part, idx) => {
            // Even indexes are normal text, odd indexes are bold text
            if (idx % 2 === 1) {
                // If the bold content itself already starts or ends with *, clean it
                const cleanPart = part.replace(/^\*+|\*+$/g, '').trim()
                return acc + (cleanPart ? `*${cleanPart}*` : '')
            }
            return acc + part
        }, '')
    }

    // 3. Clean any triple asterisks leftover (***text*** -> *_text_*)
    formatted = formatted.replace(/\*{3,}([^*]+?)\*{3,}/g, '*_$1_*')

    return formatted
}


/**
 * Recursively unwrap nested wrappers (ephemeral, view-once, documentWithCaption, etc.) from a message object.
 * Robustly ignores metadata keys such as messageContextInfo and deviceListMetadata.
 */
export function unwrapMessage(m) {
    if (!m || typeof m !== 'object') return null

    const wrappers = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage',
        'botInvokeMessage',
        'deviceSentMessage',
        'associatedChildMessage',
        'groupMentionedMessage'
    ]

    const ignoredKeys = new Set([
        'messageContextInfo',
        'senderKeyDistributionMessage',
        'deviceListMetadata',
        'deviceListMetadataVersion'
    ])

    const keys = Object.keys(m)
    
    // 1. Cek apakah ada key wrapper di dalam object m
    const wrapperKey = keys.find(k => wrappers.includes(k))
    if (wrapperKey) {
        const inner = m[wrapperKey]?.message || m[wrapperKey]
        return unwrapMessage(inner)
    }

    // 2. Jika tidak ada wrapper, cari content key yang bukan ignoredKeys
    const contentKey = keys.find(k => !ignoredKeys.has(k))
    if (contentKey) {
        return { [contentKey]: m[contentKey] }
    }

    return m
}



/**
 * Check if the original message contains any View-Once wrapper or viewOnce flag (deep recursive check)
 */
export function isViewOnceMessage(msg) {
    if (!msg) return false
    const raw = msg.message || msg
    if (!raw || typeof raw !== 'object') return false

    function checkNode(node, depth = 0) {
        if (!node || typeof node !== 'object' || depth > 8) return false

        for (const key of Object.keys(node)) {
            const lower = key.toLowerCase()
            if (lower === 'viewoncemessage' || lower === 'viewoncemessagev2' || lower === 'viewoncemessagev2extension') {
                return true
            }
            if (lower === 'viewonce' && Boolean(node[key])) {
                return true
            }
            if (node[key] && typeof node[key] === 'object') {
                if (checkNode(node[key], depth + 1)) return true
            }
        }
        return false
    }

    return checkNode(raw)
}



/**
 * Construct a clean and safe quoted message object for Baileys, ensuring that the target message structure
 * is recursively unwrapped to prevent silent message drops by WhatsApp servers.
 * Also cleanses participant LID format in groups to avoid server-side drop in LID addressing mode.
 */
export function getCleanQuoted(msg) {
    if (!msg?.key || !msg?.message) return null

    const key = { ...msg.key }
    // Di grup WhatsApp dengan mode LID, pastikan participant selalu terdefinisi
    if (key.remoteJid?.endsWith('@g.us') && !key.participant && msg.participant) {
        key.participant = msg.participant
    }

    return {
        key,
        message: unwrapMessage(msg.message)
    }
}
