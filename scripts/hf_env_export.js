#!/usr/bin/env node
/**
 * hf_env_export.js
 * 
 * Membaca file .env lokal dan menghasilkan daftar Secrets & Variables
 * yang siap dimasukkan ke Hugging Face Space Settings (Variables & Secrets).
 * 
 * Penggunaan:
 *   node scripts/hf_env_export.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.join(__dirname, '..', '.env')

if (!fs.existsSync(envPath)) {
    console.error('❌ File .env tidak ditemukan di:', envPath)
    process.exit(1)
}

const content = fs.readFileSync(envPath, 'utf8')

// Variables to SKIP (tidak relevan di Hugging Face Spaces)
const SKIP_VARS = new Set([
    // SFTP / Pterodactyl host lama
    'SFTP_BASIC_HOST', 'SFTP_BASIC_PORT', 'SFTP_BASIC_USERNAME', 'SFTP_BASIC_PASSWORD',
    'SFTP_LITE_HOST', 'SFTP_LITE_PORT', 'SFTP_LITE_USERNAME', 'SFTP_LITE_PASSWORD',
    'SFTP_HOST', 'SFTP_PORT', 'SFTP_USERNAME', 'SFTP_PASSWORD',
    'PTERO_API_KEY', 'PTERO_URL',

    // Radio host / port lama Pterodactyl / Railway
    'RADIO_HOST_BASIC', 'RADIO_PORT_BASIC',
    'RADIO_HOST_LITE', 'RADIO_PORT_LITE',

    // Node env & paths (sudah diatur di Dockerfile)
    'NODE_ENV',
    'SESSION_PATH',
    'DB_PATH',
])

const vars = []
let multilineKey = null
let multilineValue = ''

const lines = content.split('\n')
for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (multilineKey) {
        multilineValue += '\n' + line
        if (trimmed.endsWith('"') && !trimmed.endsWith('\\"')) {
            vars.push({
                key: multilineKey,
                value: multilineValue.slice(1, -1)
            })
            multilineKey = null
            multilineValue = ''
        }
        continue
    }

    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.substring(0, eqIndex).trim()
    let value = trimmed.substring(eqIndex + 1).trim()

    if (SKIP_VARS.has(key)) continue

    if (value.startsWith('"') && !value.endsWith('"')) {
        multilineKey = key
        multilineValue = value
        continue
    }

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
    }

    vars.push({ key, value })
}

console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║       🤗 Hugging Face Spaces Environment Variables           ║')
console.log('╠══════════════════════════════════════════════════════════════╣')
console.log(`║  Total: ${vars.length} variables siap dimigrasi ke HF Secrets        ║`)
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()

console.log('━'.repeat(60))
console.log('📌 LANGKAH DI HUGGING FACE:')
console.log('1. Buka Space kamu di Hugging Face → Tab "Settings"')
console.log('2. Scroll ke bagian "Variables and secrets"')
console.log('3. Tambahkan "New secret" untuk setiap entri penting di bawah ini.')
console.log('━'.repeat(60))
console.log()

for (const { key, value } of vars) {
    const escaped = value.replace(/\n/g, '\\n')
    if (escaped.length > 120) {
        console.log(`[SECRET] ${key} = ${escaped.substring(0, 60)}... (${escaped.length} chars)`)
    } else {
        console.log(`[SECRET] ${key} = ${escaped}`)
    }
}

// Simpan file env helper
const outputPath = path.join(__dirname, '..', 'hf_env_bulk.txt')
const bulkContent = vars.map(({ key, value }) => {
    const escaped = value.replace(/\n/g, '\\n')
    return `${key}=${escaped}`
}).join('\n') + '\nPORT=7860\nRADIO_LISTEN_HOST=0.0.0.0\n'

fs.writeFileSync(outputPath, bulkContent, 'utf8')
console.log()
console.log(`✅ File raw disimpan di: ${outputPath}`)
console.log('   (File ini diabaikan oleh git demi keamanan kredensial)')
