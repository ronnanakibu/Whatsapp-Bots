// src/services/hf.js
// Shared HuggingFace Spaces client service
// Uses @gradio/client v2 with connection pooling & unified error handling

import { Client } from '@gradio/client'
import axios from 'axios'
import { logger } from '../utils/logger.js'

const HF_TOKEN = process.env.HF_TOKEN ?? undefined
const DEFAULT_TIMEOUT_MS = 180_000 // 3 minutes (ZeroGPU spaces can queue)

// ─── Connection Pool ─────────────────────────────────────────────────────────
const clientPool = new Map()

/**
 * Get or create a cached Gradio client for a given space
 */
async function getClient(spaceId) {
    if (clientPool.has(spaceId)) return clientPool.get(spaceId)

    const opts = {}
    if (HF_TOKEN) opts.hf_token = HF_TOKEN

    const client = await Client.connect(spaceId, opts)
    clientPool.set(spaceId, client)
    logger.info(`[HF] Connected to ${spaceId}`)
    return client
}

/**
 * Invalidate a cached client (e.g. after an error)
 */
function invalidateClient(spaceId) {
    clientPool.delete(spaceId)
}

/**
 * Core predict wrapper with timeout + retry logic
 * @param {string} spaceId - HuggingFace space ID
 * @param {string} endpoint - Named endpoint (e.g. '/run') or fn_index number
 * @param {object|Array} params - Parameters object (named) or array (positional)
 * @param {object} [options]
 * @param {number} [options.timeout] - Timeout in ms (default: 180000)
 * @param {number} [options.retries] - Number of retries on error (default: 1)
 */
export async function hfPredict(spaceId, endpoint, params, options = {}) {
    const { timeout = DEFAULT_TIMEOUT_MS, retries = 1 } = options
    let lastErr

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const client = await getClient(spaceId)

            // Handle both named endpoint string and fn_index number
            const predictOpts = typeof endpoint === 'number'
                ? { fn_index: endpoint }
                : { api_name: endpoint }

            // Wrap in a race with timeout
            const result = await Promise.race([
                client.predict(predictOpts.api_name ?? undefined, params, predictOpts.fn_index !== undefined ? { fn_index: predictOpts.fn_index } : undefined),
                new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout after ${timeout / 1000}s`)), timeout))
            ])

            return result
        } catch (err) {
            lastErr = err
            logger.warn(`[HF] ${spaceId} attempt ${attempt + 1} failed: ${err.message}`)
            // Invalidate client on connection errors so next attempt reconnects
            if (attempt < retries && (err.message.includes('fetch') || err.message.includes('connect'))) {
                invalidateClient(spaceId)
                await new Promise(r => setTimeout(r, 2000))
            }
        }
    }

    throw lastErr
}

/**
 * Download a result URL from HF Space to a Buffer
 * Handles both direct URLs and Gradio file proxy URLs
 */
export async function downloadHFResult(url) {
    if (!url) throw new Error('No URL to download')
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
        }
    })
    return Buffer.from(res.data)
}

/**
 * Extract the result URL from a Gradio predict response
 * Handles the various response formats across Gradio versions
 */
export function extractResultUrl(result) {
    // Gradio v4+ format: result.data is an array
    const data = result?.data
    if (!data) return null

    // Try each element in data
    for (const item of (Array.isArray(data) ? data : [data])) {
        if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('/'))) return item
        if (item?.url) return item.url
        if (item?.path) return item.path
        if (item?.value?.url) return item.value.url
        // Gradio file object format
        if (item?.orig_name) return item.url ?? item.path
    }
    return null
}

/**
 * Extract video URL from result (may differ from image format)
 */
export function extractVideoUrl(result) {
    const data = result?.data
    if (!data) return null
    const items = Array.isArray(data) ? data : [data]
    for (const item of items) {
        if (item?.video?.url) return item.video.url
        if (item?.url && item.url.includes('.mp4')) return item.url
        if (typeof item === 'string' && item.includes('.mp4')) return item
    }
    return extractResultUrl(result) // fallback
}

/**
 * Build a Gradio file blob for image input params
 * (for spaces that need image upload)
 */
export function toGradioBlob(buffer, mimetype = 'image/png') {
    return new Blob([buffer], { type: mimetype })
}

export default { hfPredict, downloadHFResult, extractResultUrl, extractVideoUrl, toGradioBlob, getClient }
