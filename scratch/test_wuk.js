import { fetchJson, fetchBuffer } from '../src/services/downloader/utils.js'

async function testCobaltWuk() {
    try {
        const url = 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
        const res = await fetchJson('https://co.wuk.sh/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                aFormat: 'mp3',
                vQuality: '1080',
                isAudioOnly: false
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

testCobaltWuk()
