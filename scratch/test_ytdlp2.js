import { downloadYtdlp } from '../src/services/downloader/providers/ytdlp.js'
import fs from 'fs'

async function test() {
    console.log('Testing audio download with local yt-dlp...')
    try {
        const res = await downloadYtdlp('https://youtu.be/qN4ooNx77u0', { format: 'audio' })
        console.log('Success!', res.filename)
        console.log('Buffer size:', res.buffer.length)
        console.log('Mime:', res.mimeType)
    } catch (e) {
        console.error('Error:', e.message)
    }
}

test()
