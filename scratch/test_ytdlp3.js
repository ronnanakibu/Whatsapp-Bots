import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getYtdlpPath } from '../src/services/ytdlp.js'

function test() {
    const ytdlp = getYtdlpPath()
    console.log('Using yt-dlp:', ytdlp)
    const out = path.resolve('storage/media/temp/test_123.%(ext)s')
    const cmd = `"${ytdlp}" --no-warnings --write-info-json -o "${out}" https://youtu.be/qN4ooNx77u0 --extract-audio --audio-format mp3`
    console.log('Running:', cmd)
    try {
        execSync(cmd, { stdio: 'inherit' })
        console.log('Done!')
        console.log(fs.readdirSync(path.resolve('storage/media/temp')))
    } catch(e) {
        console.error('Error:', e.message)
    }
}
test()
