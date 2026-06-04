'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useAudioPlayer } from '@/hooks/useAudioAnalyzer'
import { Users, Zap, Radio, Play, Pause, Volume2, VolumeX } from 'lucide-react'
import dynamic from 'next/dynamic'
import LiveLyrics from '@/components/player/LiveLyrics'

const Visualizer = dynamic(() => import('@/components/player/Visualizer'), { ssr: false })

function formatDuration(sec: number): string {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

export default function StreamPage() {
    const { nowPlaying, accentColor } = useDashboardStore()
    const { track, isPlaying, listeners, fx, bitrate, codec } = nowPlaying
    const { isPlaying: localIsPlaying, isMuted, volume, togglePlay, toggleMute, setVolume } = useAudioPlayer()
    const progressRef = useRef<HTMLDivElement>(null)
    const startTimeRef = useRef(nowPlaying.startedAt)

    useAccentColor(track?.thumbnail)

    // Progress tick
    useEffect(() => {
        if (!isPlaying || !track?.duration) return
        startTimeRef.current = nowPlaying.startedAt
        const tick = () => {
            if (!progressRef.current || !track?.duration) return
            const elapsed = (Date.now() - startTimeRef.current) / 1000
            const pct = Math.min((elapsed / track.duration) * 100, 100)
            progressRef.current.style.width = `${pct}%`
        }
        const id = setInterval(tick, 500)
        tick()
        return () => clearInterval(id)
    }, [isPlaying, track, nowPlaying.startedAt])

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Dynamic atmosphere bg */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
                <motion.div
                    className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-[120px]"
                    style={{ background: `${accentColor}20` }}
                    animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.6, 0.4] }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                    className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full blur-[100px]"
                    style={{ background: '#8B5CF620' }}
                    animate={{ scale: [1.1, 1, 1.1], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
                />
            </div>

            <div className="relative z-10 flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-8 md:gap-16 overflow-hidden max-w-[1400px] w-full mx-auto">
                {/* Left side: Player */}
                <div className="flex flex-col items-center justify-center gap-6 w-full md:w-[400px] flex-shrink-0">
                    {/* Album art — large, centered */}
                <motion.div
                    className="relative cursor-pointer group"
                    onClick={togglePlay}
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}>

                    {/* Outer glow ring */}
                    <motion.div
                        className="absolute -inset-4 rounded-3xl blur-2xl"
                        style={{ background: `${accentColor}25` }}
                        animate={{ opacity: isPlaying && localIsPlaying ? [0.4, 0.7, 0.4] : 0.2 }}
                        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    />

                    <motion.div
                        className="relative w-56 h-56 sm:w-72 sm:h-72 rounded-2xl overflow-hidden"
                        style={{
                            border: `1px solid ${accentColor}30`,
                            boxShadow: `0 0 60px ${accentColor}20, 0 24px 80px rgba(0,0,0,0.6)`,
                        }}
                        animate={{ scale: isPlaying && localIsPlaying ? [1, 1.015, 1] : 1 }}
                        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>

                        <AnimatePresence mode="wait">
                            {track?.thumbnail ? (
                                <motion.img key={track.thumbnail} src={track.thumbnail} alt={track.title}
                                    initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
                                    className="w-full h-full object-cover" />
                            ) : (
                                <motion.div key="placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                    className="w-full h-full flex items-center justify-center"
                                    style={{ background: `${accentColor}15` }}>
                                    <Radio size={48} style={{ color: `${accentColor}50` }} />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Hover overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
                            {localIsPlaying
                                ? <Pause size={36} className="text-white" />
                                : <Play size={36} className="text-white fill-white" />}
                        </div>

                        {/* Not-playing hint */}
                        {!localIsPlaying && isPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-black/50 border border-white/20 flex items-center justify-center backdrop-blur-sm">
                                    <Play size={14} className="text-white fill-white ml-0.5" />
                                </div>
                                <div className="absolute w-10 h-10 rounded-full animate-ping" style={{ background: `${accentColor}20` }} />
                            </div>
                        )}
                    </motion.div>
                </motion.div>

                {/* Track info */}
                <div className="text-center max-w-sm w-full">
                    <AnimatePresence mode="wait">
                        <motion.h2 key={track?.title}
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                            className="text-xl font-semibold text-white leading-tight mb-1 truncate px-4">
                            {track?.title ?? 'No track playing'}
                        </motion.h2>
                    </AnimatePresence>
                    {track?.requestedBy && (
                        <p className="text-xs text-white/40">
                            Requested by <span style={{ color: accentColor }}>{track.requestedBy}</span>
                        </p>
                    )}
                </div>

                {/* Progress */}
                {track?.duration && (
                    <div className="w-full max-w-sm">
                        <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
                            <div ref={progressRef} className="h-full rounded-full transition-none"
                                style={{ background: `linear-gradient(90deg, ${accentColor}, #8B5CF6)`, width: '0%' }} />
                        </div>
                        <div className="flex justify-between mt-1.5">
                            <span className="text-[10px] font-mono text-white/25">LIVE</span>
                            <span className="text-[10px] font-mono text-white/25">{formatDuration(track.duration)}</span>
                        </div>
                    </div>
                )}

                {/* Controls row */}
                <div className="flex flex-wrap items-center justify-center gap-2 max-w-sm w-full">
                    {/* Listener chip */}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                        style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}20` }}>
                        <Users size={11} style={{ color: accentColor }} />
                        <span className="text-xs font-mono" style={{ color: accentColor }}>{listeners}</span>
                        <span className="text-[10px] text-white/25">listeners</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <Zap size={11} className="text-white/40" />
                        <span className="text-xs font-mono text-white/60">{bitrate}k</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <span className="text-[10px] font-mono text-white/40">{codec.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <span className="text-[10px] font-mono text-white/40">FX: {fx}</span>
                    </div>
                </div>

                {/* Volume control */}
                <div className="flex items-center gap-3 w-full max-w-xs">
                    <button onClick={toggleMute} className="p-2 rounded-xl transition-colors hover:bg-white/05"
                        style={{ color: isMuted ? '#EF4444' : accentColor }}>
                        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <div className="flex-1 relative h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${(isMuted ? 0 : volume) * 100}%`, background: `linear-gradient(90deg, ${accentColor}, #8B5CF6)` }} />
                        <input type="range" min="0" max="1" step="0.02" value={isMuted ? 0 : volume}
                            onChange={e => setVolume(parseFloat(e.target.value))}
                            className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
                    </div>
                    <span className="text-[10px] font-mono text-white/30 w-8 text-right">
                        {Math.round((isMuted ? 0 : volume) * 100)}%
                    </span>
                </div>
                </div>

                {/* Right side: Live Lyrics */}
                <div className="w-full md:w-[500px] h-[300px] md:h-full md:max-h-[600px] flex-shrink-0">
                    <LiveLyrics />
                </div>
            </div>

            {/* Visualizer strip at bottom */}
            <div className="relative z-10 h-24 mx-4 mb-4 flex-shrink-0 rounded-2xl overflow-hidden">
                <Visualizer compact />
            </div>
        </div>
    )
}