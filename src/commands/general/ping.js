// src/commands/general/ping.js
export default {
    name: 'ping',
    aliases: ['p', 'test'],
    category: 'general',
    description: 'Cek kecepatan respon dan latensi koneksi bot WhatsApp (Pong latency).',
    usage: '.ping',
    example: '.ping',
    cooldown: 2,
    permissions: ['user'],
    requireBotAdmin: false,
    tags: ['ping', 'pong', 'latency', 'speed', 'status', 'general'],
    params: {
        type: 'object',
        properties: {},
        required: []
    },
    async execute(ctx) {
        const start = Date.now()
        await ctx.reply('Pong!')
        // latency bisa dihitung dari ctx.message.messageTimestamp
    }
}