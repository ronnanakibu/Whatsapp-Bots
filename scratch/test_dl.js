import dotenv from 'dotenv'
import { download } from '../src/services/downloader/index.js'

dotenv.config()

async function testDl() {
    console.log('Testing HF API with cookies...')
    const start = Date.now()
    try {
        const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
        const result = await download(url, { format: 'video' })
        const time = Date.now() - start
        
        console.log('✅ SUKSES DOWNLOAD!')
        console.log(`Waktu   : ${time} ms`)
        console.log(`File    : ${result.filename}`)
        console.log(`Size    : ${Math.round(result.buffer.length / 1024 / 1024 * 100) / 100} MB`)
        console.log(`Caption : ${result.caption}`)
    } catch (err) {
        console.error('❌ ERROR:', err.message)
    }
}

testDl()
