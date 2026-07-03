// scripts/youtube-auth.js
import { google } from 'googleapis'
import http from 'http'
import { exec } from 'child_process'
import 'dotenv/config'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const PORT = 8085
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\x1b[31m[Error] YOUTUBE_CLIENT_ID atau YOUTUBE_CLIENT_SECRET belum diatur di .env!\x1b[0m')
    console.log('Silakan buat OAuth 2.0 Client ID di Google Cloud Console, lalu tambahkan ke .env')
    process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
)

const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
]

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Enforce offline access / refresh token delivery
})

console.log('\n\x1b[36m=== YOUTUBE OAUTH2 AUTHENTICATION HELPER ===\x1b[0m\n')
console.log('Menjalankan server autentikasi lokal pada port', PORT)
console.log('Membuka browser untuk otorisasi Google Account...')

const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/oauth2callback')) {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`)
        const code = urlParams.searchParams.get('code')

        if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
                <html>
                    <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0c0f16; color: #fff;">
                        <h2 style="color: #22c55e;">Otorisasi Sukses!</h2>
                        <p>Token berhasil diambil. Silakan periksa terminal Anda untuk menyalin refresh token.</p>
                        <p style="color: #64748b;">Anda sekarang bisa menutup halaman ini.</p>
                    </body>
                </html>
            `)

            try {
                const { tokens } = await oauth2Client.getToken(code)
                console.log('\n\x1b[32m✔ Autentikasi Berhasil!\x1b[0m\n')
                console.log('Salin token berikut dan tambahkan ke file .env Anda:\n')
                console.log(`\x1b[33mYOUTUBE_REFRESH_TOKEN="${tokens.refresh_token}"\x1b[0m\n`)
            } catch (err) {
                console.error('\x1b[31mGagal menukarkan kode otorisasi:\x1b[0m', err.message)
            } finally {
                server.close(() => {
                    console.log('Server autentikasi dimatikan. Selesai.')
                    process.exit(0)
                })
            }
        } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Kode otorisasi tidak ditemukan.')
        }
    }
})

server.listen(PORT, () => {
    console.log(`\nSilakan kunjungi URL ini jika browser tidak terbuka otomatis:\n\n\x1b[34m${authUrl}\x1b[0m\n`)
    
    // Open URL in default browser
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    exec(`${startCmd} "${authUrl.replace(/&/g, '^&')}"`, (err) => {
        if (err) {
            console.log('Browser gagal dibuka otomatis. Silakan salin link di atas secara manual.')
        }
    })
})
