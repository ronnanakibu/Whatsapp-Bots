import { logToChannel } from '../utils/channelLogger.js'
import { store } from '../services/store.js'
import { botLogger } from '../utils/logger.js'
import { interactiveService } from '../services/interactive.js'
import { mediaCache } from '../services/mediaCache.js'
import { unwrapMessage } from '../utils/message.js'
import { normalizeNumber } from '../utils/permissions.js'


// Cache untuk mencegah duplicate trigger revoke
const processedRevokes = new Set()

// Queue untuk menampung debounce batch revoke per chat & pengirim
// Key: `${senderJid}_${chatJid}` -> { items: [], timer: Timeout }
const batchQueues = new Map()
const BATCH_DEBOUNCE_MS = 2500

/**
 * Handle messages.update to catch revoked messages
 */
export async function handleRevokeMessage(sock, updates) {
    for (const update of updates) {
        if (update.update?.message?.protocolMessage?.type === 0 || update.update?.message === null) {
            await processRevokedKey(sock, update.key)
        }
    }
}

/**
 * Handle protocolMessage type 0 (revoke) and type 14 (edit) from messages.upsert
 */
export async function checkRevokeUpsert(sock, msg) {
    const protoType = msg.message?.protocolMessage?.type

    if (protoType === 0) {
        // Revoke (Delete)
        const targetKey = msg.message.protocolMessage.key
        await processRevokedKey(sock, targetKey)
    } else if (protoType === 14) {
        // Edit Message
        await handleEditMessage(sock, msg)
    }
}

/**
 * Process a single revoked key and push into batch queue
 */
async function processRevokedKey(sock, key) {
    try {
        if (!key?.id) return
        if (processedRevokes.has(key.id)) return
        processedRevokes.add(key.id)
        setTimeout(() => processedRevokes.delete(key.id), 60000)

        const originalMsg = await store.loadMessage(key.remoteJid, key.id)
        if (!originalMsg) {
            botLogger.warn('revoke', `Message ${key.id} revoked but not found in store.`)
            return
        }

        const isGroup = key.remoteJid.endsWith('@g.us')
        const sender = isGroup ? (originalMsg.key.participant || key.remoteJid) : key.remoteJid
        const botNumbers = new Set([
            normalizeNumber(sock.user?.id || ''),
            normalizeNumber(sock.user?.lid || ''),
            ...(process.env.BOT_NUMBER || '').split(',').map(normalizeNumber)
        ].filter(Boolean))

        const senderNorm = normalizeNumber(sender)

        // Abaikan jika pesan yang dihapus berasal dari bot sendiri
        if (key.fromMe || originalMsg.key.fromMe || botNumbers.has(senderNorm)) {
            botLogger.info('revoke', 'Ignored revoked message from self/bot.')
            return
        }

        const senderNumber = sender.split('@')[0].split(':')[0]
        const pushName = originalMsg.pushName || senderNumber
        const unwrapped = unwrapMessage(originalMsg.message)

        if (!unwrapped) return

        const mType = Object.keys(unwrapped)[0]
        const isViewOnce = Boolean(
            originalMsg._isViewOnce ||
            originalMsg.message?.viewOnceMessage ||
            originalMsg.message?.viewOnceMessageV2 ||
            originalMsg.message?.viewOnceMessageV2Extension
        )

        let body =
            unwrapped.conversation ||
            unwrapped.extendedTextMessage?.text ||
            unwrapped.imageMessage?.caption ||
            unwrapped.videoMessage?.caption ||
            unwrapped.documentMessage?.caption ||
            ''

        const isMedia = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(mType)
        let buffer = null
        let mime = unwrapped[mType]?.mimetype || ''

        if (isMedia) {
            buffer = await mediaCache.getMediaBuffer(sock, originalMsg)
        }

        const item = {
            key,
            originalMsg,
            sender,
            senderNumber,
            pushName,
            isGroup,
            chatJid: key.remoteJid,
            mType,
            body,
            buffer,
            mime,
            isViewOnce,
            ptt: Boolean(unwrapped.audioMessage?.ptt),
            deletedAt: Date.now()
        }

        enqueueRevokedItem(sock, item)
    } catch (err) {
        botLogger.err('revoke', err, 'processRevokedKey')
    }
}

/**
 * Enqueue item into debounce batch queue
 */
function enqueueRevokedItem(sock, item) {
    const queueKey = `${item.sender}_${item.chatJid}`

    if (batchQueues.has(queueKey)) {
        const batch = batchQueues.get(queueKey)
        clearTimeout(batch.timer)
        batch.items.push(item)
        batch.timer = setTimeout(() => dispatchBatchRevoke(sock, queueKey), BATCH_DEBOUNCE_MS)
    } else {
        const batch = {
            items: [item],
            timer: setTimeout(() => dispatchBatchRevoke(sock, queueKey), BATCH_DEBOUNCE_MS)
        }
        batchQueues.set(queueKey, batch)
    }
}

import fs from 'fs'

// Register type runner untuk sesi 'anti_snitch'
interactiveService.registerTypeRunner('anti_snitch', async (ctx, answer, payload) => {
    const { sock } = ctx
    const { items, chatJid, sender, senderNumber, pushName, isGroup, groupName, hasViewOnce } = payload

    if (interactiveService.isAffirmative(answer)) {
        const headline = `🕵️‍♂️ *[ANTI-DELETE]* 🕵️‍♂️\nAda yang hapus pesan nih: *@${senderNumber}* (*${pushName}*)${hasViewOnce ? '\n👁️ *[ASLINYA PESAN SEKALI LIHAT]*' : ''}\n━━━━━━━━━━━━━━━━━━━━`

        for (let i = 0; i < items.length; i++) {
            const it = items[i]
            const prefixHeader = i === 0 ? `${headline}\n\n` : ''

            try {
                let buffer = null
                if (it.mediaPath && fs.existsSync(it.mediaPath)) {
                    buffer = fs.readFileSync(it.mediaPath)
                }

                if (buffer) {
                    if (it.mType === 'imageMessage') {
                        await sock.sendMessage(chatJid, { image: buffer, caption: `${prefixHeader}${it.body || ''}`.trim(), mentions: [sender] })
                    } else if (it.mType === 'videoMessage' || it.mType === 'ptvMessage') {
                        await sock.sendMessage(chatJid, { video: buffer, caption: `${prefixHeader}${it.body || ''}`.trim(), mentions: [sender] })
                    } else if (it.mType === 'audioMessage') {
                        if (prefixHeader) await sock.sendMessage(chatJid, { text: prefixHeader, mentions: [sender] })
                        await sock.sendMessage(chatJid, { audio: buffer, mimetype: it.mime, ptt: it.ptt })
                    } else if (it.mType === 'stickerMessage') {
                        if (prefixHeader) await sock.sendMessage(chatJid, { text: prefixHeader, mentions: [sender] })
                        await sock.sendMessage(chatJid, { sticker: buffer })
                    } else if (it.mType === 'documentMessage') {
                        await sock.sendMessage(chatJid, { document: buffer, mimetype: it.mime, caption: `${prefixHeader}${it.body || ''}`.trim(), mentions: [sender] })
                    }
                } else if (it.body) {
                    await sock.sendMessage(chatJid, { text: `${prefixHeader}"${it.body}"`, mentions: [sender] })
                }
            } catch (err) {
                botLogger.err('revoke', err, `Failed to forward item ${i + 1}`)
            }
        }
        await ctx.reply(`✅ Berhasil meneruskan ${items.length} pesan terhapus ke ${isGroup ? groupName : 'chat asal'}.`)
    } else if (interactiveService.isNegative(answer)) {
        await ctx.reply('🔒 Pesan diabaikan. Seluruh media tetap tersimpan aman di arsip lokal bot.')
    }
})

/**
 * Dispatch bundled revoked messages to Owner
 */
async function dispatchBatchRevoke(sock, queueKey) {
    const batch = batchQueues.get(queueKey)
    batchQueues.delete(queueKey)
    if (!batch || batch.items.length === 0) return

    try {
        const items = batch.items
        const first = items[0]
        const { sender, senderNumber, pushName, isGroup, chatJid } = first

        // Ambil nama grup jika berasal dari grup
        let groupName = 'Grup'
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(chatJid).catch(() => null)
                if (groupMeta?.subject) groupName = groupMeta.subject
            } catch (_) {}
        }

        const ownerNumbers = (process.env.OWNER_NUMBER || '').split(',').map(n => n.trim())
        const devNumber = ownerNumbers[0].replace(/[^0-9]/g, '')
        const devJid = devNumber + '@s.whatsapp.net'
        const allowedJids = ownerNumbers.map(n => n.includes('@') ? n : n.replace(/[^0-9]/g, '') + '@s.whatsapp.net')

        const isMulti = items.length > 1
        const hasViewOnce = items.some(it => it.isViewOnce)

        botLogger.info('revoke', `Dispatching ${items.length} revoked item(s) from ${pushName} in ${groupName}`)

        // 1. Simpan media ke disk permanen dan kirim preview ke Owner
        for (const it of items) {
            if (it.buffer) {
                try {
                    const ext = mediaCache.getExtension(it.mType, it.mime)
                    const savedPath = await mediaCache.archiveRevokedMedia(it.key.id, it.buffer, ext)
                    it.mediaPath = savedPath

                    const tag = it.isViewOnce ? ' 👁️ [VIEW ONCE]' : ''
                    if (it.mType === 'imageMessage') {
                        await sock.sendMessage(devJid, { image: it.buffer, caption: `[PREVIEW FOTO${tag}]\n${it.body || ''}`.trim() })
                    } else if (it.mType === 'videoMessage' || it.mType === 'ptvMessage') {
                        await sock.sendMessage(devJid, { video: it.buffer, caption: `[PREVIEW VIDEO${tag}]\n${it.body || ''}`.trim() })
                    } else if (it.mType === 'audioMessage') {
                        await sock.sendMessage(devJid, { audio: it.buffer, mimetype: it.mime, ptt: it.ptt })
                    } else if (it.mType === 'stickerMessage') {
                        await sock.sendMessage(devJid, { sticker: it.buffer })
                    } else if (it.mType === 'documentMessage') {
                        await sock.sendMessage(devJid, { document: it.buffer, mimetype: it.mime, fileName: `revoked_${it.key.id}` })
                    }
                } catch (e) {
                    botLogger.warn('revoke', `Failed to send preview media: ${e.message}`)
                }
            }
        }

        // 2. Susun ringkasan prompt interaktif
        let promptText = `🕵️‍♂️ *[ANTI-SNITCH ${isMulti ? 'BATCH' : 'ALERT'}]*\n`
        promptText += `Pengirim: *${pushName}* (@${senderNumber})\n`
        promptText += `Lokasi: ${isGroup ? `Grup *${groupName}*` : 'Private Chat'}\n`
        promptText += `Total Pesan Dihapus: *${items.length} pesan*\n`
        if (hasViewOnce) promptText += `👁️ *Termasuk Pesan Sekali Lihat (View Once)*\n`
        promptText += `━━━━━━━━━━━━━━━━━━━━\n`

        items.forEach((it, idx) => {
            let desc = ''
            if (it.mType === 'conversation' || it.mType === 'extendedTextMessage') {
                desc = `"${it.body}"`
            } else if (it.mType === 'imageMessage') {
                desc = `[Foto] ${it.body ? `"${it.body}"` : ''}`
            } else if (it.mType === 'videoMessage' || it.mType === 'ptvMessage') {
                desc = `[Video${it.mType === 'ptvMessage' ? ' Note' : ''}] ${it.body ? `"${it.body}"` : ''}`
            } else if (it.mType === 'audioMessage') {
                desc = `[Audio / Voice Note]`
            } else if (it.mType === 'stickerMessage') {
                desc = `[Stiker]`
            } else {
                desc = `[Dokumen/File]`
            }
            promptText += `${items.length > 1 ? `${idx + 1}. ` : ''}${desc}\n`
        })

        promptText += `━━━━━━━━━━━━━━━━━━━━\n`
        promptText += `Balas pesan ini (tanpa batas waktu):\n`
        promptText += `👉 Ketik *1* / *ya* / *spill* (Kirim ke grup asal)\n`
        promptText += `👉 Ketik *0* / *ga* / *batal* (Abaikan demi privasi)`

        // Kirim Prompt
        const promptMsg = await sock.sendMessage(devJid, { text: promptText })

        // Log ke Channel
        await logToChannel(sock, { text: `[LOG ANTI-SNITCH]\nPengirim: ${pushName} (@${senderNumber})\nChat: ${isGroup ? groupName : 'Private'}\nTotal: ${items.length} pesan dihapus.` })

        // 3. Bersihkan buffer RAM dari items sebelum serialisasi ke database
        const serializableItems = items.map(it => ({
            key: it.key,
            sender: it.sender,
            senderNumber: it.senderNumber,
            pushName: it.pushName,
            isGroup: it.isGroup,
            chatJid: it.chatJid,
            mType: it.mType,
            body: it.body,
            mediaPath: it.mediaPath || null,
            mime: it.mime,
            isViewOnce: it.isViewOnce,
            ptt: it.ptt,
            deletedAt: it.deletedAt
        }))

        const payload = {
            items: serializableItems,
            chatJid,
            sender,
            senderNumber,
            pushName,
            isGroup,
            groupName,
            hasViewOnce
        }

        // Daftarkan sesi interaktif permanen di SQLite (ttlMs = null)
        interactiveService.createSession(promptMsg.key.id, devJid, allowedJids, 'anti_snitch', payload, null)

    } catch (err) {
        botLogger.err('revoke', err, 'dispatchBatchRevoke')
    }
}


/**
 * Handle WhatsApp Edit Message (protocolMessage.type === 14)
 */
async function handleEditMessage(sock, msg) {
    try {
        const proto = msg.message?.protocolMessage
        if (!proto || proto.type !== 14) return

        const targetKey = proto.key
        if (!targetKey?.id) return

        const isGroup = targetKey.remoteJid.endsWith('@g.us')
        const sender = isGroup ? (targetKey.participant || targetKey.remoteJid) : targetKey.remoteJid
        const botNumbers = new Set([
            normalizeNumber(sock.user?.id || ''),
            normalizeNumber(sock.user?.lid || ''),
            ...(process.env.BOT_NUMBER || '').split(',').map(normalizeNumber)
        ].filter(Boolean))

        const senderNorm = normalizeNumber(sender)

        // Abaikan jika pesan yang diedit berasal dari bot sendiri
        if (msg.key?.fromMe || targetKey.fromMe || botNumbers.has(senderNorm)) {
            botLogger.info('revoke', 'Ignored edited message from self/bot.')
            return
        }

        const editedProto = proto.editedMessage
        const newUnwrapped = unwrapMessage(editedProto)
        if (!newUnwrapped) return

        const newText = newUnwrapped.conversation || newUnwrapped.extendedTextMessage?.text || ''
        if (!newText) return

        // Ambil pesan versi sebelumnya dari SQLite store
        const oldMsg = await store.loadMessage(targetKey.remoteJid, targetKey.id)

        // Cek apakah pesan lama tercatat dari bot sendiri
        if (oldMsg?.key?.fromMe || botNumbers.has(normalizeNumber(oldMsg?.key?.participant || oldMsg?.key?.remoteJid || ''))) {
            botLogger.info('revoke', 'Ignored edited message from self/bot (oldMsg check).')
            return
        }

        const oldUnwrapped = oldMsg ? unwrapMessage(oldMsg.message) : null
        const oldText = oldUnwrapped ? (oldUnwrapped.conversation || oldUnwrapped.extendedTextMessage?.text || '') : '(Pesan lama tidak tersimpan)'

        // Jika teks tidak berubah, abaikan
        if (oldText === newText) return

        const senderNumber = sender.split('@')[0].split(':')[0]
        const pushName = msg.pushName || oldMsg?.pushName || senderNumber


        let groupName = 'Grup'
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(targetKey.remoteJid).catch(() => null)
                if (groupMeta?.subject) groupName = groupMeta.subject
            } catch (_) {}
        }

        const ownerNumbers = (process.env.OWNER_NUMBER || '').split(',').map(n => n.trim())
        const devNumber = ownerNumbers[0].replace(/[^0-9]/g, '')
        const devJid = devNumber + '@s.whatsapp.net'

        let editReport = `✏️ *[ANTI-EDIT DETECTED]*\n`
        editReport += `Pengirim: *${pushName}* (@${senderNumber})\n`
        editReport += `Chat: ${isGroup ? `Grup *${groupName}*` : 'Private Chat'}\n`
        editReport += `━━━━━━━━━━━━━━━━━━━━\n`
        editReport += `📜 *Pesan Sebelumnya:*\n"${oldText}"\n\n`
        editReport += `✨ *Pesan Baru (Hasil Edit):*\n"${newText}"\n`
        editReport += `━━━━━━━━━━━━━━━━━━━━`

        await sock.sendMessage(devJid, { text: editReport })
        await logToChannel(sock, { text: editReport })

        botLogger.info('revoke', `Anti-Edit caught edited message from ${pushName} in ${groupName}`)
    } catch (err) {
        botLogger.err('revoke', err, 'handleEditMessage')
    }
}
