import { fetchJson } from '../src/services/downloader/utils.js'

async function testCobalt() {
    try {
        const res = await fetchJson('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            body: JSON.stringify({
                url: 'https://www.instagram.com/reel/DZHF5bPiNZK/?igsh=MXJianMydGdweGFw'
            })
        })
        console.log('Cobalt Response:', res)
    } catch (e) {
        console.error('Error:', e)
    }
}

testCobalt()
