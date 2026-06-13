// src/commands/ai/q.js
// !q — AI Chat dengan memory
// Alias: !ai, !tanya, !ronnbot

import { memoryService } from '../../services/memory.js'

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
        const { args, reply, react, chatId, msg, messageContent } = ctx

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

        // Cek apakah ada gambar di pesan atau di quoted
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']
        let quotedInner = quotedMsg
        if (quotedMsg) {
            const qType = Object.keys(quotedMsg)[0]
            if (WRAPPERS.includes(qType)) {
                quotedInner = quotedMsg[qType]?.message ?? quotedMsg
            }
        }
        const hasImage = !!(msg.message?.imageMessage || quotedInner?.imageMessage)

        if (!question && !hasImage) {
            if (forcedProvider) return // Kalau cuma setting param tanpa tanya, stop di sini
            return reply(`*Cara pakai:*\n!q [pertanyaan kamu]\n\nAtau ganti AI sementara/permanen:\n!q --nvidia [tanya sesuatu]\n!q --groq\n\nKetik !resetparamai untuk reset otak ke default.`)
        }

        const { executeAiFlow } = await import('../../utils/aiRouter.js')
        await executeAiFlow(ctx, question, forcedProvider)
    }
}