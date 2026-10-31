// src/commands/radio/stop.js
import { radioService } from '../../services/radio.js'

export default {
    name: 'stop',
    aliases: ['radiooff', 'matiin'],
    category: 'audio',
    description: 'Stop radio dan bersihkan queue',
    usage: '.stop',
    cooldown: 5,
    permissions: ['admin'],
    requireBotAdmin: false,
    tags: [
        "stop",
        "radiooff",
        "matiin",
        "hentikan",
        "music",
        "radio",
        "audio"
    ],
    params: {
        "type": "object",
        "properties": {},
        "required": []
    },



    async execute(ctx) {
        const { reply, react } = ctx
        if (!radioService.isPlaying && radioService.queue.length === 0) {
            return reply('📻 Radio sudah off.')
        }
        radioService.stop()
        await react('⏹️')
        await reply('⏹️ Radio dihentikan dan queue dibersihkan.')
    }
}