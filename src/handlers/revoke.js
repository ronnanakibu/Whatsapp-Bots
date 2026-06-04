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

// Cache untuk mencegah eksekusi ganda yang bisa bikin Baileys crash (USync concurrency bug)
const processedRevokes = new Set()

async function processRevokedKey(sock, key) {
    try {
        if (processedRevokes.has(key.id)) return // Cegah eksekusi ganda
        processedRevokes.add(key.id)
        setTimeout(() => processedRevokes.delete(key.id), 60000) // Hapus dari cache setelah 1 menit

        if (key.fromMe) return // Ignore if bot deletes its own message

        const originalMsg = await store.loadMessage(key.remoteJid, key.id)
        if (!originalMsg) {
            botLogger.warn('revoke', `Message ${key.id} revoked but not found in store.`)
            return
        }

        const isGroup = key.remoteJid.endsWith('@g.us')
        const sender = isGroup ? (originalMsg.key.participant || key.remoteJid) : key.remoteJid
        const pushName = originalMsg.pushName || sender.split('@')[0]
        const isLid = sender.endsWith('@lid')

        botLogger.info('revoke', `Caught deleted message from ${sender}`)

        let captionText = `🕵️‍♂️ *PEMBOHONK* 🕵️‍♂️\n\nTerciduk kau hapus pesan, ${isLid ? `*${pushName}*` : `@${sender.split('@')[0]}`}! 😏\n\n`

        const ownerNumbers = (process.env.OWNER_NUMBER || '').split(',').map(n => n.trim())
        const devNumber = ownerNumbers[0]
        const devJid = devNumber + '@s.whatsapp.net'
        const allowedJids = ownerNumbers.map(n => n.includes('@') ? n : n + '@s.whatsapp.net')

        const validMentions = isLid ? undefined : [sender]

        // Handle text message
        if (originalMsg.message?.conversation || originalMsg.message?.extendedTextMessage) {
            const body = originalMsg.message.conversation || originalMsg.message.extendedTextMessage.text
            captionText += `Pesan: "${body}"`

            const promptText = `[ANTI-SNITCH]\nPesan dihapus oleh *${pushName}* di ${isGroup ? 'Grup' : 'Private'}.\n\nIsi: "${body}"\n\nBalas pesan ini dengan *1* (Kirim ke grup asal) atau *0* (Abaikan demi privasi).`
            const promptOptions = { text: promptText }
            const promptMsg = await sock.sendMessage(devJid, promptOptions)

            interactiveService.createSession(promptMsg.key.id, allowedJids, allowedJids, async (ctx, answer) => {
                if (answer === '1') {
                    const sendOptions = { text: captionText }
                    if (validMentions) sendOptions.mentions = validMentions
                    await sock.sendMessage(key.remoteJid, sendOptions)
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
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }

                let promptMsg;
                const promptText = `[ANTI-SNITCH]\nMedia dihapus oleh *${pushName}* di ${isGroup ? 'Grup' : 'Private'}.\n\nBalas pesan ini dengan *1* (Kirim ke grup asal) atau *0* (Abaikan demi privasi).`

                if (messageType === 'stickerMessage' || messageType === 'audioMessage') {
                    // Send media first, then prompt text
                    if (messageType === 'stickerMessage') {
                        await sock.sendMessage(devJid, { sticker: buffer })
                    } else {
                        await sock.sendMessage(devJid, { audio: buffer, mimetype: mediaContent.mimetype, ptt: mediaContent.ptt })
                    }
                    const pOpts = { text: promptText }
                    promptMsg = await sock.sendMessage(devJid, pOpts)
                } else {
                    // Send media attached with prompt text
                    const mOpts = {
                        [messageType.replace('Message', '')]: buffer,
                        caption: promptText,
                        mimetype: mediaContent.mimetype
                    }
                    promptMsg = await sock.sendMessage(devJid, mOpts)
                }

                interactiveService.createSession(promptMsg.key.id, allowedJids, allowedJids, async (ctx, answer) => {
                    if (answer === '1') {
                        if (messageType === 'stickerMessage') {
                            const sOpts = { text: captionText }
                            if (validMentions) sOpts.mentions = validMentions
                            await sock.sendMessage(key.remoteJid, sOpts)
                            await sock.sendMessage(key.remoteJid, { sticker: buffer })
                        } else if (messageType === 'audioMessage') {
                            const sOpts = { text: captionText }
                            if (validMentions) sOpts.mentions = validMentions
                            await sock.sendMessage(key.remoteJid, sOpts)
                            await sock.sendMessage(key.remoteJid, { audio: buffer, mimetype: mediaContent.mimetype, ptt: mediaContent.ptt })
                        } else {
                            const sOpts = {
                                [messageType.replace('Message', '')]: buffer,
                                caption: captionText,
                                mimetype: mediaContent.mimetype
                            }
                            if (validMentions) sOpts.mentions = validMentions
                            await sock.sendMessage(key.remoteJid, sOpts)
                        }
                        await ctx.reply('✅ Media diteruskan ke chat asal.')
                    } else if (answer === '0') {
                        await ctx.reply('🔒 Diabaikan. Privasi terjaga.')
                    }
                })
            } catch (err) {
                botLogger.err('revoke', err, 'Failed to download deleted media')
                const eOpts = { text: `[ANTI-SNITCH]\nGagal mengunduh media yang dihapus oleh @${sender.split('@')[0]}.` }
                if (validMentions) eOpts.mentions = validMentions
                await sock.sendMessage(devJid, eOpts)
            }
        }
    } catch (err) {
        botLogger.err('revoke', err, 'processRevokedKey error')
    }
}
