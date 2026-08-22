// src/handlers/viewOnce.js
// Handler untuk menangkap pesan sekali lihat (View Once: Foto, Video, Voice Note / Audio)
// Mengirimkan preview + prompt interaktif ke Owner, dan menyimpan sesi permanen di SQLite

import fs from 'fs'
import path from 'path'
import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage, isViewOnceMessage } from '../utils/message.js'
import { normalizeNumber } from '../utils/permissions.js'
import { mediaCache } from '../services/mediaCache.js'
import { interactiveService } from '../services/interactive.js'
import { botLogger } from '../utils/logger.js'
import { logToChannel } from '../utils/channelLogger.js'


// Register type runner untuk sesi 'view_once'
interactiveService.registerTypeRunner('view_once', async (ctx, answer, payload) => {
    const { sock } = ctx
    const { chatJid, sender, senderNumber, pushName, isGroup, groupName, mType, mediaPath, caption, mime, ptt } = payload

    if (interactiveService.isAffirmative(answer)) {
        // Owner setuju meneruskan media sekali lihat ke chat/grup asal
        try {
            if (!mediaPath || !fs.existsSync(mediaPath)) {
                return await ctx.reply('❌ File media tidak ditemukan di penyimpanan lokal bot.')
            }

            const buffer = fs.readFileSync(mediaPath)
            const headline = `👁️ *[VIEW ONCE REVEALED]* 👁️\nPesan sekali lihat dari: *@${senderNumber}* (*${pushName}*)\n━━━━━━━━━━━━━━━━━━━━`
            const fullCaption = `${headline}${caption ? `\n\n"${caption}"` : ''}`

            if (mType === 'imageMessage') {
                await sock.sendMessage(chatJid, { image: buffer, caption: fullCaption, mentions: [sender] })
            } else if (mType === 'videoMessage' || mType === 'ptvMessage') {
                await sock.sendMessage(chatJid, { video: buffer, caption: fullCaption, mentions: [sender] })
            } else if (mType === 'audioMessage') {
                await sock.sendMessage(chatJid, { text: headline, mentions: [sender] })
                await sock.sendMessage(chatJid, { audio: buffer, mimetype: mime, ptt: ptt })
            }

            await ctx.reply(`✅ Berhasil meneruskan media sekali lihat ke ${isGroup ? groupName : 'chat asal'}.`)
            botLogger.info('viewonce', `Owner forwarded view-once media from ${pushName} to ${chatJid}`)
        } catch (err) {
            botLogger.err('viewonce', err, 'forwardViewOnce')
            await ctx.reply(`❌ Gagal meneruskan media: ${err.message}`)
        }
    } else if (interactiveService.isNegative(answer)) {
        // Owner memilih menyimpan saja / tidak meneruskan
        await ctx.reply('🔒 Media sekali lihat disimpan aman di arsip lokal bot.')
        botLogger.info('viewonce', `Owner kept view-once media in local archive for ${pushName}`)
    }
})

/**
 * Handle incoming View Once message (Foto, Video, Voice Note)
 */
export async function handleIncomingViewOnce(sock, msg) {
    try {
        if (!msg?.message) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith('@g.us')
        const sender = isGroup ? (msg.key.participant || from) : from
        const senderNumber = sender.split('@')[0].split(':')[0]
        const senderNorm = normalizeNumber(sender)

        const botNumbers = new Set([
            normalizeNumber(sock.user?.id || ''),
            normalizeNumber(sock.user?.lid || ''),
            ...(process.env.BOT_NUMBER || '').split(',').map(normalizeNumber)
        ].filter(Boolean))

        // Eksklusi HANYA jika pesan berasal dari nomor bot itu sendiri
        if (botNumbers.has(senderNorm) || (msg.key.fromMe && botNumbers.has(normalizeNumber(sock.user?.id || '')))) {
            return
        }

        if (!isViewOnceMessage(msg)) return

        const pushName = msg.pushName || senderNumber


        const unwrapped = unwrapMessage(msg.message)
        if (!unwrapped) return

        const mType = Object.keys(unwrapped)[0]
        const mediaTypes = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage']
        if (!mediaTypes.includes(mType)) return

        const mediaContent = unwrapped[mType]
        if (!mediaContent) return

        const msgId = msg.key.id
        const caption = mediaContent.caption || ''
        const mime = mediaContent.mimetype || ''
        const ptt = Boolean(mediaContent.ptt)

        botLogger.info('viewonce', `[INTERCEPT] Detected View-Once ${mType} from ${pushName} (@${senderNumber}) in ${from}`)

        // 1. Download buffer media dengan fallback multi-strategi
        let buffer = null
        try {
            buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: console, reconnectCount: 3, reuploadRequest: sock?.updateMediaMessage }
            )
        } catch (e1) {
            botLogger.debug?.('viewonce', `Raw msg download fallback: ${e1.message}`)
        }

        if (!buffer || buffer.length === 0) {
            try {
                buffer = await downloadMediaMessage(
                    { key: msg.key, message: unwrapped },
                    'buffer',
                    {},
                    { logger: console, reconnectCount: 3, reuploadRequest: sock?.updateMediaMessage }
                )
            } catch (e2) {
                botLogger.debug?.('viewonce', `Unwrapped msg download fallback: ${e2.message}`)
            }
        }

        if (!buffer || buffer.length === 0) {
            try {
                buffer = await mediaCache.getMediaBuffer(sock, msg)
            } catch (e3) {
                botLogger.debug?.('viewonce', `MediaCache fallback: ${e3.message}`)
            }
        }

        // 2. Arsipkan buffer ke storage/media/viewonce jika berhasil diunduh
        const ext = mediaCache.getExtension(mType, mime)
        let savedPath = null
        if (buffer && buffer.length > 0) {
            savedPath = await mediaCache.archiveViewOnceMedia(msgId, buffer, ext)
        }

        // 3. Siapkan tujuan Owner
        const ownerRaw = (process.env.OWNER_NUMBER || '').split(',').map(n => n.trim()).filter(Boolean)
        if (ownerRaw.length === 0) {
            botLogger.warn('viewonce', 'No OWNER_NUMBER configured in .env')
            return
        }

        const targetOwner = ownerRaw.find(n => !n.includes('@lid')) || ownerRaw[0]
        const devNumber = targetOwner.replace(/[^0-9]/g, '')
        if (!devNumber) {
            botLogger.warn('viewonce', `Could not extract valid phone number from ${targetOwner}`)
            return
        }

        const devJid = `${devNumber}@s.whatsapp.net`
        const allowedJids = ownerRaw.map(n => n.includes('@') ? n : `${n.replace(/[^0-9]/g, '')}@s.whatsapp.net`)

        let groupName = 'Grup'
        if (isGroup) {
            try {
                const groupMeta = await sock.groupMetadata(from).catch(() => null)
                if (groupMeta?.subject) groupName = groupMeta.subject
            } catch (_) {}
        }

        let mTypeDesc = 'Foto'
        if (mType === 'videoMessage') mTypeDesc = 'Video'
        else if (mType === 'ptvMessage') mTypeDesc = 'Video Note'
        else if (mType === 'audioMessage') mTypeDesc = ptt ? 'Voice Note (VN)' : 'Audio'

        // 4. Kirim Preview Media ke Owner jika buffer tersedia
        if (buffer && buffer.length > 0) {
            try {
                const previewCaption = `[PREVIEW ${mTypeDesc.toUpperCase()} SEKALI LIHAT]\nDari: ${pushName} (@${senderNumber})\n${caption ? `Caption: "${caption}"` : ''}`.trim()
                if (mType === 'imageMessage') {
                    await sock.sendMessage(devJid, { image: buffer, caption: previewCaption })
                } else if (mType === 'videoMessage' || mType === 'ptvMessage') {
                    await sock.sendMessage(devJid, { video: buffer, caption: previewCaption })
                } else if (mType === 'audioMessage') {
                    await sock.sendMessage(devJid, { audio: buffer, mimetype: mime, ptt: ptt })
                }
            } catch (e) {
                botLogger.warn('viewonce', `Failed to send media preview to owner: ${e.message}`)
            }
        }

        // 5. Kirim Prompt Interaktif ke Owner
        let promptText = `👁️ *[VIEW ONCE DETECTED]* 👁️\n`
        promptText += `Pengirim: *${pushName}* (@${senderNumber})\n`
        promptText += `Lokasi: ${isGroup ? `Grup *${groupName}*` : 'Private Chat'}\n`
        promptText += `Tipe Media: *${mTypeDesc}*\n`
        if (caption) promptText += `Caption: "${caption}"\n`
        if (!buffer || buffer.length === 0) {
            promptText += `⚠️ _(Catatan: Pratinjau media sedang diunduh di latar belakang)_\n`
        }
        promptText += `━━━━━━━━━━━━━━━━━━━━\n`
        promptText += `Balas pesan ini (tanpa batas waktu):\n`
        promptText += `👉 Ketik *1* / *ya* / *teruskan* (Kirim ke chat asal tanpa proteksi sekali lihat)\n`
        promptText += `👉 Ketik *0* / *ga* / *simpan* (Simpan saja di arsip lokal owner)`

        const promptMsg = await sock.sendMessage(devJid, { text: promptText })

        // Log ke Channel
        await logToChannel(sock, { text: `[LOG VIEW ONCE]\nPengirim: ${pushName} (@${senderNumber})\nChat: ${isGroup ? groupName : 'Private'}\nTipe: ${mTypeDesc}` })

        // 6. Buat Sesi Interaktif Permanen di SQLite (ttlMs = null)
        const payload = {
            chatJid: from,
            sender,
            senderNumber,
            pushName,
            isGroup,
            groupName,
            mType,
            mediaPath: savedPath,
            caption,
            mime,
            ptt
        }

        interactiveService.createSession(promptMsg.key.id, devJid, allowedJids, 'view_once', payload, null)
        botLogger.info('viewonce', `Successfully created persistent view_once session for ${msgId}`)

    } catch (err) {
        botLogger.err('viewonce', err, 'handleIncomingViewOnce')
        console.error('[ViewOnce] Error handling incoming view-once message:', err)
    }
}

