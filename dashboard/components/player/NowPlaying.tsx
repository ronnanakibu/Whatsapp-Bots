'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { useAccentColor } from '@/hooks/useAccentColor'
import { Users, Clock, Zap, Radio, Play, Pause, Volume2, VolumeX } from 'lucide-react'
import { useAudioPlayer } from '@/hooks/useAudioAnalyzer'

function formatDuration(sec: number): string {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

export default function NowPlaying() {
    const { nowPlaying, accentColor } = useDashboardStore()
    const { track, isPlaying, listeners, fx, eq, bitrate, codec } = nowPlaying
    const { isPlaying: localIsPlaying, isMuted, volume, togglePlay, toggleMute, setVolume } = useAudioPlayer()
    const progressRef = useRef<HTMLDivElement>(null)
    const startTimeRef = useRef(nowPlaying.startedAt)

    useAccentColor(track?.thumbnail)

    // Progress bar update
    useEffect(() => {
        if (!isPlaying || !track?.duration) return
        startTimeRef.current = nowPlaying.startedAt

        const tick = () => {
            if (!progressRef.current || !track.duration) return
            const elapsed = (Date.now() - startTimeRef.current) / 1000
            const pct = Math.min((elapsed / track.duration) * 100, 100)
            progressRef.current.style.width = `${pct}%`
        }

        const id = setInterval(tick, 500)
        tick()
        return () => clearInterval(id)
    }, [isPlaying, track, nowPlaying.startedAt])

    return (
        <div
            className="rounded-2xl overflow-hidden relative flex flex-col"
            style={{
                background: 'rgba(8,12,20,0.85)',
                border: `1px solid ${accentColor}22`,
                backdropFilter: 'blur(20px)',
                boxShadow: `0 0 40px ${accentColor}10, 0 8px 32px rgba(0,0,0,0.5)`,
            }}
        >
            {/* Top accent line */}
            <div
                className="h-px w-full"
                style={{
                    background: `linear-gradient(90deg, transparent, ${accentColor}80, transparent)`,
                }}
            />

            <div className="p-5 flex gap-5">
                {/* Album Art */}
                <div className="flex-shrink-0 relative group cursor-pointer" onClick={togglePlay}>
                    <motion.div
                        className="w-28 h-28 rounded-xl overflow-hidden relative"
                        style={{
                            background: `${accentColor}20`,
                            border: `1px solid ${accentColor}30`,
                            boxShadow: `0 0 30px ${accentColor}25`,
                        }}
                        animate={{ scale: (isPlaying && localIsPlaying) ? [1, 1.02, 1] : 1 }}
                        transition={{ duration: 4, repeat: (isPlaying && localIsPlaying) ? Infinity : 0, ease: 'easeInOut' }}
                    >
                        <AnimatePresence mode="wait">
                            {track?.thumbnail ? (
                                <motion.img
                                    key={track.thumbnail}
                                    src={track.thumbnail}
                                    alt={track.title}
                                    initial={{ opacity: 0, scale: 1.1 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.5 }}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <motion.div
                                    key="placeholder"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="w-full h-full flex items-center justify-center"
                                >
                                    <Radio size={32} style={{ color: `${accentColor}60` }} />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Hover Overlay with Play/Pause Icon */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px] z-10">
                            {localIsPlaying ? (
                                <Pause size={28} className="text-white drop-shadow-md" />
                            ) : (
                                <Play size={28} className="text-white drop-shadow-md fill-white" />
                            )}
                        </div>
                    </motion.div>

                    {/* Pulse overlay if server is playing but user hasn't connected to stream yet */}
                    {!localIsPlaying && isPlaying && (
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                            <div className="w-8 h-8 rounded-full bg-white/20 animate-ping absolute" />
                            <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                                <Play size={12} className="text-white fill-white ml-0.5" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                    {/* Title & Artist */}
                    <div>
                        <AnimatePresence mode="wait">
                            <motion.h3
                                key={track?.title}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                transition={{ duration: 0.3 }}
                                className="text-base font-semibold text-white leading-tight truncate"
                            >
                                {track?.title ?? 'No track playing'}
                            </motion.h3>
                        </AnimatePresence>
                        {track?.requestedBy && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Requested by <span style={{ color: accentColor }}>{track.requestedBy}</span>
                            </p>
                        )}
                    </div>

                    {/* Progress bar */}
                    {track?.duration && (
                        <div className="my-2">
                            <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                                <div
                                    ref={progressRef}
                                    className="h-full rounded-full transition-none"
                                    style={{
                                        background: `linear-gradient(90deg, ${accentColor}, #8B5CF6)`,
                                        width: '0%',
                                    }}
                                />
                            </div>
                            <div className="flex justify-between mt-1">
                                <span className="text-[10px] font-mono text-muted-foreground">live</span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                    {formatDuration(track.duration)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Meta chips */}
                    <div className="flex flex-wrap gap-1.5 items-center w-full">
                        <MetaChip icon={<Users size={10} />} value={`${listeners}`} label="listeners" color={accentColor} />
                        <MetaChip icon={<Zap size={10} />} value={`${bitrate}k`} label="bitrate" />
                        <MetaChip icon={<span className="text-[10px]">🎛</span>} value={fx.toUpperCase()} label="fx" />
                        <MetaChip icon={<span className="text-[10px]">🎚</span>} value={eq.toUpperCase()} label="eq" />
                        <MetaChip icon={<Clock size={10} />} value={codec.toUpperCase()} label="codec" />

                        {/* Volume / Mute controls */}
                        <div className="flex items-center gap-1.5 ml-auto bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    toggleMute()
                                }}
                                className="p-0.5 rounded transition-colors hover:text-white"
                                style={{ color: isMuted ? '#EF4444' : `${accentColor}CC` }}
                                title={isMuted ? 'Unmute' : 'Mute'}
                            >
                                {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={isMuted ? 0 : volume}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                    e.stopPropagation()
                                    setVolume(parseFloat(e.target.value))
                                }}
                                className="w-14 h-1 rounded-lg appearance-none cursor-pointer bg-white/15 accent-current hover:bg-white/20 transition-colors"
                                style={{ color: accentColor }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function MetaChip({ icon, value, label, color }: {
    icon: React.ReactNode; value: string; label: string; color?: string
}) {
    return (
        <div
            className="flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{
                background: color ? `${color}12` : 'rgba(255,255,255,0.05)',
                border: `1px solid ${color ? `${color}25` : 'rgba(255,255,255,0.06)'}`,
            }}
            title={label}
        >
            <span style={{ color: color ?? 'rgba(148,163,184,0.8)' }}>{icon}</span>
            <span className="text-[10px] font-mono" style={{ color: color ?? 'rgba(255,255,255,0.7)' }}>
                {value}
            </span>
        </div>
    )
}
