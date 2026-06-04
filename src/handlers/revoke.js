import { store } from '../services/store.js'
import { botLogger } from '../utils/logger.js'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

/**
 * Handle messages.update to catch revoked messages
 */
export async function handleRevokeMessage(sock, updates) {
    for (const update of updates) {
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

import { interactiveService } from '../services/interactive.js'

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
        
        botLogger.info('revoke', `Caught deleted message from ${sender}`)

        let captionText = `🕵️‍♂️ *THE SNITCH* 🕵️‍♂️\n\nTerciduk kamu hapus pesan, @${sender.split('@')[0]}! 😏\n\n`
        const devJid = process.env.OWNER_NUMBER + '@s.whatsapp.net'
        
        // Handle text message
        if (originalMsg.message?.conversation || originalMsg.message?.extendedTextMessage) {
            const body = originalMsg.message.conversation || originalMsg.message.extendedTextMessage.text
            captionText += `Pesan: "${body}"`
            
            const promptText = `[ANTI-SNITCH]\nPesan dihapus oleh @${sender.split('@')[0]} di ${isGroup ? 'Grup' : 'Private'}.\n\nIsi: "${body}"\n\nBalas pesan ini dengan *1* (Kirim ke grup asal) atau *0* (Abaikan demi privasi).`
            const promptMsg = await sock.sendMessage(devJid, { text: promptText, mentions: [sender] })
            
            interactiveService.createSession(promptMsg.key.id, devJid, devJid, async (ctx, answer) => {
                if (answer === '1') {
                    await sock.sendMessage(key.remoteJid, { text: captionText, mentions: [sender] })
                    await ctx.reply('✅ Diteruskan ke chat asal.')
                } else if (answer === '0') {
                    await ctx.reply('🔒 Diabaikan. Privasi terjaga.')
                }
            })
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
                
                let promptMsg;
                const promptText = `[ANTI-SNITCH]\nMedia dihapus oleh @${sender.split('@')[0]} di ${isGroup ? 'Grup' : 'Private'}.\n\nBalas pesan ini dengan *1* (Kirim ke grup asal) atau *0* (Abaikan demi privasi).`

                if (messageType === 'stickerMessage' || messageType === 'audioMessage') {
                    // Send media first, then prompt text
                    if (messageType === 'stickerMessage') {
                        await sock.sendMessage(devJid, { sticker: buffer })
                    } else {
                        await sock.sendMessage(devJid, { audio: buffer, mimetype: mediaContent.mimetype, ptt: mediaContent.ptt })
                    }
                    promptMsg = await sock.sendMessage(devJid, { text: promptText, mentions: [sender] })
                } else {
                    // Send media attached with prompt text
                    promptMsg = await sock.sendMessage(devJid, { 
                        [messageType.replace('Message', '')]: buffer, 
                        caption: promptText, 
                        mentions: [sender],
                        mimetype: mediaContent.mimetype
                    })
                }

                interactiveService.createSession(promptMsg.key.id, devJid, devJid, async (ctx, answer) => {
                    if (answer === '1') {
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
                        await ctx.reply('✅ Media diteruskan ke chat asal.')
                    } else if (answer === '0') {
                        await ctx.reply('🔒 Diabaikan. Privasi terjaga.')
                    }
                })
            } catch (err) {
                botLogger.err('revoke', err, 'Failed to download deleted media')
                await sock.sendMessage(devJid, { text: `[ANTI-SNITCH]\nGagal mengunduh media yang dihapus oleh @${sender.split('@')[0]}.`, mentions: [sender] })
            }
        }
    } catch (err) {
        botLogger.err('revoke', err, 'processRevokedKey error')
    }
}
