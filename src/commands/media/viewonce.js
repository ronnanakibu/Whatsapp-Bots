// src/commands/media/viewonce.js
import fs from 'fs'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { mediaCache } from '../../services/mediaCache.js'
import { dbService } from '../../services/db.js'
import { unwrapMessage, getCleanQuoted } from '../../utils/message.js'
import { logger } from '../../utils/logger.js'

export default {
    name: 'viewonce',
    aliases: ['rvo', 'readvo', 'buka'],
    category: 'media',
    description: 'Bongkar dan lihat kembali pesan sekali lihat (View Once) dengan me-reply pesannya.',
    usage: 'Balas pesan sekali lihat dengan .viewonce',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { msg, messageContent, reply, react, sock, from, sender, pushName, isGroup } = ctx
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo
        const quotedMsg = contextInfo?.quotedMessage
        const quotedId = contextInfo?.stanzaId

        if (!quotedMsg && !quotedId) {
            return reply('⚠️ Balas (reply) pesan sekali lihat (View Once) yang ingin kamu bongkar dengan perintah *.viewonce*!')
        }

        await react('⏳')

        let buffer = null
        let mType = null
        let mime = ''
        let caption = ''

        // 1. Cek dari quoted message langsung
        const unwrapped = unwrapMessage(quotedMsg)
        if (unwrapped) {
            mType = Object.keys(unwrapped)[0]
            const content = unwrapped[mType]
            mime = content?.mimetype || ''
            caption = content?.caption || ''

            try {
                const reconstructed = {
                    key: {
                        remoteJid: from,
                        id: quotedId,
                        fromMe: false,
                        participant: contextInfo?.participant
                    },
                    message: unwrapped
                }
                buffer = await downloadMediaMessage(reconstructed, 'buffer', {}, {
                    logger: console,
                    reconnectCount: 3,
                    reuploadRequest: sock.updateMediaMessage
                })
            } catch (err) {
                logger.warn(`[ViewOnceCmd] Baileys download fallback: ${err.message}`)
            }
        }

        // 2. Cek dari mediaCache atau message_store database
        if (!buffer && quotedId) {
            try {
                const record = dbService.getMessage(from, quotedId) || dbService.getMessage(null, quotedId)
                if (record?.media_path && fs.existsSync(record.media_path)) {
                    buffer = await fs.promises.readFile(record.media_path)
                    mType = mType || record.message_type
                }
            } catch (_) {}

            if (!buffer) {
                buffer = await mediaCache.getMediaBuffer(sock, { key: { id: quotedId, remoteJid: from }, message: quotedMsg })
            }
        }

        if (!buffer || buffer.length === 0) {
            await react('❌')
            return reply('❌ Gagal mengunduh media sekali lihat. Kemungkinan media sudah kedaluwarsa dari server WhatsApp atau tidak tersimpan.')
        }

        const ext = mediaCache.getExtension(mType, mime)
        let groupName = null
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(from).catch(() => null)
                if (groupMeta?.subject) groupName = groupMeta.subject
            } catch (_) {}
        }

        // Arsipkan ke Telegram Cloud Vault secara realtime
        await mediaCache.archiveViewOnceMedia(quotedId || Date.now(), buffer, ext, {
            sender: contextInfo?.participant || sender,
            senderName: pushName,
            isGroup,
            groupName,
            from,
            caption,
            mType
        })

        // Kirimkan balik media tanpa proteksi sekali lihat
        const fullCaption = `👁️ *[VIEW ONCE REVEALED]*\n${caption ? `\n"${caption}"` : ''}`.trim()
        if (mType === 'imageMessage' || ext === 'jpg' || ext === 'png') {
            await sock.sendMessage(from, { image: buffer, caption: fullCaption }, { quoted: getCleanQuoted(msg) })
        } else if (mType === 'videoMessage' || mType === 'ptvMessage' || ext === 'mp4') {
            await sock.sendMessage(from, { video: buffer, caption: fullCaption }, { quoted: getCleanQuoted(msg) })
        } else if (mType === 'audioMessage' || ext === 'ogg' || ext === 'mp3') {
            await sock.sendMessage(from, { audio: buffer, mimetype: mime || 'audio/ogg; codecs=opus', ptt: true }, { quoted: getCleanQuoted(msg) })
        } else {
            await sock.sendMessage(from, { document: buffer, mimetype: mime || 'application/octet-stream', fileName: `viewonce_${quotedId || Date.now()}.${ext}`, caption: fullCaption }, { quoted: getCleanQuoted(msg) })
        }

        await react('✅')
    }
}
