import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { uploadVideo } from './src/services/youtube.js'
import 'dotenv/config'

async function downloadFile(url, dest) {
    const response = await axios.get(url, { responseType: 'arraybuffer' })
    fs.writeFileSync(dest, response.data)
}

async function run() {
    console.log('=== MEMULAI PROSES UPLOAD ULANG ===')
    const tmpDir = path.resolve('./storage/media/tmp/retry_upload')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const mp3Url = "https://tempfile.aiquickdraw.com/r/c5d85b88eaf148268f73fa0b0fbb1838.mp3"
    const imgUrl = "https://musicfile.removeai.ai/MGM4MjYyN2YtZDVmOC00NzU4LWEyYjEtMzY4YjgxMWU2ZWYw.jpeg"

    const audioPath = path.join(tmpDir, 'audio.mp3')
    const imgPath = path.join(tmpDir, 'image.jpg')
    const videoPath = path.join(tmpDir, 'output.mp4')

    console.log('1. Mengunduh Audio MP3...')
    await downloadFile(mp3Url, audioPath)
    
    console.log('2. Mengunduh Thumbnail JPEG...')
    await downloadFile(imgUrl, imgPath)

    console.log('3. Merender Video dengan FFmpeg (mohon tunggu)...')
    await new Promise((resolve, reject) => {
        const cmd = `ffmpeg -y -loop 1 -i "${imgPath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${videoPath}"`
        const ffmpegProcess = exec(cmd, (error) => {
            if (error) reject(error)
            else resolve()
        })
    })

    console.log('4. Mengupload ke YouTube...')
    try {
        const youtubeUrl = await uploadVideo({
            videoPath: videoPath,
            title: "Epic Battle Music - Medieval War",
            description: "A dramatic landscape of a medieval battlefield at dusk, with a dark and ominous sky.\n\n---\nVideo ini dibuat secara otomatis menggunakan Suno API & AI.",
            tags: ["Epic Battle Music", "Medieval War", "Gothic Dark Choir", "Gregorian Chants", "Cinematic Orchestral Brass"],
            privacyStatus: 'public',
            onProgress: (p) => {
                process.stdout.write(`[YouTube] Progress: ${p.toFixed(1)}%\r`)
            }
        })
        console.log('\n\n🎉 SUKSES! Video berhasil dipublikasikan!')
        console.log('🔗 Link YouTube:', youtubeUrl)
    } catch (e) {
        console.error('\n\n❌ Gagal Upload:', e.message)
    }
    
    fs.rmSync(tmpDir, { recursive: true, force: true })
    console.log('=== SELESAI ===')
}

run().catch(console.error)
