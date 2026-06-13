import axios from 'axios'
import { logger } from '../utils/logger.js'

class LyricsService {
    /**
     * Search and retrieve lyrics for a query.
     * @param {string} query
     * @returns {Promise<{ plainLyrics: string, syncedLyrics: string, title: string, artist: string }|null>}
     */
    async fetchLyrics(query) {
        try {
            logger.info(`[Lyrics] Searching lyrics for: "${query}"`)
            const res = await axios.get(`https://lrclib.net/api/search`, {
                params: { q: query },
                headers: {
                    'User-Agent': 'WABot/2.0 (https://github.com/ronss/wabot2.0)'
                },
                timeout: 8000
            })

            if (!res.data || res.data.length === 0) {
                logger.warn(`[Lyrics] No results found for query: "${query}"`)
                return null
            }

            // Temukan hasil pertama yang memiliki plainLyrics
            const bestMatch = res.data.find(item => item.plainLyrics && item.plainLyrics.trim().length > 10)
            if (!bestMatch) {
                const firstItem = res.data[0]
                return {
                    plainLyrics: firstItem.plainLyrics || null,
                    syncedLyrics: firstItem.syncedLyrics || null,
                    title: firstItem.name || 'Unknown',
                    artist: firstItem.artistName || 'Unknown'
                }
            }

            return {
                plainLyrics: bestMatch.plainLyrics,
                syncedLyrics: bestMatch.syncedLyrics || null,
                title: bestMatch.name,
                artist: bestMatch.artistName
            }
        } catch (err) {
            logger.error(`[Lyrics] API request failed: ${err.message}`)
            return null
        }
    }
}

export const lyricsService = new LyricsService()
