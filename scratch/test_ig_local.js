import dotenv from 'dotenv'
dotenv.config()

// Force no HF so it uses local providers
delete process.env.HF_API_URL

import { downloadInstagram } from '../src/services/downloader/providers/instagram.js'

async function test() {
    const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
    
    console.log('🧪 Testing Instagram download via local API providers...')
    console.log(`URL: ${url}\n`)
    
    const start = Date.now()
    try {
        const result = await downloadInstagram(url, { format: 'video' })
        const time = Date.now() - start
        
        console.log('✅ SUKSES!')
        console.log(`⏱️  Waktu Total : ${time} ms (${(time/1000).toFixed(1)}s)`)
        console.log(`📁 Filename    : ${result.filename}`)
        console.log(`📦 Size        : ${(result.buffer.length / 1024 / 1024).toFixed(2)} MB`)
        console.log(`🎬 Type        : ${result.type}`)
        console.log(`📝 Caption     : ${result.caption}`)
    } catch (err) {
        const time = Date.now() - start
        console.error(`❌ GAGAL setelah ${time}ms:`, err.message)
    }
}

test()
