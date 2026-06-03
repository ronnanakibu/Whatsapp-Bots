import { fetchJson, fetchBuffer } from '../src/services/downloader/utils.js'

async function testAemt() {
    try {
        const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
        const res = await fetchJson(`https://aemt.me/download/igdl?url=${encodeURIComponent(url)}`)
        console.log('AEMT Response:', res)
        
        if (res?.result?.[0]?.url) {
            console.log('Testing download speed...')
            const start = Date.now()
            const { buffer } = await fetchBuffer(res.result[0].url)
            console.log(`Downloaded ${buffer.length} bytes in ${Date.now() - start}ms`)
        }
    } catch (e) {
        console.error('Error:', e)
    }
}

testAemt()
