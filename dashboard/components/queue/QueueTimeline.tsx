'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { Play } from 'lucide-react'

function formatDur(sec?: number): string {
    if (!sec) return '—'
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

interface Props { compact?: boolean }

export default function QueueTimeline({ compact }: Props) {
    const { queue, nowPlaying, accentColor } = useDashboardStore()
    const displayQueue = compact ? (queue || []).slice(0, 5) : (queue || [])

    return (
        <div className="flex flex-col h-full rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">Queue</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: `${accentColor}15`, color: accentColor }}>
                        {Array.isArray(queue) ? queue.length : 0}
                    </span>
                </div>
                {compact && Array.isArray(queue) && queue.length > 5 && (
                    <span className="text-[10px] text-white/20">+{queue.length - 5} more</span>
                )}
            </div>

            <div className={`overflow-y-auto py-2 px-2 space-y-1 ${compact ? 'max-h-48' : 'flex-1'}`}
                style={{ scrollbarWidth: 'thin' }}>
                <AnimatePresence initial={false} mode="popLayout">
                    {displayQueue.length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center h-24 gap-2">
                            <span className="text-lg">🎵</span>
                            <p className="text-[11px] text-white/20">Queue is empty</p>
                        </motion.div>
                    ) : displayQueue.map((track, idx) => {
                        const isCurrent = nowPlaying.isPlaying && idx === 0
                        return (
                            <motion.div key={track.id ?? idx} layout
                                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, height: 0 }}
                                className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                                style={{
                                    background: isCurrent ? `${accentColor}08` : 'transparent',
                                    borderLeft: isCurrent ? `2px solid ${accentColor}60` : '2px solid transparent',
                                }}>
                                <span className="w-4 text-center flex-shrink-0">
                                    {isCurrent
                                        ? <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                                            <Play size={10} fill={accentColor} style={{ color: accentColor }} />
                                        </motion.span>
                                        : <span className="text-[10px] font-mono text-white/20">{idx + 1}</span>
                                    }
                                </span>
                                {track.thumbnail && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={track.thumbnail} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-white/80 truncate">{track.title}</p>
                                    {track.requestedBy && (
                                        <p className="text-[9px] text-white/25">by {track.requestedBy}</p>
                                    )}
                                </div>
                                <span className="text-[10px] font-mono text-white/25 flex-shrink-0">
                                    {formatDur(track.duration)}
                                </span>
                            </motion.div>
                        )
                    })}
                </AnimatePresence>
            </div>
        </div>
    )
}