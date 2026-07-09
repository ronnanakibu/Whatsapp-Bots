// src/server/routes/users.js
import express from 'express'
import { prisma } from '../../config/database.js'
import { userService } from '../../services/user-v2.js'
import { authenticateJwt, verifyJwt } from '../middleware/auth.js'
import { db, io, broadcastSSE, resolveSongId } from '../radio.js'

const router = express.Router()

router.post('/users/me/favorites', authenticateJwt, (req, res) => {
    const resolvedSongId = resolveSongId(req.body.songId)
    const userJid = req.user.jid
    if (!resolvedSongId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: 'songId wajib diisi.'
            }
        })
    }
    try {
        db.prepare('INSERT INTO favorites (user_jid, song_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(userJid, resolvedSongId)
        
        // Broadcast favorite event to SSE
        broadcastSSE('engagement:favorite', { userJid, songId: resolvedSongId }, req.id)
        io?.emit('engagement:favorite', { userJid, songId: resolvedSongId })

        res.json({
            success: true,
            data: {
                message: 'Lagu ditambahkan ke favorit!'
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.delete('/users/me/favorites/:songId', authenticateJwt, (req, res) => {
    const resolvedSongId = resolveSongId(req.params.songId)
    const userJid = req.user.jid
    try {
        db.prepare('DELETE FROM favorites WHERE user_jid = ? AND song_id = ?').run(userJid, resolvedSongId)
        res.json({
            success: true,
            data: {
                message: 'Lagu dihapus dari favorit!'
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/users/me/favorites', authenticateJwt, (req, res) => {
    const userJid = req.user.jid
    try {
        const rows = db.prepare(`
            SELECT s.song_id, s.title, s.artist, s.thumbnail_url, s.duration, f.created_at
            FROM favorites f
            JOIN songs s ON f.song_id = s.song_id
            WHERE f.user_jid = ?
            ORDER BY f.created_at DESC
        `).all(userJid)
        res.json({
            success: true,
            data: {
                favorites: rows.map(r => ({
                    songId: r.song_id,
                    title: r.title,
                    artist: r.artist,
                    thumbnailUrl: r.thumbnail_url,
                    duration: r.duration,
                    createdAt: r.created_at
                }))
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/users/me/profile', authenticateJwt, async (req, res) => {
    const userJid = req.user.jid
    try {
        const profile = await userService.getProfile(userJid)
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Profil tidak ditemukan.'
                }
            })
        }

        res.json({
            success: true,
            data: {
                profile: {
                    userId: profile.id,
                    name: profile.nickname,
                    avatarUrl: profile.avatarUrl,
                    bannerUrl: profile.bannerUrl,
                    bio: profile.bio,
                    level: 1,
                    experiencePoints: profile.stats ? Number(profile.stats.listeningTimeMs) : 0,
                    role: 'user',
                    achievementsUnlocked: profile.stats ? profile.stats.achievementsEarned : 0,
                    topFavorites: []
                }
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.put('/users/me/profile', authenticateJwt, async (req, res) => {
    const { nickname, bio, avatarUrl, bannerUrl } = req.body
    try {
        const updated = await userService.updateProfile(req.user.jid, {
            nickname,
            bio,
            avatarUrl,
            bannerUrl
        })
        res.json({
            success: true,
            profile: updated
        })
    } catch (err) {
        res.status(400).json({ success: false, error: err.message })
    }
})

router.get('/users/:userJid/profile', async (req, res) => {
    const { userJid } = req.params
    try {
        const profile = await userService.getProfile(userJid)
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Profil tidak ditemukan.'
                }
            })
        }

        res.json({
            success: true,
            data: {
                profile: {
                    userId: profile.id,
                    name: profile.nickname,
                    avatarUrl: profile.avatarUrl,
                    bannerUrl: profile.bannerUrl,
                    bio: profile.bio,
                    level: 1,
                    experiencePoints: profile.stats ? Number(profile.stats.listeningTimeMs) : 0,
                    role: 'user',
                    achievementsUnlocked: profile.stats ? profile.stats.achievementsEarned : 0,
                    topFavorites: []
                }
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/users/me/stats', authenticateJwt, async (req, res) => {
    const userJid = req.user.jid
    try {
        const stats = await prisma.userStats.findUnique({ where: { userId: userJid } })
        const totalListenSec = stats ? Number(stats.listeningTimeMs / 1000n) : 0
        const requestsCount = stats ? stats.songsRequested : 0

        res.json({
            success: true,
            data: {
                stats: {
                    totalListeningHours: parseFloat((totalListenSec / 3600).toFixed(2)),
                    totalRequestsCount: requestsCount,
                    favoriteArtist: '—',
                    favoriteSong: '—',
                    currentListeningStreak: 1,
                    longestListeningStreak: 3
                }
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/users/:userJid/stats', async (req, res) => {
    const { userJid } = req.params
    try {
        const stats = await prisma.userStats.findUnique({ where: { userId: userJid } })
        const totalListenSec = stats ? Number(stats.listeningTimeMs / 1000n) : 0
        const requestsCount = stats ? stats.songsRequested : 0

        res.json({
            success: true,
            data: {
                stats: {
                    totalListeningHours: parseFloat((totalListenSec / 3600).toFixed(2)),
                    totalRequestsCount: requestsCount,
                    favoriteArtist: '—',
                    favoriteSong: '—',
                    currentListeningStreak: 1,
                    longestListeningStreak: 3
                }
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/leaderboard', async (req, res) => {
    const { timeframe } = req.query
    try {
        const rows = await prisma.userStats.findMany({
            orderBy: {
                listeningTimeMs: 'desc'
            },
            take: 10,
            include: {
                user: {
                    select: {
                        nickname: true
                    }
                }
            }
        })

        const leaderboard = rows.map((row, idx) => ({
            rank: idx + 1,
            name: row.user.nickname,
            userId: row.userId,
            listeningTimeSeconds: Number(row.listeningTimeMs / 1000n),
            level: 1
        }))

        res.json({
            success: true,
            data: {
                timeframe: timeframe || 'global',
                leaderboard
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/achievements', (req, res) => {
    let userJid = req.query.userJid
    if (!userJid && req.headers['authorization']) {
        const authHeader = req.headers['authorization']
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7)
            const payload = verifyJwt(token)
            if (payload && payload.jid) {
                userJid = payload.jid
            }
        }
    }
    try {
        const list = db.prepare('SELECT * FROM achievements').all()
        const unlocked = userJid ? new Set(
            db.prepare('SELECT achievement_id FROM achievement_unlocks WHERE user_jid = ?').all(userJid).map(r => r.achievement_id)
        ) : new Set()

        const formatted = list.map(ach => ({
            achievementId: ach.achievement_id,
            name: ach.name,
            description: ach.description,
            unlocked: unlocked.has(ach.achievement_id)
        }))

        res.json({
            success: true,
            data: {
                achievements: formatted
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

router.get('/wrapped/:year', (req, res) => {
    const { year } = req.params
    let userJid = req.query.userJid
    if (!userJid && req.headers['authorization']) {
        const authHeader = req.headers['authorization']
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7)
            const payload = verifyJwt(token)
            if (payload && payload.jid) {
                userJid = payload.jid
            }
        }
    }
    if (!userJid) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: 'userJid wajib diisi.'
            }
        })
    }

    try {
        let cached = db.prepare('SELECT * FROM wrapped WHERE user_jid = ? AND year = ?').get(userJid, parseInt(year))

        if (!cached) {
            const totalListenSec = db.prepare('SELECT SUM(duration_seconds) as total FROM listening_sessions WHERE user_jid = ?').get(userJid)?.total || 0
            const totalReqs = db.prepare("SELECT COUNT(*) as count FROM requests WHERE user_jid = ? AND status = 'played'").get(userJid)?.count || 0

            const topArtistRow = db.prepare(`
                SELECT s.artist, COUNT(*) as count
                FROM play_history h
                JOIN songs s ON h.song_id = s.song_id
                WHERE h.requested_by_jid = ?
                GROUP BY s.artist
                ORDER BY count DESC
                LIMIT 1
            `).get(userJid)

            const topSongRow = db.prepare(`
                SELECT s.song_id, s.title, s.artist, COUNT(*) as count
                FROM play_history h
                JOIN songs s ON h.song_id = s.song_id
                WHERE h.requested_by_jid = ?
                GROUP BY s.song_id
                ORDER BY count DESC
                LIMIT 1
            `).get(userJid)

            cached = {
                user_jid: userJid,
                year: parseInt(year),
                listening_seconds: totalListenSec,
                total_requests: totalReqs,
                favorite_artist: topArtistRow ? topArtistRow.artist : '—',
                favorite_song_id: topSongRow ? topSongRow.song_id : null,
                top_genre: 'Pop Indo',
                percentile: 5.0
            }

            db.prepare(`
                INSERT INTO wrapped (user_jid, year, listening_seconds, total_requests, favorite_artist, favorite_song_id, top_genre, percentile)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                cached.user_jid,
                cached.year,
                cached.listening_seconds,
                cached.total_requests,
                cached.favorite_artist,
                cached.favorite_song_id,
                cached.top_genre,
                cached.percentile
            )
        }

        let favSong = null
        if (cached.favorite_song_id) {
            const sRow = db.prepare('SELECT title, artist FROM songs WHERE song_id = ?').get(cached.favorite_song_id)
            if (sRow) {
                favSong = `${sRow.title} - ${sRow.artist}`
            }
        }

        res.json({
            success: true,
            data: {
                wrapped: {
                    year: cached.year,
                    listeningHours: parseFloat((cached.listening_seconds / 3600).toFixed(1)),
                    songsPlayed: Math.round(cached.listening_seconds / 240),
                    favoriteArtist: cached.favorite_artist,
                    favoriteSong: favSong || '—',
                    topGenre: cached.top_genre,
                    totalRequests: cached.total_requests,
                    rankPercentile: cached.percentile,
                    achievementsUnlocked: db.prepare('SELECT COUNT(*) as count FROM achievement_unlocks WHERE user_jid = ?').get(userJid)?.count || 0
                }
            }
        })
    } catch (err) {
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: err.message
            }
        })
    }
})

export default router
