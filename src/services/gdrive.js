// src/services/gdrive.js
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger.js'

const CREDENTIALS_PATH = path.resolve('./storage/ronnbot-music-ab8a3df5de8c.json')

/**
 * Get authorized Google Drive client using Service Account key.
 */
function getDriveClient() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        throw new Error(`Google credentials file not found at: ${CREDENTIALS_PATH}`)
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'))
    let privateKey = credentials.private_key
    if (privateKey) {
        // Sanitize the private key string to replace escaped or literal newlines with exact UNIX newline chars
        privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r/g, '')
    }

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: credentials.client_email,
            private_key: privateKey
        },
        scopes: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive'
        ]
    })

    return google.drive({ version: 'v3', auth })
}

/**
 * Upload a file to Google Drive.
 * @param {string} filePath Local path to the file.
 * @param {string} fileName Target name of the file on Google Drive.
 * @param {string} mimeType Mime type of the file.
 * @returns {Promise<string>} Web view link of the uploaded file.
 */
export async function uploadToDrive(filePath, fileName, mimeType = 'video/mp4') {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Local file not found: ${filePath}`)
        }

        const drive = getDriveClient()
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID

        if (!folderId) {
            throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured in environment variables.')
        }

        logger.info(`[GDrive] Starting upload for "${fileName}" to folder "${folderId}"...`)

        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        }

        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath)
        }

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink'
        })

        const fileId = response.data.id
        logger.info(`[GDrive] Uploaded successfully! File ID: ${fileId}`)

        // Make the file readable by anyone with the link (public)
        try {
            await drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            })
            logger.info(`[GDrive] Permissions updated successfully to public link reader.`)
        } catch (permErr) {
            logger.warn(`[GDrive] Warning: Failed to set public permissions: ${permErr.message}`)
        }

        // Fetch webViewLink to return
        const fileInfo = await drive.files.get({
            fileId: fileId,
            fields: 'webViewLink'
        })

        return fileInfo.data.webViewLink
    } catch (error) {
        logger.error(`[GDrive] Error uploading file: ${error.message}`)
        throw error
    }
}
