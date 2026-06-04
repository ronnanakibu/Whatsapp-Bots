import { logger } from '../../utils/logger.js'
import fs from 'fs'
import path from 'path'

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

        // Cek contextInfo dari quoted message atau current message
        const contextInfo = messageContent?.extendedTextMessage?.contextInfo || msg.message?.extendedTextMessage?.contextInfo

        if (!contextInfo || !contextInfo.forwardedNewsletterMessageInfo) {
            return reply('⚠️ Cara pakai: Forward salah satu pesan dari Channel yang mau dijadikan log ke chat ini, lalu balas pesan forward tersebut dengan perintah `.setlogchannel`')
        }

        const newsletterJid = contextInfo.forwardedNewsletterMessageInfo.newsletterJid
        const newsletterName = contextInfo.forwardedNewsletterMessageInfo.newsletterName || 'Unknown Channel'

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

            await reply(`✅ Berhasil! Channel penampungan log telah di-set ke:\n*${newsletterName}*\n(${newsletterJid})`)
        } catch (err) {
            logger.error('❌ Gagal save LOG_CHANNEL_JID:', err)
            await reply('❌ Gagal menyimpan pengaturan channel.')
        }
    }
}
