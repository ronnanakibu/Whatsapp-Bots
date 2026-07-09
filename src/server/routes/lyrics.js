// src/server/routes/lyrics.js
import express from 'express'
import { radioService } from '../../services/radio.js'
import { authenticateJwt } from '../middleware/auth.js'
import { db, io, broadcastSSE, resolveSongId } from '../radio.js'

const router = express.Router()

const mockLyrics = (title) => ({
    lyrics: [
        { time: 0, text: `[Musik - ${title}]` },
        { time: 10, text: "Kupikir kita akan bersama" },
        { time: 20, text: "Ternyata semua hanya bayang semata" },
        { time: 30, text: "Melangkah pergi tanpa kata" },
        { time: 40, text: "Meninggalkan luka yang mendalam..." },
        { time: 50, text: "[Guitar Solo]" },
        { time: 80, text: "Kini ku sendiri menatap bintang" },
        { time: 90, text: "Berharap kau kembali pulang..." },
        { time: 110, text: "[Chorus]" },
        { time: 130, text: "Terima kasih atas segalanya..." }
    ],
    synced: true
})

router.get('/lyrics/current', (req, res) => {
    const track = radioService.currentTrack
    if (!track) {
        return res.status(404).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Tidak ada lagu yang sedang diputar.'
            }
        })
    }
    res.json({
        success: true,
        data: {
            songId: track.songId,
            title: track.title,
            ...mockLyrics(track.title)
        }
    })
})

router.get('/lyrics/:songId', (req, res) => {
    const resolvedSongId = resolveSongId(req.params.songId)
    let title = 'Lagu Pilihan'
    try {
        const row = db.prepare('SELECT title FROM songs WHERE song_id = ?').get(resolvedSongId)
        if (row) title = row.title
    } catch (_) {}

    res.json({
        success: true,
        data: {
            songId: resolvedSongId,
            title,
            ...mockLyrics(title)
        }
    })
})

router.post('/songs/:songId/reactions', authenticateJwt, (req, res) => {
    const { reaction } = req.body
    const resolvedSongId = resolveSongId(req.params.songId)
    const userJid = req.user.jid
    if (!reaction) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: 'Emoji reaksi wajib diisi.'
            }
        })
    }
    try {
        const songExists = db.prepare('SELECT 1 FROM songs WHERE song_id = ?').get(resolvedSongId)
        if (!songExists) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Lagu tidak ditemukan di pustaka.'
                }
            })
        }

        db.prepare('INSERT INTO reactions (user_jid, song_id, emoji) VALUES (?, ?, ?)').run(userJid, resolvedSongId, reaction)

        io?.emit('engagement:reaction', { songId: resolvedSongId, reaction, userJid })
        broadcastSSE('engagement:reaction', { songId: resolvedSongId, reaction, userJid }, req.id)

        res.json({
            success: true,
            data: {
                message: 'Reaksi berhasil direkam!'
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
