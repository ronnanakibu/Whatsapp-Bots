// src/utils/message.js

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
 */
export function getCleanQuoted(msg) {
    if (!msg) return null
    return {
        key: msg.key,
        message: unwrapMessage(msg.message)
    }
}
