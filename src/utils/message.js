// src/utils/message.js

/**
 * Recursively unwrap nested wrappers (ephemeral, view-once, documentWithCaption) from a message object.
 */
export function unwrapMessage(m) {
    if (!m) return null
    const wrappers = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage',
        'botInvokeMessage'
    ]
    const mType = Object.keys(m)[0]
    if (wrappers.includes(mType)) {
        return unwrapMessage(m[mType].message || m[mType])
    }
    return m
}

/**
 * Check if the original message contains any View-Once wrapper
 */
export function isViewOnceMessage(msg) {
    if (!msg?.message) return false
    const m = msg.message
    return Boolean(
        m.viewOnceMessage ||
        m.viewOnceMessageV2 ||
        m.viewOnceMessageV2Extension
    )
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
