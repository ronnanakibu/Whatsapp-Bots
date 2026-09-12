// src/commands/utility/poststory.js
// !poststory — Kirim/upload media foto atau video manual dari WhatsApp ke arsip website kelas CE F

import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { unwrapMessage } from '../../utils/message.js'
import { forwardStoryToWebsite } from '../../services/storySync.js'
import { isGroupAdmin, isOwner } from '../../middleware/permission.js'

export default {
    name: 'poststory',
    aliases: ['uploadstory', 'kirimstory', 'arsipstory'],
    category: 'utility',
    description: 'Upload foto atau video ke arsip story website kelas (bisa langsung atau reply media).',
    usage: '!poststory [keterangan/caption]',
    example: '!poststory Suasana praktikum IoT sore ini',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { msg, messageContent, args, reply, react, from, isGroup, sender, sock } = ctx

        // Batasi untuk admin grup atau bot owner jika di grup
        if (isGroup) {
            const admin = await isGroupAdmin(sock, from, sender)
            const owner = isOwner(sender)
            if (!admin && !owner) {
                await react('🚫')
                return reply('🚫 *Akses Dibatasi:* Hanya admin grup atau owner yang dapat mengunggah arsip story ke website.')
            }
        }

        // 1. Deteksi media (langsung atau reply)
        const isMediaMsg = (m) => {
            if (!m) return false
            const mType = Object.keys(m)[0]
            if (mType === 'imageMessage' || mType === 'videoMessage' || mType === 'ptvMessage') return true
            if (mType === 'documentMessage') {
                const mime = m.documentMessage?.mimetype || ''
                return mime.startsWith('image/') || mime.startsWith('video/')
            }
            return false
        }

        const unwrappedDirect = unwrapMessage(messageContent)
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const unwrappedQuoted = unwrapMessage(quotedMsg)

        const hasDirectMedia = isMediaMsg(unwrappedDirect)
        const hasQuotedMedia = isMediaMsg(unwrappedQuoted)

        if (!hasDirectMedia && !hasQuotedMedia) {
            await react('⚠️')
            return reply(
                '⚠️ *Media Tidak Ditemukan!* 📸\n\n' +
                'Kirim gambar/video dengan caption *!poststory [caption]* atau balas (reply) media yang sudah ada dengan perintah *!poststory [caption]*.'
            )
        }

        await react('⏳')

        try {
            let buffer
            let isVideo = false
            let ext = 'jpg'

            if (hasDirectMedia) {
                const mType = Object.keys(unwrappedDirect)[0]
                isVideo = mType === 'videoMessage' || mType === 'ptvMessage' || (mType === 'documentMessage' && (unwrappedDirect.documentMessage?.mimetype || '').startsWith('video/'))
                ext = isVideo ? 'mp4' : 'jpg'

                buffer = await downloadMediaMessage(
                    { key: msg.key, message: unwrappedDirect },
                    'buffer',
                    {},
                    { logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage }
                )
            } else {
                const mType = Object.keys(unwrappedQuoted)[0]
                isVideo = mType === 'videoMessage' || mType === 'ptvMessage' || (mType === 'documentMessage' && (unwrappedQuoted.documentMessage?.mimetype || '').startsWith('video/'))
                ext = isVideo ? 'mp4' : 'jpg'

                const quotedKey = messageContent?.extendedTextMessage?.contextInfo
                const reconstructedQuotedMsg = {
                    key: {
                        remoteJid: from,
                        id: quotedKey?.stanzaId ?? '',
                        fromMe: quotedKey?.participant === sock.user?.id,
                    },
                    message: unwrappedQuoted,
                }

                buffer = await downloadMediaMessage(
                    reconstructedQuotedMsg,
                    'buffer',
                    {},
                    { logger: console, reconnectCount: 3, reuploadRequest: sock.updateMediaMessage }
                )
            }

            if (!buffer || buffer.length === 0) {
                await react('❌')
                return reply('❌ Gagal mengunduh media dari WhatsApp. Silakan coba kirim ulang medianya.')
            }

            const caption = args.join(' ').trim()
            const filename = `manual_story_${Date.now()}.${ext}`

            const uploadRes = await forwardStoryToWebsite({
                mediaBuffer: buffer,
                filename,
                caption,
                author: 'comeinone.f',
                category: 'General',
                mediaType: isVideo ? 'video' : 'image',
            })

            await react('✅')
            return reply(
                `✅ *Story Berhasil Diarsipkan ke Website!* 🚀\n\n` +
                `🎬 *Tipe*: ${isVideo ? 'Video' : 'Foto'}\n` +
                `📝 *Caption*: ${caption || '_(Tanpa Keterangan)_'}\n` +
                `👤 *Author*: @comeinone.f\n` +
                `🌐 *Portal Web*: https://cef25.my.id\n\n` +
                `_Media kini telah tersimpan permanen di galeri arsip story kelas!_`
            )
        } catch (err) {
            await react('❌')
            return reply(`❌ *Gagal mengunggah story ke website:*\n${err.message}`)
        }
    }
}
