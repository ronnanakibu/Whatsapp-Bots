/**
 * tests/e2e/harness/mockContext.js
 * 
 * Factory for creating high-fidelity mock MessageContext (`ctx`) objects
 * matching the exact structure produced by src/handlers/message.js.
 */

import { createMockSocket } from './mockSocket.js'

export const OWNER_NUMBER = '6285172013920'
export const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`
export const BOT_NUMBER = '6281234567890'
export const BOT_JID = `${BOT_NUMBER}:1@s.whatsapp.net`
export const TEST_GROUP_JID = '120363028374928192@g.us'
export const TEST_USER_JID = '6289988776655@s.whatsapp.net'

export function createMockContext(options = {}) {
    const role = options.role || 'user'
    let sender = options.sender
    if (!sender) {
        if (role === 'owner') sender = OWNER_JID
        else if (role === 'admin') sender = '6281122334455@s.whatsapp.net'
        else sender = TEST_USER_JID
    }

    const isGroup = options.isGroup ?? (options.from ? options.from.endsWith('@g.us') : false)
    const from = options.from || (isGroup ? TEST_GROUP_JID : sender)
    const pushName = options.pushName || (role === 'owner' ? 'Rony Imanuel' : 'Test Member')

    const sock = options.sock || createMockSocket({
        botJid: BOT_JID,
        botName: 'RonnBot'
    })

    // Setup group participants and bot admin status if group
    if (isGroup) {
        const botIsAdmin = options.botIsAdmin ?? true
        const senderIsAdmin = role === 'admin' || role === 'owner'

        sock.setGroupMetadata(from, {
            id: from,
            subject: options.groupSubject || 'WABOT Test Environment',
            creation: Math.floor(Date.now() / 1000) - 100000,
            owner: OWNER_JID,
            desc: 'Test Group for Automated E2E Verification',
            participants: [
                { id: BOT_JID, admin: botIsAdmin ? 'admin' : null },
                { id: OWNER_JID, admin: 'superadmin' },
                { id: sender, admin: senderIsAdmin ? 'admin' : null },
                { id: TEST_USER_JID, admin: null }
            ]
        })
    }

    const body = options.body || '.ping'
    const prefix = options.prefix || (body.startsWith('!') ? '!' : '.')
    const isCommand = body.startsWith(prefix)

    let commandName = options.commandName
    let args = options.args
    if (isCommand && !commandName) {
        const tokens = body.slice(prefix.length).trim().split(/ +/)
        commandName = tokens.shift().toLowerCase()
        if (!args) args = tokens
    } else if (!args) {
        args = []
    }

    const bodyWithoutMention = body.replace(/@\d+/g, '').replace(/\s+/g, ' ').trim()
    const msgId = 'TEST_STANZA_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)

    const rawMsg = options.rawMsg || {
        key: {
            remoteJid: from,
            fromMe: false,
            id: msgId,
            participant: isGroup ? sender : undefined
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName,
        message: {
            conversation: body
        }
    }

    const capturedReplies = []
    const capturedReactions = []
    const capturedMedia = []

    const reply = async (text, replyOptions = {}) => {
        capturedReplies.push(text)
        const sent = await sock.sendMessage(from, { text, ...replyOptions }, { quoted: rawMsg })
        return sent
    }

    const react = async (emoji) => {
        capturedReactions.push(emoji)
        await sock.sendMessage(from, { react: { text: emoji, key: rawMsg.key } })
    }

    const downloadMedia = async (targetMsg = rawMsg) => {
        return Buffer.from('mock_media_binary_data')
    }

    const replyMedia = async (content, mediaType, mediaOptions = {}) => {
        capturedMedia.push({ content, mediaType, mediaOptions })
        return sock.sendMessage(from, { [mediaType]: content, ...mediaOptions }, { quoted: rawMsg })
    }

    const ctx = {
        sock,
        msg: rawMsg,
        messageContent: rawMsg.message,
        from,
        chatId: from,
        sender,
        pushName,
        isGroup,
        isDM: !isGroup,
        body,
        bodyWithoutMention,
        type: 'conversation',
        quotedMsgId: options.quotedMsgId || null,
        isReplyToBot: options.isReplyToBot || false,
        isMentioned: options.isMentioned || false,
        isDMTrigger: !isGroup && !isCommand && body.trim().length > 0,
        args,
        commandName: commandName || '',
        mentionedJids: options.mentionedJids || [],
        reply,
        react,
        downloadMedia,
        replyMedia,

        // Testing inspections
        capturedReplies,
        capturedReactions,
        capturedMedia,
        getOutputText: () => capturedReplies.join('\n\n')
    }

    return ctx
}
