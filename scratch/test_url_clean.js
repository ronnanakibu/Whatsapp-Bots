import https from 'https'

function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            },
            family: 4,
        }, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => resolve(data))
        }).on('error', reject)
    })
}

async function test() {
    const html = await fetchHtml('https://www.instagram.com/reel/DZHF5bPiNZK/embed/')
    
    const match = html.match(/\\"video_url\\":\\"(https?:[^"]*?)\\"/)
    console.log('Raw match:', match[1].substring(0, 200))
    
    // Clean it step by step
    let url = match[1]
    console.log('\nStep 0:', url.substring(0, 100))
    
    url = url.replace(/\\\\\//g, '/')
    console.log('Step 1 (replace \\\\//):', url.substring(0, 100))
    
    url = url.replace(/\\\//g, '/')
    console.log('Step 2 (replace \\/):', url.substring(0, 100))
    
    url = url.replace(/\\u0026/g, '&')
    console.log('Step 3 (replace \\u0026):', url.substring(0, 100))
    
    console.log('\nFinal URL:', url.substring(0, 200))
    
    // Test download
    const start = Date.now()
    https.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Referer': 'https://www.instagram.com/',
            'Accept': '*/*',
        },
        family: 4,
    }, (res) => {
        console.log('\nDownload status:', res.statusCode)
        console.log('Content-Type:', res.headers['content-type'])
        console.log('Content-Length:', res.headers['content-length'])
        let size = 0
        res.on('data', c => size += c.length)
        res.on('end', () => {
            console.log(`Downloaded: ${(size/1024/1024).toFixed(2)} MB in ${Date.now()-start}ms`)
        })
    }).on('error', e => console.error('Download error:', e.message))
}

test().catch(console.error)
