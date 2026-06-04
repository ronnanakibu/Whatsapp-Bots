import { store } from '../services/store.js'
import { botLogger } from '../utils/logger.js'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

/**
 * Handle messages.update to catch revoked messages
 */
export async function handleRevokeMessage(sock, { messages }) {
    for (const update of messages) {
        // In some Baileys versions, revokes come as an update with message = null
        // or an update containing a protocolMessage
        if (update.update?.message?.protocolMessage?.type === 0 || update.update?.message === null) {
            await processRevokedKey(sock, update.key)
        }
    }
}

/**
 * Handle protocolMessage type 0 from messages.upsert
 */
export async function checkRevokeUpsert(sock, msg) {
    if (msg.message?.protocolMessage?.type === 0) {
        const targetKey = msg.message.protocolMessage.key
        await processRevokedKey(sock, targetKey)
    }
}

async function processRevokedKey(sock, key) {
    try {
        if (key.fromMe) return // Ignore if bot deletes its own message

        const originalMsg = await store.loadMessage(key.remoteJid, key.id)
        if (!originalMsg) {
            botLogger.warn('revoke', `Message ${key.id} revoked but not found in store.`)
            return
        }

        const isGroup = key.remoteJid.endsWith('@g.us')
        const sender = isGroup ? (originalMsg.key.participant || key.remoteJid) : key.remoteJid
        const pushName = originalMsg.pushName || (sender ? sender.split(':')[0].split('@')[0] : 'System')

        botLogger.info('revoke', `Caught deleted message from ${sender}`)

        let captionText = `🕵️‍♂️ *THE SNITCH* 🕵️‍♂️\n\nTerciduk kamu hapus pesan, @${sender.split('@')[0]}! 😏\n\n`
        
        // Handle text message
        if (originalMsg.message?.conversation || originalMsg.message?.extendedTextMessage) {
            const body = originalMsg.message.conversation || originalMsg.message.extendedTextMessage.text
            captionText += `Pesan: "${body}"`
            await sock.sendMessage(key.remoteJid, { text: captionText, mentions: [sender] })
            return
        }

        // Handle media message
        const messageType = Object.keys(originalMsg.message || {})[0]
        if (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'].includes(messageType)) {
            const mediaContent = originalMsg.message[messageType]
            const body = mediaContent.caption || ''
            if (body) captionText += `Caption: "${body}"`

            try {
                // Download from store message
                const stream = await downloadContentFromMessage(mediaContent, messageType.replace('Message', ''))
                let buffer = Buffer.from([])
                for await(const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }

                if (messageType === 'stickerMessage') {
                    await sock.sendMessage(key.remoteJid, { text: captionText, mentions: [sender] })
                    await sock.sendMessage(key.remoteJid, { sticker: buffer })
                } else if (messageType === 'audioMessage') {
                    await sock.sendMessage(key.remoteJid, { text: captionText, mentions: [sender] })
                    await sock.sendMessage(key.remoteJid, { audio: buffer, mimetype: mediaContent.mimetype, ptt: mediaContent.ptt })
                } else {
                    await sock.sendMessage(key.remoteJid, { 
                        [messageType.replace('Message', '')]: buffer, 
                        caption: captionText, 
                        mentions: [sender],
                        mimetype: mediaContent.mimetype
                    })
                }
            } catch (err) {
                botLogger.err('revoke', err, 'Failed to download deleted media')
                await sock.sendMessage(key.remoteJid, { text: `${captionText}\n*(Gagal memulihkan media)*`, mentions: [sender] })
            }
        }
    } catch (err) {
        botLogger.err('revoke', err, 'processRevokedKey error')
    }
}
