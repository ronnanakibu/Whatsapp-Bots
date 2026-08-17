import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { logger } from '../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')

// Pastikan direktori database ada
const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
}

// Inisialisasi Database Singleton
export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = -8000')
db.pragma('foreign_keys = ON')

// 1. Skema Tabel Utama
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        jid TEXT PRIMARY KEY,
        name TEXT,
        commands_count INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        role TEXT DEFAULT 'user' CHECK(role IN ('owner', 'admin', 'user')),
        last_seen INTEGER,
        level INTEGER DEFAULT 1,
        experience_points INTEGER DEFAULT 0,
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS songs (
        song_id TEXT PRIMARY KEY, -- Hash / YT Video ID
        title TEXT NOT NULL,
        artist TEXT DEFAULT 'Unknown',
        duration INTEGER NOT NULL, -- Dalam detik
        thumbnail_url TEXT,
        source TEXT NOT NULL CHECK(source IN ('youtube', 'soundcloud')),
        stream_url TEXT NOT NULL,
        genre TEXT DEFAULT 'General',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS listening_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        left_at INTEGER,
        duration_seconds INTEGER DEFAULT 0,
        FOREIGN KEY(user_jid) REFERENCES users(jid) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON listening_sessions(user_jid, joined_at);

    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid TEXT NOT NULL,
        song_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'playing', 'played', 'rejected')),
        played_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(user_jid) REFERENCES users(jid),
        FOREIGN KEY(song_id) REFERENCES songs(song_id)
    );
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, created_at);

    CREATE TABLE IF NOT EXISTS dedications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL UNIQUE,
        dedicated_to TEXT NOT NULL,
        message TEXT,
        FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT NOT NULL,
        requested_by_jid TEXT,
        played_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed INTEGER DEFAULT 1,
        skipped_at_second INTEGER DEFAULT 0,
        FOREIGN KEY(song_id) REFERENCES songs(song_id),
        FOREIGN KEY(requested_by_jid) REFERENCES users(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_history_played ON play_history(played_at DESC);

    CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid TEXT NOT NULL,
        song_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(user_jid) REFERENCES users(jid),
        FOREIGN KEY(song_id) REFERENCES songs(song_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_lookup ON reactions(song_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS favorites (
        user_jid TEXT NOT NULL,
        song_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY(user_jid, song_id),
        FOREIGN KEY(user_jid) REFERENCES users(jid) ON DELETE CASCADE,
        FOREIGN KEY(song_id) REFERENCES songs(song_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS achievements (
        achievement_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        criteria_type TEXT NOT NULL, -- 'listening_hours', 'requests_count', 'streak'
        criteria_value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievement_unlocks (
        user_jid TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY(user_jid, achievement_id),
        FOREIGN KEY(user_jid) REFERENCES users(jid) ON DELETE CASCADE,
        FOREIGN KEY(achievement_id) REFERENCES achievements(achievement_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wrapped (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid TEXT NOT NULL,
        year INTEGER NOT NULL,
        listening_seconds INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,
        favorite_artist TEXT,
        favorite_song_id TEXT,
        top_genre TEXT,
        percentile REAL,
        FOREIGN KEY(user_jid) REFERENCES users(jid),
        FOREIGN KEY(favorite_song_id) REFERENCES songs(song_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wrapped_year ON wrapped(user_jid, year);

    CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_jid TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_lookup ON playlists(user_jid, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS playlist_songs (
        playlist_id INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        added_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY(playlist_id, song_id),
        FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY(song_id) REFERENCES songs(song_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_store (
        id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        push_name TEXT,
        message_type TEXT NOT NULL,
        body TEXT,
        raw_message TEXT NOT NULL,
        media_path TEXT,
        is_view_once INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_msg_store_lookup ON message_store(chat_jid, id);
    CREATE INDEX IF NOT EXISTS idx_msg_store_created ON message_store(created_at);
`)

// 2. Safe Migration untuk database lama
try { db.exec('ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1') } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN experience_points INTEGER DEFAULT 0') } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER') } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN created_at INTEGER NOT NULL DEFAULT (unixepoch())') } catch (_) {}
try { db.exec('ALTER TABLE songs ADD COLUMN genre TEXT DEFAULT "General"') } catch (_) {}
try { db.exec('ALTER TABLE play_history ADD COLUMN completed INTEGER DEFAULT 1') } catch (_) {}
try { db.exec('ALTER TABLE play_history ADD COLUMN skipped_at_second INTEGER DEFAULT 0') } catch (_) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at)') } catch (_) {}

// 3. Seeding Default Achievements
try {
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM achievements')
    const result = checkStmt.get()
    if (result.count === 0) {
        const insertStmt = db.prepare('INSERT INTO achievements (achievement_id, name, description, criteria_type, criteria_value) VALUES (?, ?, ?, ?, ?)')
        const seedData = [
            ['first_request', 'First Request', 'Anda membuat request lagu pertama!', 'requests_count', 1],
            ['req_10', 'Pencinta Musik', 'Anda merequest 10 lagu!', 'requests_count', 10],
            ['req_50', 'Kurator Radio', 'Anda merequest 50 lagu!', 'requests_count', 50],
            ['listen_1h', 'Pendengar Setia', 'Mendengarkan radio selama 1 jam!', 'listening_hours', 1],
            ['listen_10h', 'Pendengar Loyal', 'Mendengarkan radio selama 10 jam!', 'listening_hours', 10],
            ['listen_50h', 'Residen Radio', 'Mendengarkan radio selama 50 jam!', 'listening_hours', 50],
            ['streak_3', 'Regular Jammer', 'Mendengarkan radio 3 hari berturut-turut!', 'streak', 3],
            ['streak_7', 'Satu Minggu Penuh', 'Mendengarkan radio 7 hari berturut-turut!', 'streak', 7]
        ]
        const transaction = db.transaction((items) => {
            for (const item of items) {
                insertStmt.run(...item)
            }
        })
        transaction(seedData)
        logger.info('[DB] Seeded default achievements.')
    }
} catch (e) {
    logger.error('[DB] Failed to seed achievements:', e.message)
}

export class DBService {
    getUser(jid) {
        return db.prepare('SELECT * FROM users WHERE jid = ?').get(jid)
    }

    upsertUser(jid, data) {
        const name = data.name || jid.split('@')[0]
        const xp = data.xp ?? 0
        return db.prepare(`
            INSERT INTO users (jid, name, experience_points) VALUES (?, ?, ?)
            ON CONFLICT(jid) DO UPDATE SET name=excluded.name, experience_points=excluded.experience_points, last_seen_at=unixepoch()
        `).run(jid, name, xp)
    }

    // ── MESSAGE STORE (ANTI-SNITCH / PERSISTENCE) ──

    saveMessage({ id, chatJid, senderJid, pushName, messageType, body, rawMessage, mediaPath = null, isViewOnce = 0 }) {
        try {
            return db.prepare(`
                INSERT INTO message_store (id, chat_jid, sender_jid, push_name, message_type, body, raw_message, media_path, is_view_once)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    body = excluded.body,
                    raw_message = excluded.raw_message,
                    media_path = COALESCE(excluded.media_path, message_store.media_path),
                    is_view_once = excluded.is_view_once
            `).run(id, chatJid, senderJid, pushName, messageType, body, rawMessage, mediaPath, isViewOnce ? 1 : 0)
        } catch (err) {
            logger.error(`[DB] Failed to save message ${id}:`, err.message)
            return null
        }
    }

    getMessage(chatJid, id) {
        try {
            if (chatJid) {
                return db.prepare('SELECT * FROM message_store WHERE chat_jid = ? AND id = ?').get(chatJid, id)
            }
            return db.prepare('SELECT * FROM message_store WHERE id = ?').get(id)
        } catch (err) {
            logger.error(`[DB] Failed to get message ${id}:`, err.message)
            return null
        }
    }

    updateMessageMediaPath(id, mediaPath) {
        try {
            return db.prepare('UPDATE message_store SET media_path = ? WHERE id = ?').run(mediaPath, id)
        } catch (err) {
            logger.error(`[DB] Failed to update media_path for ${id}:`, err.message)
            return null
        }
    }

    pruneMessages(days = 14) {
        try {
            const cutoff = Math.floor(Date.now() / 1000) - (days * 86400)
            const result = db.prepare('DELETE FROM message_store WHERE created_at < ?').run(cutoff)
            logger.info(`[DB] Pruned ${result.changes} old messages from message_store (> ${days} days).`)
            return result.changes
        } catch (err) {
            logger.error('[DB] Failed to prune messages:', err.message)
            return 0
        }
    }
}

export const dbService = new DBService()