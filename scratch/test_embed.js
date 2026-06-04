const start = Date.now()

fetch('https://www.instagram.com/reel/DZHF5bPiNZK/embed/', {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
})
.then(r => r.text())
.then(html => {
    const time = Date.now() - start
    
    // Try to find video_url in embed page
    const videoUrlMatch = html.match(/"video_url":"([^"]+)"/)
    if (videoUrlMatch) {
        const videoUrl = videoUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/')
        console.log(`✅ EMBED Video URL ditemukan! (${time}ms)`)
        console.log(`URL: ${videoUrl.substring(0, 150)}...`)
        
        // Now test download speed of this URL
        const dlStart = Date.now()
        fetch(videoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        .then(r => r.arrayBuffer())
        .then(buf => {
            const dlTime = Date.now() - dlStart
            console.log(`\n📦 Download: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB in ${dlTime}ms`)
            console.log(`⚡ Speed: ${(buf.byteLength / 1024 / (dlTime / 1000)).toFixed(0)} KB/s`)
        })
    } else {
        console.log(`Embed page loaded in ${time}ms`)
        console.log('Has video_url:', html.includes('video_url'))
        console.log('Has video_versions:', html.includes('video_versions'))
        
        // Try video_versions 
        const versionsMatch = html.match(/"video_versions":\[([^\]]+)\]/)
        if (versionsMatch) {
            console.log('video_versions found:', versionsMatch[1].substring(0, 300))
        }
        
        // Try any .mp4 URL
        const mp4Match = html.match(/https?:[^"'\s]+\.mp4[^"'\s]*/g)
        if (mp4Match) {
            console.log('MP4 URLs found:', mp4Match.length)
            mp4Match.forEach((u, i) => console.log(`  ${i}: ${u.substring(0, 120)}`))
        } else {
            console.log('No MP4 URLs found in embed page')
        }
    }
})
.catch(e => console.error('err:', e.message))
