import { logger } from '../../utils/logger.js'
import fs from 'fs'
import path from 'path'
import { store } from '../../services/store.js'

export default {
    name: 'setlogchannel',
    aliases: ['setlog'],
    category: 'owner',
    description: 'Set channel penampungan log bot (forward pesan dari channel ke bot pakai command ini)',
    usage: 'Forward pesan channel ke bot lalu ketik .setlogchannel',
    cooldown: 0,
    permissions: ['owner'],
    async execute(ctx) {
        const { msg, messageContent, type, reply } = ctx

        // Cek contextInfo dari current message untuk mendapatkan quoted message id
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo || msg.message?.extendedTextMessage?.contextInfo

        if (!contextInfo || !contextInfo.stanzaId) {
            return reply('⚠️ Cara pakai: Forward salah satu pesan dari Channel yang mau dijadikan log ke chat ini, lalu balas pesan forward tersebut dengan perintah `.setlogchannel`')
        }

        // Ambil pesan asli dari database Baileys memory store
        const originalMsg = await store.loadMessage(msg.key.remoteJid, contextInfo.stanzaId)
        if (!originalMsg) {
            return reply('❌ Gagal memuat pesan yang dibalas. Coba forward ulang pesannya ya cuy.')
        }

        // Cari forwardedNewsletterMessageInfo di pesan asli
        const origContextInfo = originalMsg.message?.extendedTextMessage?.contextInfo || originalMsg.message?.videoMessage?.contextInfo || originalMsg.message?.imageMessage?.contextInfo || originalMsg.message?.documentMessage?.contextInfo || originalMsg.message?.audioMessage?.contextInfo || originalMsg.message?.conversation?.contextInfo
        
        let newsletterJid, newsletterName

        if (origContextInfo?.forwardedNewsletterMessageInfo) {
            newsletterJid = origContextInfo.forwardedNewsletterMessageInfo.newsletterJid
            newsletterName = origContextInfo.forwardedNewsletterMessageInfo.newsletterName || 'Unknown Channel'
        } else if (originalMsg.message?.newsletterAdminInviteMessage) {
            newsletterJid = originalMsg.message.newsletterAdminInviteMessage.newsletterJid
            newsletterName = originalMsg.message.newsletterAdminInviteMessage.newsletterName
        }

        if (!newsletterJid) {
             return reply('⚠️ Pesan yang kamu balas bukan dari Channel/Newsletter! Pastikan kamu mem-forward pesan langsung dari Channel.')
        }

        try {
            // Save to .env
            const envPath = path.resolve('.env')
            let envContent = fs.readFileSync(envPath, 'utf8')

            if (envContent.includes('LOG_CHANNEL_JID=')) {
                envContent = envContent.replace(/LOG_CHANNEL_JID=.*/g, `LOG_CHANNEL_JID=${newsletterJid}`)
            } else {
                envContent += `\nLOG_CHANNEL_JID=${newsletterJid}\n`
            }

            fs.writeFileSync(envPath, envContent)
            process.env.LOG_CHANNEL_JID = newsletterJid

            await reply(`✅ Berhasil! Channel penampungan log telah di-set ke:\n*${newsletterName}*\n(${newsletterJid})\n\nMengirim pesan tes ke channel...`)

            // Tes kirim ke channel
            try {
                const { logToChannel } = await import('../../utils/channelLogger.js')
                await logToChannel(ctx.sock, { text: `✅ [TEST LOG]\nBot berhasil terhubung ke channel ini!\nSemua log media dan anti-snitch akan dikirim ke sini mulai sekarang.` })
            } catch (e) {
                logger.error('Gagal tes kirim log:', e)
                await reply('⚠️ Peringatan: Berhasil set JID, tapi bot gagal mengirim pesan tes ke channel. Pastikan bot adalah Admin di channel tersebut!')
            }

        } catch (err) {
            logger.error('❌ Gagal save LOG_CHANNEL_JID:', err)
            await reply('❌ Gagal menyimpan pengaturan channel.')
        }
    }
}
