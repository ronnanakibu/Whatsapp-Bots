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

        const MODEL_FLAGS = {
            '--groq': 'groq',
            '--nvidia': 'nvidia',
            '--gemini': 'gemini',
            '--gpt_oss': 'gpt_oss',
            '--nemotron_super': 'nemotron_super',
            '--llama3_3': 'llama3_3',
            '--qwen3': 'qwen3',
            '--gemma4': 'gemma4',
            '--kimi': 'kimi',
            '--deepseek_flash': 'deepseek_flash',
            '--deepseek_pro': 'deepseek_pro',
            '--nemotron_voice': 'nemotron_voice'
        }

        for (const arg of args) {
            if (MODEL_FLAGS[arg]) {
                forcedProvider = MODEL_FLAGS[arg]
            } else {
                cleanArgs.push(arg)
            }
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
            return reply(
                `*Cara pakai:*\n!q [pertanyaan kamu]\n\n` +
                `*Atau ganti AI sementara/permanen:*\n` +
                `- !q --nvidia (Nemotron 70B)\n` +
                `- !q --groq (Llama 3.3)\n` +
                `- !q --gemini (Gemini 2.0 Flash)\n` +
                `- !q --gpt_oss (GPT-OSS 120B)\n` +
                `- !q --nemotron_super (Nemotron-3 Super)\n` +
                `- !q --llama3_3 (Llama 3.3 70B)\n` +
                `- !q --qwen3 (Qwen3 80B)\n` +
                `- !q --gemma4 (Gemma 4 31B)\n` +
                `- !q --kimi (Kimi K2.6)\n` +
                `- !q --deepseek_flash (DeepSeek V4 Flash)\n` +
                `- !q --deepseek_pro (DeepSeek V4 Pro)\n` +
                `- !q --nemotron_voice (Nemotron VoiceChat)\n\n` +
                `💡 Ketik *!resetparamai* untuk mereset otak bot ke default.`
            )
        }

        const { executeAiFlow } = await import('../../utils/aiRouter.js')
        await executeAiFlow(ctx, question, forcedProvider)
    }
}