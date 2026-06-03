'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import type { Track } from '@/types'
import { Clock, CheckCircle, Download, Play } from 'lucide-react'

function formatDur(sec?: number): string {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

type TrackStatus = 'playing' | 'ready' | 'downloading' | 'queued'

function getStatus(track: Track, idx: number, isPlayingId?: string): TrackStatus {
    if (isPlayingId && track.id === isPlayingId) return 'playing'
    if (idx === 0) return 'ready'
    return 'queued'
}

const STATUS_CONFIG: Record<TrackStatus, { icon: React.ReactNode; color: string; label: string }> = {
    playing:    { icon: <Play size={10} />,         color: '#00D4FF', label: 'Playing' },
    ready:      { icon: <CheckCircle size={10} />,  color: '#10B981', label: 'Ready' },
    downloading:{ icon: <Download size={10} />,     color: '#F59E0B', label: 'Downloading' },
    queued:     { icon: <Clock size={10} />,        color: 'rgba(148,163,184,0.6)', label: 'Queued' },
}

function QueueItem({ track, idx, isPlaying, accentColor }: {
    track: Track; idx: number; isPlaying: boolean; accentColor: string
}) {
    const statusKey = getStatus(track, idx, isPlaying ? track.id : undefined)
    const status = STATUS_CONFIG[statusKey]
    const isCurrent = statusKey === 'playing'
    const isNext = statusKey === 'ready'

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl relative overflow-hidden"
            style={{
                background: isCurrent
                    ? `${accentColor}10`
                    : isNext
                    ? 'rgba(139,92,246,0.06)'
                    : 'rgba(255,255,255,0.02)',
                borderLeft: isCurrent
                    ? `2px solid ${accentColor}80`
                    : isNext
                    ? '2px solid rgba(139,92,246,0.4)'
                    : '2px solid transparent',
            }}
        >
            {/* Position number */}
            <span className="text-[11px] font-mono text-muted-foreground w-5 flex-shrink-0 text-center">
                {isCurrent ? (
                    <motion.span
                        className="text-base"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                    >
                        ▶
                    </motion.span>
                ) : idx + 1}
            </span>

            {/* Thumbnail */}
            <div
                className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden"
                style={{
                    background: isCurrent ? `${accentColor}30` : 'rgba(255,255,255,0.06)',
                    border: isCurrent ? `1px solid ${accentColor}40` : '1px solid rgba(255,255,255,0.06)',
                }}
            >
                {track.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.thumbnail} alt={track.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-base">🎵</div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-white truncate">{track.title}</p>
                {track.requestedBy && (
                    <p className="text-[10px] text-muted-foreground">
                        by <span style={{ color: isCurrent ? accentColor : 'rgba(148,163,184,0.8)' }}>
                            {track.requestedBy}
                        </span>
                    </p>
                )}
            </div>

            {/* Duration + Status */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground">
                    {formatDur(track.duration)}
                </span>
                <div
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                    style={{ background: `${status.color}15`, color: status.color }}
                >
                    {status.icon}
                    <span className="text-[9px] font-mono">{status.label}</span>
                </div>
            </div>
        </motion.div>
    )
}

export default function QueueTimeline() {
    const { queue, nowPlaying, accentColor } = useDashboardStore()

    return (
        <div
            className="flex flex-col h-full rounded-2xl overflow-hidden"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05] flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Queue</span>
                    <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: `${accentColor}20`, color: accentColor }}
                    >
                        {queue.length}
                    </span>
                </div>
                <span className="text-[10px] text-muted-foreground">Timeline</span>
            </div>

            {/* Queue list */}
            <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
                <AnimatePresence initial={false} mode="popLayout">
                    {queue.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center h-32 gap-2"
                        >
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.04)' }}
                            >
                                <span className="text-xl">🎵</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">Queue is empty</p>
                            <p className="text-[10px] text-muted-foreground/60">Request a song via WhatsApp</p>
                        </motion.div>
                    ) : (
                        queue.map((track, idx) => (
                            <QueueItem
                                key={track.id ?? idx}
                                track={track}
                                idx={idx}
                                isPlaying={nowPlaying.isPlaying && idx === 0}
                                accentColor={accentColor}
                            />
                        ))
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
