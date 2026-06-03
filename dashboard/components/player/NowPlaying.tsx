'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { useAccentColor } from '@/hooks/useAccentColor'
import { Users, Clock, Zap, Radio } from 'lucide-react'

function formatDuration(sec: number): string {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

export default function NowPlaying() {
    const { nowPlaying, accentColor } = useDashboardStore()
    const { track, isPlaying, listeners, fx, eq, bitrate, codec } = nowPlaying
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
                <div className="flex-shrink-0 relative">
                    <motion.div
                        className="w-28 h-28 rounded-xl overflow-hidden relative"
                        style={{
                            background: `${accentColor}20`,
                            border: `1px solid ${accentColor}30`,
                            boxShadow: `0 0 30px ${accentColor}25`,
                        }}
                        animate={{ scale: isPlaying ? [1, 1.02, 1] : 1 }}
                        transition={{ duration: 4, repeat: isPlaying ? Infinity : 0, ease: 'easeInOut' }}
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
                    </motion.div>

                    {/* Playing indicator */}
                    <AnimatePresence>
                        {isPlaying && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0 }}
                                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                                style={{ background: accentColor }}
                            >
                                <div className="flex gap-0.5 items-center">
                                    {[0, 1, 2].map((i) => (
                                        <motion.div
                                            key={i}
                                            className="w-0.5 rounded-full"
                                            style={{ background: '#000' }}
                                            animate={{ height: ['4px', '8px', '4px'] }}
                                            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                                        />
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
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
                    <div className="flex flex-wrap gap-1.5">
                        <MetaChip icon={<Users size={10} />} value={`${listeners}`} label="listeners" color={accentColor} />
                        <MetaChip icon={<Zap size={10} />} value={`${bitrate}k`} label="bitrate" />
                        <MetaChip icon={<span className="text-[10px]">🎛</span>} value={fx.toUpperCase()} label="fx" />
                        <MetaChip icon={<span className="text-[10px]">🎚</span>} value={eq.toUpperCase()} label="eq" />
                        <MetaChip icon={<Clock size={10} />} value={codec.toUpperCase()} label="codec" />
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
        >
            <span style={{ color: color ?? 'rgba(148,163,184,0.8)' }}>{icon}</span>
            <span className="text-[10px] font-mono" style={{ color: color ?? 'rgba(255,255,255,0.7)' }}>
                {value}
            </span>
        </div>
    )
}
