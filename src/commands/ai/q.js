// src/commands/ai/q.js
// !q — AI Chat dengan memory
// Alias: !ai, !tanya, !ronnbot

import { aiService } from '../../services/ai.js'
import { memoryService } from '../../services/memory.js'
import { seamlessTracker } from '../../services/seamless.js'
import { processAiResponse, tryDirectRoute } from '../../utils/aiRouter.js'

export default {
    name: 'q',
    aliases: ['ai', 'tanya', 'ronnbot'],
    category: 'ai',
    description: 'Chat dengan AI. Bot ingat konteks percakapan.',
    usage: '.q [pertanyaan]',
    example: '.q siapa penemu listrik?',
    cooldown: 3,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, chatId, msg } = ctx

        let forcedProvider = null
        let cleanArgs = []
        
        for (const arg of args) {
            if (arg === '--groq') forcedProvider = 'groq'
            else if (arg === '--nvidia') forcedProvider = 'nvidia'
            else if (arg === '--gemini') forcedProvider = 'gemini'
            else cleanArgs.push(arg)
        }

        const question = cleanArgs.join(' ')

        // Jika user sengaja mengganti parameter provider
        if (forcedProvider) {
            memoryService.setAiProvider(chatId, forcedProvider)
            await reply(`[⚙️] Preferensi AI untuk chat ini diubah ke: *${forcedProvider.toUpperCase()}*`)
        }

        if (!question) {
            if (forcedProvider) return // Kalau cuma setting param tanpa tanya, stop di sini
            return reply(`*Cara pakai:*\n!q [pertanyaan kamu]\n\nAtau ganti AI sementara/permanen:\n!q --nvidia [tanya sesuatu]\n!q --groq\n\nKetik !resetparamai untuk reset otak ke default.`)
        }

        // Thinking indicator
        await react('🤔')

        try {
            const isDirectRouted = await tryDirectRoute(question, ctx)
            if (isDirectRouted) {
                await react('✅')
                return
            }

            const result = await aiService.chat(chatId, question, forcedProvider)
            const executed = await processAiResponse(ctx, result)
            if (!executed) await react('✅')

        } catch (err) {
            await react('❌')
            await reply(`Maaf, AI lagi error:\n${err.message}`)
        }
    }
}