// src/commands/radio/listener.js
import { radioService } from '../../services/radio.js'

export default {
    name: 'listener',
    aliases: ['listeners', 'pendengar'],
    category: 'audio',
    description: 'Jumlah pendengar radio aktif',
    usage: '.listener',
    cooldown: 3,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: [
        "listener",
        "listeners",
        "pendengar",
        "stats",
        "radio",
        "audio"
    ],
    params: {
        "type": "object",
        "properties": {},
        "required": []
    },



    async execute(ctx) {
        const { reply } = ctx
        const count = radioService.listenerCount
        const isPlaying = radioService.isPlaying
        const host = process.env.RADIO_HOST || 'ap1.nzb.zelpstore.id'
        const port = process.env.RADIO_PORT || '25637'

        await reply(
            `📻 *Radio Status*\n\n` +
            `👥 Pendengar aktif: *${count}*\n` +
            `▶️ Status: ${isPlaying ? '*ON AIR* 🔴' : '*OFF* ⚫'}\n` +
            `🔗 Stream: \`http://${host}:${port}/stream\`\n\n` +
            `_Buka URL stream di media player (VLC, browser, dll)_`
        )
    }
}