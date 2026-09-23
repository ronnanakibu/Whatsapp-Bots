#!/usr/bin/env node
/**
 * railway_env_export.js
 * 
 * Reads the local .env file and generates Railway CLI commands
 * to set all environment variables in one go.
 * 
 * Usage:
 *   node railway_env_export.js
 * 
 * Output: A list of `railway variables set` commands, or a
 *         bulk-paste-friendly format for Railway Dashboard.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.join(__dirname, '..', '.env')

if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found at:', envPath)
    process.exit(1)
}

const content = fs.readFileSync(envPath, 'utf8')

// Variables to SKIP (not needed on Railway, or auto-provided)
const SKIP_VARS = new Set([
    // SFTP/Pterodactyl — not needed on Railway
    'SFTP_BASIC_HOST', 'SFTP_BASIC_PORT', 'SFTP_BASIC_USERNAME', 'SFTP_BASIC_PASSWORD',
    'SFTP_LITE_HOST', 'SFTP_LITE_PORT', 'SFTP_LITE_USERNAME', 'SFTP_LITE_PASSWORD',
    'SFTP_HOST', 'SFTP_PORT', 'SFTP_USERNAME', 'SFTP_PASSWORD',
    
    // Pterodactyl panel API — not needed on Railway
    'PTERO_API_KEY', 'PTERO_URL',

    // Radio host/port configs specific to Pterodactyl
    'RADIO_HOST_BASIC', 'RADIO_PORT_BASIC',
    'RADIO_HOST_LITE', 'RADIO_PORT_LITE',
    'RADIO_HOST',    // Railway provides its own public URL
    'RADIO_PORT',    // Railway injects PORT automatically

    // Database — Railway auto-provides DATABASE_URL from managed PostgreSQL
    'DATABASE_URL',
    
    // Node env — set separately in Dockerfile
    'NODE_ENV',

    // Session/DB paths — use defaults (volume-mounted at /app/storage)
    'SESSION_PATH',
    'DB_PATH',
])

// Parse .env
const vars = []
let multilineKey = null
let multilineValue = ''

const lines = content.split('\n')
for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Handle multiline values (quoted strings spanning multiple lines)
    if (multilineKey) {
        multilineValue += '\n' + line
        // Check if this line ends the multiline value
        if (trimmed.endsWith('"') && !trimmed.endsWith('\\"')) {
            vars.push({
                key: multilineKey,
                value: multilineValue.slice(1, -1) // Remove surrounding quotes
            })
            multilineKey = null
            multilineValue = ''
        }
        continue
    }

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.substring(0, eqIndex).trim()
    let value = trimmed.substring(eqIndex + 1).trim()

    // Skip excluded vars
    if (SKIP_VARS.has(key)) continue

    // Check for multiline start
    if (value.startsWith('"') && !value.endsWith('"')) {
        multilineKey = key
        multilineValue = value
        continue
    }

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
    }

    vars.push({ key, value })
}

// Output
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║        🚂 Railway Environment Variables Export              ║')
console.log('╠══════════════════════════════════════════════════════════════╣')
console.log(`║  Total: ${vars.length} variables (${SKIP_VARS.size} skipped)`)
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log()

// Format 1: Railway Dashboard bulk paste
console.log('━'.repeat(60))
console.log('📋 COPY-PASTE INTO RAILWAY DASHBOARD (Raw Editor / Bulk Import)')
console.log('━'.repeat(60))
console.log()

for (const { key, value } of vars) {
    // For multiline values, escape newlines
    const escaped = value.replace(/\n/g, '\\n')
    
    // Truncate very long values for display (like SUNO_COOKIE)
    if (escaped.length > 200) {
        console.log(`${key}=${escaped.substring(0, 80)}...`)
        console.log(`  ⚠️  (${escaped.length} chars — copy full value from .env)`)
    } else {
        console.log(`${key}=${escaped}`)
    }
}

console.log()
console.log('━'.repeat(60))
console.log('⚠️  ADDITIONAL VARIABLES TO SET MANUALLY IN RAILWAY:')
console.log('━'.repeat(60))
console.log()
console.log('RADIO_LISTEN_HOST=0.0.0.0')
console.log()
console.log('# Also add this reference to your PostgreSQL service:')
console.log('# DATABASE_URL=${{Postgres.DATABASE_URL}}')
console.log()

// Also write a clean file for easy bulk import
const outputPath = path.join(__dirname, '..', 'railway_env_bulk.txt')
const bulkContent = vars.map(({ key, value }) => {
    const escaped = value.replace(/\n/g, '\\n')
    return `${key}=${escaped}`
}).join('\n') + '\nRADIO_LISTEN_HOST=0.0.0.0\n'

fs.writeFileSync(outputPath, bulkContent, 'utf8')
console.log(`✅ Bulk import file saved to: ${outputPath}`)
console.log('   → Copy contents of this file into Railway Dashboard → Variables → Raw Editor')
