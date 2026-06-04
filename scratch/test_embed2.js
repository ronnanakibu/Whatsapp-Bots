fetch('https://www.instagram.com/reel/DZHF5bPiNZK/embed/', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
    }
})
.then(r => r.text())
.then(html => {
    // Search for video_url
    const idx = html.indexOf('video_url')
    if (idx > -1) {
        console.log('video_url found at:', idx)
        console.log(html.substring(idx, idx + 200))
    }
    
    // Search for .mp4
    const mp4s = [...html.matchAll(/https?:[^"'\s]*\.mp4[^"'\s]*/g)]
    console.log('\nMP4 URLs:', mp4s.length)
    mp4s.forEach((m, i) => console.log(`  ${i}: ${m[0].substring(0, 150)}`))
    
    // Search for scontent CDN
    const cdns = [...html.matchAll(/scontent[^"'\s]*/g)]
    console.log('\nscontent CDN refs:', cdns.length)
    cdns.slice(0, 5).forEach((m, i) => console.log(`  ${i}: ${m[0].substring(0, 150)}`))
    
    // Search for video_versions
    const vv = html.indexOf('video_versions')
    if (vv > -1) {
        console.log('\nvideo_versions found at:', vv)
        console.log(html.substring(vv, vv + 300))
    }
    
    // Search for any encoded video data
    const encoded = html.indexOf('\\u002F')
    if (encoded > -1) {
        // Find the context around encoded URLs
        const nearby = html.substring(Math.max(0, encoded - 50), encoded + 200)
        if (nearby.includes('video') || nearby.includes('mp4')) {
            console.log('\nEncoded video URL context:', nearby)
        }
    }
})
