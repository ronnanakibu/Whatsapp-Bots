// src/utils/url.js
// Dynamic URL Resolver for BotOS Web Dashboard, Radio, and Streaming endpoints

/**
 * Resolves the public base URL dynamically across all environments:
 * Priority:
 * 1. DASHBOARD_URL (explicit user override)
 * 2. RENDER_EXTERNAL_URL (Render.com automated injection)
 * 3. RAILWAY_STATIC_URL / RAILWAY_PUBLIC_DOMAIN (Railway automated injection)
 * 4. SPACE_HOST (Hugging Face Spaces automated injection)
 * 5. RADIO_HOST + RADIO_PORT (local / VPS / Pterodactyl container)
 * 6. localhost fallback
 */
export function getBasePublicUrl() {
    if (process.env.DASHBOARD_URL) {
        return process.env.DASHBOARD_URL.replace(/\/+$/, '').replace(/\/dashboard\/?$/, '')
    }
    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '')
    }
    if (process.env.RAILWAY_STATIC_URL) {
        return `https://${process.env.RAILWAY_STATIC_URL.replace(/\/+$/, '')}`
    }
    if (process.env.SPACE_HOST) {
        return `https://${process.env.SPACE_HOST.replace(/\/+$/, '')}`
    }
    if (process.env.PUBLIC_URL) {
        return process.env.PUBLIC_URL.replace(/\/+$/, '')
    }
    if (process.env.APP_URL) {
        return process.env.APP_URL.replace(/\/+$/, '')
    }

    const host = process.env.RADIO_HOST || 'localhost'
    const port = process.env.PORT || process.env.RADIO_PORT || '7860'

    // If host already includes scheme (http/https)
    if (host.startsWith('http://') || host.startsWith('https://')) {
        try {
            const url = new URL(host)
            if (!url.port && port && port !== '80' && port !== '443') {
                url.port = port
            }
            return url.origin
        } catch (_) {
            return host.replace(/\/+$/, '')
        }
    }

    return `http://${host}:${port}`
}

export function getDashboardUrl() {
    if (process.env.DASHBOARD_URL) {
        return process.env.DASHBOARD_URL.replace(/\/+$/, '')
    }
    return `${getBasePublicUrl()}/dashboard`
}

export function getRadioUrl() {
    if (process.env.RADIO_WEB_URL) {
        return process.env.RADIO_WEB_URL.replace(/\/+$/, '')
    }
    return `${getBasePublicUrl()}/radio`
}

export function getStreamUrl() {
    if (process.env.RADIO_STREAM_URL) {
        return process.env.RADIO_STREAM_URL
    }
    return `${getBasePublicUrl()}/stream`
}

export function getAppLogUrl() {
    return `${getBasePublicUrl()}/app.log`
}

export function getPairingUrl() {
    return `${getBasePublicUrl()}/pairing`
}
