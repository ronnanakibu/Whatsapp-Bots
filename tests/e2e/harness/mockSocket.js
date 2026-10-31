/**
 * tests/e2e/harness/mockSocket.js
 * 
 * High-fidelity, 100% offline mock Baileys WASocket for WABOT2.0 E2E testing.
 * Intercepts all Baileys network operations (sendMessage, readMessages, group operations)
 * and records them in structured in-memory logs for deterministic assertions.
 */

import { EventEmitter } from 'events'

export class MockWASocket extends EventEmitter {
    constructor(options = {}) {
        super()
        this.options = options
        this.user = {
            id: options.botJid || '6281234567890:1@s.whatsapp.net',
            lid: options.botLid || '6281234567890@lid',
            name: options.botName || 'RonnBot'
        }
        
        // In-memory message logs
        this.sentMessages = []
        this.reactions = []
        this.readReceipts = []
        this.groupActions = []
        this.groupMetadataMap = new Map()

        // Setup default mock group if provided
        if (options.defaultGroup) {
            this.setGroupMetadata(options.defaultGroup.id, options.defaultGroup)
        }
    }

    /**
     * Mock sendMessage implementation
     * @param {string} jid - Remote JID
     * @param {object} content - Message payload ({ text, react, image, video, ... })
     * @param {object} options - Options ({ quoted, ... })
     */
    async sendMessage(jid, content, options = {}) {
        const messageId = 'MOCK_MSG_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        const timestamp = Math.floor(Date.now() / 1000)

        // Handle reaction
        if (content && content.react) {
            const reactionRecord = {
                id: messageId,
                jid,
                reaction: content.react.text,
                targetKey: content.react.key,
                timestamp
            }
            this.reactions.push(reactionRecord)
            this.emit('reaction.sent', reactionRecord)
            return {
                key: { id: messageId, remoteJid: jid, fromMe: true },
                message: content,
                messageTimestamp: timestamp
            }
        }

        // Handle standard message (text, media, buttons, etc.)
        const record = {
            id: messageId,
            jid,
            content,
            quoted: options.quoted || null,
            mentions: content.mentions || [],
            timestamp
        }
        this.sentMessages.push(record)
        this.emit('message.sent', record)

        return {
            key: { id: messageId, remoteJid: jid, fromMe: true },
            message: content,
            messageTimestamp: timestamp
        }
    }

    /**
     * Mock readMessages implementation (auto blue tick)
     */
    async readMessages(keys) {
        if (Array.isArray(keys)) {
            this.readReceipts.push(...keys)
        } else if (keys) {
            this.readReceipts.push(keys)
        }
        return true
    }

    /**
     * Mock groupMetadata lookup
     */
    async groupMetadata(jid) {
        if (this.groupMetadataMap.has(jid)) {
            return this.groupMetadataMap.get(jid)
        }
        // Default mock group metadata
        return {
            id: jid,
            subject: 'WABOT Test Group',
            creation: Math.floor(Date.now() / 1000) - 86400,
            owner: '6285172013920@s.whatsapp.net',
            desc: 'Official WABOT Test Environment',
            participants: [
                { id: this.user.id, admin: 'admin' },
                { id: '6285172013920@s.whatsapp.net', admin: 'superadmin' },
                { id: '628999999999@s.whatsapp.net', admin: null }
            ]
        }
    }

    /**
     * Configure mock group metadata for test cases
     */
    setGroupMetadata(jid, metadata) {
        this.groupMetadataMap.set(jid, metadata)
    }

    /**
     * Mock group participants updates (promote, demote, add, remove)
     */
    async groupParticipantsUpdate(jid, participants, action) {
        const record = { jid, participants, action, timestamp: Date.now() }
        this.groupActions.push(record)
        return participants.map(p => ({ status: '200', jid: p }))
    }

    /**
     * Mock group invite code
     */
    async groupInviteCode(jid) {
        return 'MOCK_INVITE_' + jid.split('@')[0]
    }

    /**
     * Mock groupFetchAllParticipating
     */
    async groupFetchAllParticipating() {
        const groups = {}
        for (const [jid, meta] of this.groupMetadataMap.entries()) {
            groups[jid] = meta
        }
        return groups
    }

    /**
     * Mock group update subject
     */
    async groupUpdateSubject(jid, subject) {
        if (this.groupMetadataMap.has(jid)) {
            const meta = this.groupMetadataMap.get(jid)
            meta.subject = subject
        }
        return true
    }

    // --- Query & Assertion Helpers ---

    getSentMessages(jid = null) {
        if (!jid) return [...this.sentMessages]
        return this.sentMessages.filter(m => m.jid === jid)
    }

    getLastMessage(jid = null) {
        const msgs = this.getSentMessages(jid)
        return msgs.length > 0 ? msgs[msgs.length - 1] : null
    }

    getReactions() {
        return [...this.reactions]
    }

    getLastReaction() {
        return this.reactions.length > 0 ? this.reactions[this.reactions.length - 1] : null
    }

    clear() {
        this.sentMessages = []
        this.reactions = []
        this.readReceipts = []
        this.groupActions = []
    }
}

export function createMockSocket(options = {}) {
    return new MockWASocket(options)
}
