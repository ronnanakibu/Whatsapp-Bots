import { aiService } from '../../services/ai.js'

export default {
    name: 'kimi',
    aliases: ['kimik2', 'askkimi'],
    category: 'utility',
    description: 'Tanyakan sesuatu ke Moonshot AI Kimi K2.6 (NVIDIA NIM) dengan penalaran logika (reasoning) tinggi.',
    usage: '.kimi [pertanyaan]',
    example: '.kimi berikan saya 5 teka-teki logika yang sulit beserta jawabannya.',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react } = ctx
        if (!args.length) return reply('*Usage:* .kimi [pertanyaan]\n\nContoh:\n.kimi tolong debug kode javascript ini...')

        const query = args.join(' ')
        await react('🧠')
        await reply('_Kimi sedang berpikir..._')

        try {
            const systemPrompt = 'Kamu adalah Kimi K2.6, model AI canggih dari Moonshot AI yang dihost oleh NVIDIA. Kamu memiliki kemampuan penalaran logika (reasoning) yang sangat tinggi. Jawablah pertanyaan user dengan teliti, runut, dan mendalam.'
            const result = await aiService.kimiChat(query, systemPrompt)
            
            await reply(`${result.text}\n\n🤖 _Model: Moonshot Kimi K2.6 (NVIDIA NIM)_`)
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal terhubung ke Kimi: ${err.message}`)
        }
    }
}
