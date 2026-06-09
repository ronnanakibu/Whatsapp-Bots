// src/services/pterodactyl.js
import { logger } from '../utils/logger.js'

export async function sendPowerAction(action) {
    // Fallback otomatis disamakan dengan isi deploy.js lu
    const baseUrl = (process.env.PTERO_URL || 'https://panel.zelpstore.id').replace(/\/$/, '')
    const apiKey = process.env.PTERO_API_KEY
    const serverId = process.env.PTERO_SERVER_ID || 'dfbf800f'

    if (!apiKey) {
        logger.error('[Pterodactyl] PTERO_API_KEY belum di-set di file .env server!')
        return false
    }

    try {
        const url = `${baseUrl}/api/client/servers/${serverId}/power`

        // Trik aman: Kirim action dan signal sekaligus agar lolos di panel standar maupun kustom
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                action: action,
                signal: action
            })
        })

        if (response.ok || response.status === 204) {
            logger.info(`[Pterodactyl] Sukses mengirim sinyal power: ${action}`)
            return true
        }

        const errText = await response.text()
        logger.error(`[Pterodactyl] Panel merespon HTTP ${response.status}: ${errText}`)
        return false
    } catch (err) {
        logger.error(`[Pterodactyl] Error saat menghubungi API panel: ${err.message}`)
        return false
    }
}