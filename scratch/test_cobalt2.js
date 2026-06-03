import { fetchJson, fetchBuffer } from '../src/services/downloader/utils.js'

async function testCobalt2() {
    try {
        const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
        const res = await fetchJson('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Origin': 'https://cobalt.tools',
                'Referer': 'https://cobalt.tools/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({
                url: url
            })
        })
        console.log('Cobalt Response:', res)
        
        if (res?.url) {
            console.log('Testing download speed...')
            const start = Date.now()
            const { buffer } = await fetchBuffer(res.url)
            console.log(`Downloaded ${buffer.length} bytes in ${Date.now() - start}ms`)
        }
    } catch (e) {
        console.error('Error:', e)
    }
}

testCobalt2()
