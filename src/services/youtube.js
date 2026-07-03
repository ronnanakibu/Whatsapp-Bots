// src/services/youtube.js
import { google } from 'googleapis'
import fs from 'fs'
import 'dotenv/config'
import { logger } from '../utils/logger.js'

/**
 * Uploads a video to YouTube using OAuth2 credentials.
 * @param {Object} params
 * @param {string} params.videoPath - Absolute path to the local video file.
 * @param {string} params.title - Video title.
 * @param {string} params.description - Video description.
 * @param {Array<string>} params.tags - Video tags.
 * @param {string} [params.privacyStatus] - 'public', 'private', or 'unlisted'.
 * @param {function} [params.onProgress] - Progress callback receiving (progressPercent).
 * @returns {Promise<string>} - The YouTube video URL (https://youtu.be/ID).
 */
export async function uploadVideo({ videoPath, title, description, tags, privacyStatus = 'private', onProgress }) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found at: ${videoPath}`)
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing YouTube OAuth credentials. Configure CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN in .env')
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
    oauth2Client.setCredentials({ refresh_token: refreshToken })

    const youtube = google.youtube({
        version: 'v3',
        auth: oauth2Client
    })

    const fileSize = fs.statSync(videoPath).size
    logger.info(`[YouTube/Upload] Starting upload of ${title} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)...`)

    try {
        const response = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title,
                    description,
                    tags,
                    categoryId: '10', // Music category
                    defaultLanguage: 'id',
                    defaultAudioLanguage: 'id'
                },
                status: {
                    privacyStatus,
                    selfDeclaredMadeForKids: false
                }
            },
            media: {
                body: fs.createReadStream(videoPath)
            }
        }, {
            // Optional: configure chunk size if uploading in chunks
            onUploadProgress: (evt) => {
                const progress = Math.round((evt.bytesRead / fileSize) * 100)
                logger.info(`[YouTube/Upload] Progress: ${progress}%`)
                if (onProgress) {
                    onProgress(progress)
                }
            }
        })

        const videoId = response.data.id
        const videoUrl = `https://youtu.be/${videoId}`
        logger.info(`[YouTube/Upload] Upload complete! Video ID: ${videoId} (${videoUrl})`)
        return videoUrl
    } catch (err) {
        logger.error(`[YouTube/Upload] Failed to upload video: ${err.message}`)
        throw err
    }
}
