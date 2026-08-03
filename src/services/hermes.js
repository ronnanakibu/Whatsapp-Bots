// src/services/hermes.js
// Dedicated service to interface with NousResearch Hermes Agent API / Gateway
import axios from 'axios'
import { logger } from '../utils/logger.js'

class HermesService {
    constructor() {
        this.baseUrl = (process.env.HERMES_AGENT_URL || 'http://127.0.0.1:8642/v1').replace(/\/+$/, '')
        this.apiKey = process.env.HERMES_API_KEY || ''
        this.model = process.env.HERMES_MODEL || 'hermes-agent'
        this.enabled = process.env.HERMES_ENABLED !== 'false'
    }

    /**
     * Check connection to Hermes Agent Gateway
     */
    async checkHealth() {
        try {
            const url = `${this.baseUrl}/models`
            const headers = {}
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`
            }
            const response = await axios.get(url, { headers, timeout: 3000 })
            return { ok: true, data: response.data }
        } catch (err) {
            return { ok: false, error: err.message }
        }
    }

    /**
     * Send chat prompt to Pure Hermes Agent
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

        const messages = []
        
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt })
        }

        messages.push({ role: 'user', content: promptText.trim() })

        const payload = {
            model: this.model,
            messages,
            user: chatId // Passes WhatsApp JID so Hermes Agent tracks per-user/group session memory
        }

        try {
            const response = await axios.post(url, payload, {
                headers,
                timeout: 120000 // 2 minute timeout for complex agent tasks
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
                throw new Error(`Gagal terhubung ke Hermes Agent di (${this.baseUrl}). Pastikan Hermes Agent Gateway sudah berjalan (Jalankan: 'hermes gateway' atau pastikan API_SERVER_ENABLED=true).`)
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
