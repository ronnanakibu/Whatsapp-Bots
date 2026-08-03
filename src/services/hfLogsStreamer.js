// src/services/hfLogsStreamer.js
import axios from 'axios'
import { logger } from '../utils/logger.js'

class HfLogsStreamer {
    constructor() {
        this.hfToken = process.env.HF_TOKEN ? process.env.HF_TOKEN.replace(/^["']|["']$/g, '') : ''
        this.spaceRepo = process.env.HF_SPACE_REPO || 'ronnLbtrn/HERMESBACKEND'
        this.logHistory = []
        this.maxLogs = 50
        this.isStreaming = false
    }

    /**
     * Start streaming live logs from Hugging Face Space to server console & memory
     */
    async startStreaming() {
        if (this.isStreaming) return
        this.isStreaming = true

        const url = `https://huggingface.co/api/spaces/${this.spaceRepo}/logs/run`
        logger.info(`[HF-Logs] Starting live log stream from HF Space: ${this.spaceRepo}...`)

        const connect = async () => {
            try {
                const response = await axios({
                    method: 'get',
                    url: url,
                    headers: {
                        'Authorization': `Bearer ${this.hfToken}`,
                        'Accept': 'text/event-stream'
                    },
                    responseType: 'stream',
                    timeout: 0
                })

                logger.info(`[HF-Logs] ✅ Connected to HF Space log stream!`)

                response.data.on('data', (chunk) => {
                    const str = chunk.toString('utf8')
                    const lines = str.split('\n')

                    for (const line of lines) {
                        const trimmed = line.trim()
                        if (!trimmed || trimmed.startsWith(':')) continue

                        // Extract content if EventStream data line
                        let logText = trimmed
                        if (trimmed.startsWith('data:')) {
                            logText = trimmed.slice(5).trim()
                        }

                        if (logText) {
                            // Filter noise / keep meaningful log lines
                            if (logText.includes('[TRAFFIC IN]') || logText.includes('[User WhatsApp]') || logText.includes('[TAHAP 1') || logText.includes('[TAHAP 2') || logText.includes('[SUCCESS]') || logText.includes('[ERROR]') || logText.includes('Starting Real-Time')) {
                                console.log(`\x1b[36m[HF-Space]\x1b[0m ${logText}`)
                            }

                            // Store in history for !hermes logs command
                            this.logHistory.push({
                                text: logText,
                                timestamp: Date.now()
                            })

                            if (this.logHistory.length > this.maxLogs) {
                                this.logHistory.shift()
                            }
                        }
                    }
                })

                response.data.on('end', () => {
                    logger.warn('[HF-Logs] Log stream ended, reconnecting in 5s...')
                    setTimeout(connect, 5000)
                })

                response.data.on('error', (err) => {
                    logger.warn(`[HF-Logs] Stream error (${err.message}), reconnecting in 10s...`)
                    setTimeout(connect, 10000)
                })

            } catch (err) {
                logger.warn(`[HF-Logs] Failed to connect to HF Space log stream (${err.message}), retrying in 10s...`)
                setTimeout(connect, 10000)
            }
        }

        connect()
    }

    /**
     * Get recent log history
     */
    getRecentLogs(limit = 15) {
        return this.logHistory.slice(-limit)
    }
}

export const hfLogsStreamer = new HfLogsStreamer()
