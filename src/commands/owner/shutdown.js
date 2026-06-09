// src/commands/owner/shutdown.js
import { isOwner } from '../../utils/permissions.js'
import { sendPowerAction } from '../../services/pterodactyl.js'

export default {
    name: 'shutdown',
    aliases: ['off', 'matikan'],
    category: 'owner',
    description: '[OWNER] Mematikan server bot lewat Pterodactyl API.',
    usage: '.shutdown',
    cooldown: 0,
    permissions: ['owner'],

    async execute(ctx) {
        const { reply, react, sender, args } = ctx

        if (!isOwner(sender)) {
            await react('🚫')
            return
        }

        if (args.length > 0) {
            return reply('⚠️ Command ini tidak menerima input/argumen apapun, cuy.')
        }

        await react('🛑')
        await reply('🛑 *Pterodactyl Stop:* Mengirim instruksi pemutusan daya ke panel. Bot akan offline total, cuy! 👋')

        // Panggil service Pterodactyl dengan parameter 'stop'
        const success = await sendPowerAction('stop')

        if (!success) {
            // Fallback paksa jika API mengalami error
            setTimeout(() => { process.exit(0) }, 1000)
        }
    }
}