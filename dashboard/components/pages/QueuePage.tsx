'use client'

import { motion } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import type { Track } from '@/types'
import { Play } from 'lucide-react'

function formatDur(sec?: number): string {
    if (!sec) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

function getETA(queue: Track[], idx: number): string {
    let totalSec = 0
    for (let i = 0; i < idx; i++) {
        totalSec += queue[i].duration ?? 180
    }
    if (totalSec === 0) return 'Now'
    const m = Math.floor(totalSec / 60)
    return `~${m}m`
}

export default function QueuePage() {
    const { queue, nowPlaying, accentColor } = useDashboardStore()

    const totalDuration = queue.reduce((acc, t) => acc + (t.duration ?? 180), 0)
    const totalMin = Math.floor(totalDuration / 60)

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div>
                    <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Production Timeline</h1>
                    <p className="text-[11px] text-white/25 mt-0.5">Track queue · what plays next</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-xs font-mono text-white/60">{queue.length} tracks</p>
                        <p className="text-[10px] font-mono text-white/25">~{totalMin}m total</p>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5" style={{ scrollbarWidth: 'thin' }}>
                {queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
                            style={{ background: 'rgba(255,255,255,0.04)' }}>🎵</div>
                        <p className="text-sm text-white/25">Queue is empty</p>
                        <p className="text-xs text-white/15">Request a song via WhatsApp to add tracks</p>
                    </div>
                ) : queue.map((track, idx) => (
                    <QueueItem key={track.id ?? idx} track={track} idx={idx}
                        isCurrentlyPlaying={nowPlaying.isPlaying && idx === 0}
                        accentColor={accentColor}
                        eta={getETA(queue, idx)} />
                ))}
            </div>
        </div>
    )
}

function QueueItem({ track, idx, isCurrentlyPlaying, accentColor, eta }: {
    track: Track
    idx: number
    isCurrentlyPlaying: boolean
    accentColor: string
    eta: string
}) {
    const isNext = idx === 1 && !isCurrentlyPlaying

    const statusColor = isCurrentlyPlaying ? accentColor : isNext ? '#8B5CF6' : 'rgba(148,163,184,0.3)'
    const statusLabel = isCurrentlyPlaying ? 'Playing' : isNext ? 'Up next' : `#${idx + 1}`

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="flex items-center gap-3 p-3 rounded-2xl relative overflow-hidden"
            style={{
                background: isCurrentlyPlaying ? `${accentColor}09` : isNext ? 'rgba(139,92,246,0.05)' : 'rgba(255,255,255,0.02)',
                border: isCurrentlyPlaying ? `1px solid ${accentColor}20` : isNext ? '1px solid rgba(139,92,246,0.15)' : '1px solid rgba(255,255,255,0.04)',
            }}>

            {/* Position / playing indicator */}
            <div className="w-8 flex-shrink-0 flex items-center justify-center">
                {isCurrentlyPlaying ? (
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                        <Play size={14} style={{ color: accentColor }} fill={accentColor} />
                    </motion.div>
                ) : (
                    <span className="text-[11px] font-mono" style={{ color: statusColor }}>{idx + 1}</span>
                )}
            </div>

            {/* Thumbnail */}
            <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden"
                style={{
                    background: isCurrentlyPlaying ? `${accentColor}25` : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${isCurrentlyPlaying ? `${accentColor}30` : 'rgba(255,255,255,0.06)'}`,
                }}>
                {track.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">🎵</div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{track.title}</p>
                {track.requestedBy && (
                    <p className="text-[10px] text-white/30 mt-0.5">
                        by <span style={{ color: isCurrentlyPlaying ? accentColor : 'rgba(148,163,184,0.5)' }}>
                            {track.requestedBy}
                        </span>
                    </p>
                )}
            </div>

            {/* Right side: duration + ETA + status */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[11px] font-mono text-white/30">{formatDur(track.duration)}</span>
                <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-white/20">{eta}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{
                            background: `${statusColor}15`,
                            color: statusColor,
                            border: `1px solid ${statusColor}20`,
                        }}>
                        {statusLabel}
                    </span>
                </div>
            </div>
        </motion.div>
    )
}