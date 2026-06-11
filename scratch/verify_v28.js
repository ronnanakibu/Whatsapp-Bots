import 'dotenv/config'

// Set test environment configuration
process.env.RADIO_PORT = '29999'
process.env.NODE_ENV = 'development'
process.env.DEV_BYPASS_AUTH = 'true'
process.env.JWT_SECRET = 'my-super-secret-test-jwt-key-for-wabot-2-8'

const { startRadioServer, stopRadioServer } = await import('../src/server/radio.js')
import axios from 'axios'
import http from 'http'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function runTests() {
    console.log('🚀 Starting Backend v2.8 Verification Suite...')
    
    // Start server
    startRadioServer()
    await sleep(2000) // Wait for server to boot up
    
    const baseUrl = 'http://localhost:29999'
    let testsPassed = 0
    let totalTests = 0

    function assert(condition, message) {
        totalTests++
        if (condition) {
            console.log(`✅ [PASS] ${message}`)
            testsPassed++
        } else {
            console.error(`❌ [FAIL] ${message}`)
        }
    }

    try {
        // Test 1: GET /status
        console.log('\n--- Test 1: GET /status ---')
        try {
            const res = await axios.get(`${baseUrl}/status`)
            assert(res.status === 200, 'GET /status returns status 200')
            assert(res.data.isPlaying !== undefined, 'GET /status returns isPlaying state')
            assert(Array.isArray(res.data.queue), 'GET /status returns queue array')
        } catch (err) {
            assert(false, `GET /status failed: ${err.message}`)
        }

        // Test 2: POST /api/v2/auth/stream-token (Bypass authentication in development)
        console.log('\n--- Test 2: POST /api/v2/auth/stream-token ---')
        let streamToken = null
        try {
            const res = await axios.post(`${baseUrl}/api/v2/auth/stream-token`, {}, {
                headers: { 'User-Agent': 'Android-RonnBotClient/1.0' }
            })
            assert(res.status === 200, 'POST /auth/stream-token returns status 200')
            assert(res.data.success === true, 'Response payload envelopes with success: true')
            assert(res.data.data.token !== undefined, 'Response payload contains stream token')
            streamToken = res.data.data.token
            console.log(`Generated Token: ${streamToken}`)
        } catch (err) {
            assert(false, `POST /auth/stream-token failed: ${err.message}`)
        }

        // Test 3: Connect to /stream with valid token and User-Agent
        console.log('\n--- Test 3: Connect to /stream (Valid Token & User-Agent) ---')
        let streamClientFinished = false
        if (streamToken) {
            try {
                const urlObj = new URL(`${baseUrl}/stream?token=${streamToken}`)
                const req = http.get({
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname + urlObj.search,
                    headers: { 'User-Agent': 'Android-RonnBotClient/1.0' }
                }, (res) => {
                    assert(res.statusCode === 200, 'Connection established with 200 OK')
                    assert(res.headers['content-type'] === 'audio/mpeg', 'Content-Type header is audio/mpeg')
                    // End response immediately
                    streamClientFinished = true
                    res.destroy()
                })
                req.on('error', (err) => {
                    if (!streamClientFinished) {
                        assert(false, `Connection failed with error: ${err.message}`)
                    }
                })
                await sleep(1000)
            } catch (err) {
                assert(false, `/stream validation failed: ${err.message}`)
            }
        } else {
            assert(false, 'Skipping valid /stream test due to missing token')
        }

        // Test 4: Reconnect to /stream with consumed token (Must be rejected with 403)
        console.log('\n--- Test 4: Reconnect to /stream with consumed token (Expected 403) ---')
        if (streamToken) {
            try {
                await axios.get(`${baseUrl}/stream?token=${streamToken}`, {
                    headers: { 'User-Agent': 'Android-RonnBotClient/1.0' }
                })
                assert(false, '/stream allowed connection with consumed token')
            } catch (err) {
                assert(err.response && err.response.status === 403, 'Consumed token rejected with 403 Forbidden')
                assert(err.response.data.success === false, 'Error envelope envelopes with success: false')
                assert(err.response.data.error.code === 'FORBIDDEN', 'Error code is FORBIDDEN')
            }
        } else {
            assert(false, 'Skipping consumed token /stream test due to missing token')
        }

        // Test 5: Standardized Endpoint Envelopes (GET /api/v2/music/queue)
        console.log('\n--- Test 5: GET /api/v2/music/queue ---')
        try {
            const res = await axios.get(`${baseUrl}/api/v2/music/queue`)
            assert(res.status === 200, 'GET /music/queue returns status 200')
            assert(res.data.success === true, 'Success envelope structure has success: true')
            assert(res.data.data && Array.isArray(res.data.data.queue), 'Payload data object contains queue list')
        } catch (err) {
            assert(false, `GET /music/queue failed: ${err.message}`)
        }

        // Test 6: POST /api/v2/music/request
        console.log('\n--- Test 6: POST /api/v2/music/request ---')
        let songId = 'yt_dQw4w9WgXcQ'
        try {
            const res = await axios.post(`${baseUrl}/api/v2/music/request`, {
                query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            })
            assert(res.status === 200, 'POST /music/request returns status 200')
            assert(res.data.success === true, 'Success envelope structure has success: true')
            assert(res.data.data.track !== undefined, 'Payload data contains track details')

            // Fetch queue dynamically to get the actual songId
            const queueRes = await axios.get(`${baseUrl}/api/v2/music/queue`)
            if (queueRes.data.success && queueRes.data.data.queue.length > 0) {
                songId = queueRes.data.data.queue[0].song.songId
                console.log(`Using Dynamic Song ID: ${songId}`)
            }
        } catch (err) {
            assert(false, `POST /music/request failed: ${err.message}`)
        }

        // Test 7: POST /api/v2/songs/:songId/reactions
        console.log('\n--- Test 7: POST /api/v2/songs/:songId/reactions ---')
        try {
            const res = await axios.post(`${baseUrl}/api/v2/songs/${songId}/reactions`, {
                reaction: '👍'
            })
            assert(res.status === 200, 'POST /reactions returns status 200')
            assert(res.data.success === true, 'Success envelope structure has success: true')
            assert(res.data.data.message !== undefined, 'Payload data contains success message')
        } catch (err) {
            assert(false, `POST /reactions failed: ${err.message}`)
        }

        // Test 8: POST /api/v2/users/me/favorites
        console.log('\n--- Test 8: POST /api/v2/users/me/favorites ---')
        try {
            const res = await axios.post(`${baseUrl}/api/v2/users/me/favorites`, {
                songId: songId
            })
            assert(res.status === 200, 'POST /users/me/favorites returns status 200')
            assert(res.data.success === true, 'Success envelope structure has success: true')
        } catch (err) {
            assert(false, `POST /favorites failed: ${err.message}`)
        }

        // Test 9: GET /api/v2/users/me/favorites
        console.log('\n--- Test 9: GET /api/v2/users/me/favorites ---')
        try {
            const res = await axios.get(`${baseUrl}/api/v2/users/me/favorites`)
            assert(res.status === 200, 'GET /users/me/favorites returns status 200')
            assert(res.data.success === true, 'Success envelope has success: true')
            assert(res.data.data.favorites.length > 0, 'Favorites contains added item')
        } catch (err) {
            assert(false, `GET /favorites failed: ${err.message}`)
        }

        // Test 10: DELETE /api/v2/users/me/favorites/:songId
        console.log('\n--- Test 10: DELETE /api/v2/users/me/favorites/:songId ---')
        try {
            const res = await axios.delete(`${baseUrl}/api/v2/users/me/favorites/${songId}`)
            assert(res.status === 200, 'DELETE /users/me/favorites/:songId returns status 200')
            assert(res.data.success === true, 'Success envelope has success: true')
        } catch (err) {
            assert(false, `DELETE /favorites failed: ${err.message}`)
        }

        // Test 11: GET /api/v2/users/me/profile
        console.log('\n--- Test 11: GET /api/v2/users/me/profile ---')
        try {
            const res = await axios.get(`${baseUrl}/api/v2/users/me/profile`)
            assert(res.status === 200, 'GET /users/me/profile returns status 200')
            assert(res.data.success === true, 'Success envelope has success: true')
            assert(res.data.data.profile.userId !== undefined, 'Payload data contains userId JID')
        } catch (err) {
            assert(false, `GET /profile failed: ${err.message}`)
        }

        // Test 12: GET /api/v2/users/me/stats
        console.log('\n--- Test 12: GET /api/v2/users/me/stats ---')
        try {
            const res = await axios.get(`${baseUrl}/api/v2/users/me/stats`)
            assert(res.status === 200, 'GET /users/me/stats returns status 200')
            assert(res.data.success === true, 'Success envelope has success: true')
            assert(res.data.data.stats.totalListeningHours !== undefined, 'Payload data contains listening stats')
        } catch (err) {
            assert(false, `GET /stats failed: ${err.message}`)
        }

        // Test 13: GET /api/v2/system/metrics
        console.log('\n--- Test 13: GET /api/v2/system/metrics ---')
        try {
            const res = await axios.get(`${baseUrl}/api/v2/system/metrics`)
            assert(res.status === 200, 'GET /system/metrics returns status 200')
            assert(res.data.success === true, 'Success envelope has success: true')
            assert(res.data.data.metrics.cpuUsage !== undefined, 'Payload data contains cpuUsage')
        } catch (err) {
            assert(false, `GET /system/metrics failed: ${err.message}`)
        }

        // Test 14: SSE Replay (Last-Event-ID)
        console.log('\n--- Test 14: SSE Replay (Last-Event-ID) ---')
        try {
            // Trigger a reaction to push an event with a specific ID into the buffer
            const reactionRes = await axios.post(`${baseUrl}/api/v2/songs/${songId}/reactions`, {
                reaction: '🔥'
            })
            const reactionRequestId = reactionRes.headers['x-request-id']

            // Request events from a clean history or replay past
            const sseResponse = await axios.get(`${baseUrl}/events?lastEventId=0`, {
                responseType: 'stream'
            })

            let receivedData = ''
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    sseResponse.data.destroy()
                    resolve()
                }, 1000)

                sseResponse.data.on('data', (chunk) => {
                    receivedData += chunk.toString()
                })
            })

            assert(receivedData.includes('event: engagement:reaction'), 'SSE event engagement:reaction replayed')
            assert(receivedData.includes('"correlationId":'), 'Replayed reaction event contains correlationId')
            assert(receivedData.includes(reactionRequestId), 'Replayed event matches reaction request correlationId')
        } catch (err) {
            assert(false, `SSE replay verification failed: ${err.message}`)
        }

    } catch (testErr) {
        console.error('Fatal Test Runner Error:', testErr)
    } finally {
        // Shutdown server
        console.log('\n⚙ Shutting down verification server...')
        stopRadioServer()
        await sleep(1000)
        
        console.log('\n=======================================')
        console.log(`TEST RUNNER SUMMARY: ${testsPassed} / ${totalTests} passed.`)
        console.log('=======================================')
        
        if (testsPassed === totalTests) {
            console.log('🏁 VERIFICATION SUITE SUCCESSFUL! 🎉')
            process.exit(0)
        } else {
            console.error('🏁 VERIFICATION SUITE FAILED! 😿')
            process.exit(1)
        }
    }
}

runTests()
