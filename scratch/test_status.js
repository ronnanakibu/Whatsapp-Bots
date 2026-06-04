async function run() {
    try {
        console.log('Sending request to http://localhost:25637/status ...')
        const res = await fetch('http://localhost:25637/status')
        const data = await res.json()
        console.log('Success! Status payload:', JSON.stringify(data, null, 2))
    } catch (e) {
        console.error('Fetch failed:', e.message)
    }
}
run()
