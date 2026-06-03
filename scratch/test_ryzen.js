import { fetchJson, fetchBuffer } from '../src/services/downloader/utils.js'

async function testRyzen() {
    try {
        const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
        const res = await fetchJson(`https://api.ryzendesu.vip/api/downloader/igdl?url=${encodeURIComponent(url)}`, {
            headers: {
                'accept': 'application/json'
            }
        })
        console.log('Ryzen Response:', res)
        
        if (res?.data?.[0]?.url) {
            console.log('Testing download speed...')
            const start = Date.now()
            const { buffer } = await fetchBuffer(res.data[0].url)
            console.log(`Downloaded ${buffer.length} bytes in ${Date.now() - start}ms`)
        }
    } catch (e) {
        console.error('Error:', e)
    }
}

testRyzen()
