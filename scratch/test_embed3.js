import https from 'https'

function fetchHtml(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            family: 4,
            timeout,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchHtml(res.headers.location, timeout).then(resolve).catch(reject)
            }
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => resolve(data))
            res.on('error', reject)
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${timeout}ms`)) })
    })
}

async function test() {
    const shortcode = 'DZHF5bPiNZK'
    const embedUrl = `https://www.instagram.com/reel/${shortcode}/embed/`
    
    console.log('Fetching embed page...')
    const html = await fetchHtml(embedUrl)
    console.log('HTML length:', html.length)
    
    // Method 1: Direct video_url
    const m1 = html.match(/"video_url":"([^"]+)"/)
    console.log('\nMethod 1 (direct):', m1 ? 'FOUND' : 'NOT FOUND')
    
    // Method 2: Escaped video_url  
    const m2 = html.match(/\\"video_url\\":\\"([^"]*?)\\"/)
    console.log('Method 2 (escaped \\"):', m2 ? 'FOUND' : 'NOT FOUND')
    if (m2) console.log('  Value:', m2[1].substring(0, 150))
    
    // Method 3: Double-escaped
    const m3 = html.match(/\\\\?"video_url\\\\?":\\\\?"(https?:[^"\\]*(?:\\\\.[^"\\]*)*)\\\\?"/)
    console.log('Method 3 (double-escaped):', m3 ? 'FOUND' : 'NOT FOUND')
    
    // Method 4: Just find any fbcdn video URL
    const m4 = html.match(/https?:\\\\?\/\\\\?\/[^"'\s]*fbcdn\.net[^"'\s]*\.mp4[^"'\s]*/g)
    console.log('Method 4 (fbcdn mp4):', m4 ? `FOUND (${m4.length})` : 'NOT FOUND')
    if (m4) {
        m4.forEach((u, i) => {
            const clean = u.replace(/\\\\\//g, '/').replace(/\\\//g, '/').replace(/\\u0026/g, '&')
            console.log(`  ${i}: ${clean.substring(0, 150)}`)
        })
    }
    
    // Show context around video_url mention
    const idx = html.indexOf('video_url')
    if (idx > -1) {
        console.log('\nContext around video_url:')
        console.log(html.substring(Math.max(0, idx - 20), idx + 250))
    }
}

test().catch(console.error)
