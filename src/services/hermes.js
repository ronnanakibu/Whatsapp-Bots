// src/services/hermes.js
// Dedicated service to interface with NousResearch Hermes Agent / Cloud API (OpenRouter / Hosted Hermes)
import axios from 'axios'
import { logger } from '../utils/logger.js'

class HermesService {
    constructor() {
        this.rawUrl = process.env.HERMES_AGENT_URL || 'http://127.0.0.1:8642/v1'
        this.baseUrl = this.rawUrl.replace(/\/+$/, '')
        this.apiKey = process.env.HERMES_API_KEY || process.env.OPENROUTER_API_KEY || ''
        
        // Auto-detect model default: If using OpenRouter URL, default to nousresearch/hermes-3-llama-3.1-70b
        const defaultModel = this.baseUrl.includes('openrouter') 
            ? 'nousresearch/hermes-3-llama-3.1-70b' 
            : 'hermes-agent'
            
        this.model = process.env.HERMES_MODEL || defaultModel
        this.enabled = process.env.HERMES_ENABLED !== 'false'
    }

    /**
     * Check connection to Hermes Agent Gateway / Cloud API
     */
    async checkHealth() {
        try {
            const url = `${this.baseUrl}/models`
            const headers = {}
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`
            }
            if (this.baseUrl.includes('openrouter')) {
                headers['HTTP-Referer'] = 'https://github.com/NousResearch/hermes-agent'
                headers['X-Title'] = 'WABOT2.0 Hermes Agent'
            }
            const response = await axios.get(url, { headers, timeout: 5000 })
            return { ok: true, data: response.data }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    }

    /**
     * Send chat prompt to Pure Hermes Agent / Nous Hermes Model
     * @param {string} chatId - WhatsApp JID / Chat ID (used as session/user identifier)
     * @param {string} promptText - User text prompt
     * @param {object} options - Additional options (e.g. systemPrompt, media context)
     */
    async chat(chatId, promptText, options = {}) {
        if (!promptText || !promptText.trim()) {
            throw new Error('Prompt tidak boleh kosong.')
        }

        const url = `${this.baseUrl}/chat/completions`
        const headers = {
            'Content-Type': 'application/json'
        }
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`
        }

        if (this.baseUrl.includes('openrouter')) {
            headers['HTTP-Referer'] = 'https://github.com/NousResearch/hermes-agent'
            headers['X-Title'] = 'WABOT2.0 Hermes Agent'
        }

        const messages = []
        
        const systemPrompt = options.systemPrompt || process.env.SYSTEM_PROMPT || 
            'You are RonnBot powered by NousResearch Hermes Agent. You are a helpful, intelligent, natural AI assistant on WhatsApp.'

        messages.push({ role: 'system', content: systemPrompt })
        messages.push({ role: 'user', content: promptText.trim() })

        let targetModel = this.model
        if (!targetModel || targetModel === 'hermes-agent' || targetModel === 'default') {
            targetModel = 'nousresearch/hermes-3-llama-3.1-70b'
        }

        const payload = {
            model: targetModel,
            messages,
            user: chatId // Passes WhatsApp JID for session tracking
        }

        try {
            const response = await axios.post(url, payload, {
                headers,
                timeout: 120000 // 2 minute timeout
            })

            const choice = response.data?.choices?.[0]
            const text = choice?.message?.content || choice?.text || ''

            if (!text) {
                throw new Error('Hermes Agent memberikan respon kosong.')
            }

            return {
                text: text.trim(),
                provider: 'hermes-agent',
                model: response.data?.model || this.model
            }
        } catch (err) {
            logger.error('[HermesService] Failed to call Hermes Agent API:', err.message)

            if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
                throw new Error(`Gagal terhubung ke Hermes Agent di (${this.baseUrl}). Jika tidak ada terminal/pip di panel, kamu bisa menggunakan Cloud OpenRouter URL di .env (HERMES_AGENT_URL=https://openrouter.ai/api/v1 dan HERMES_MODEL=nousresearch/hermes-3-llama-3.1-70b).`)
            }

            if (err.response?.data?.error) {
                const apiErr = err.response.data.error
                const msg = typeof apiErr === 'string' ? apiErr : apiErr.message || JSON.stringify(apiErr)
                throw new Error(`Hermes Agent Error: ${msg}`)
            }

            throw err
        }
    }
}

export const hermesService = new HermesService()
