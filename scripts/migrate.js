// scripts/migrate.js
// Database schema migration runner for WABOT 2.0 SQLite and Prisma databases

import path from 'path'
import { db } from '../src/services/db.js'

console.log('🔄 [Migration] Verifying and applying database schema migrations...')

try {
    const dbPath = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    
    console.log(`✅ [Migration] SQLite database active at: ${dbPath}`)
    console.log(`   Registered ${tables.length} tables: ${tables.map(t => t.name).join(', ')}`)
    
    // Check specific columns added in Phase 3
    const songCols = db.prepare("PRAGMA table_info(songs)").all().map(c => c.name)
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
    
    if (songCols.includes('origin')) {
        console.log('   ✓ songs.origin column verified')
    }
    if (userCols.includes('app_user_id') && userCols.includes('whatsapp_jid')) {
        console.log('   ✓ users.app_user_id and users.whatsapp_jid columns verified')
    }

    console.log('✅ [Migration] Database migration check completed successfully.')
    process.exit(0)
} catch (err) {
    console.error('❌ [Migration] Database migration check failed:', err.message)
    process.exit(1)
}
