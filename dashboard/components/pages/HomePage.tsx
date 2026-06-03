'use client'

import { motion } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import NowPlaying from '@/components/player/NowPlaying'
import QueueTimeline from '@/components/queue/QueueTimeline'

function StatCard({ label, value, sub, color, pulse }: {
    label: string; value: string | number; sub?: string; color?: string; pulse?: boolean
}) {
    const { accentColor } = useDashboardStore()
    const c = color ?? accentColor
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-4 flex flex-col gap-1 relative overflow-hidden"
            style={{ background: `${c}07`, border: `1px solid ${c}15` }}>
            {pulse && (
                <motion.div className="absolute top-3 right-3 w-2 h-2 rounded-full"
                    style={{ background: c }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity }} />
            )}
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">{label}</span>
            <span className="text-2xl font-bold font-mono leading-none" style={{ color: c }}>{value}</span>
            {sub && <span className="text-[10px] text-white/30">{sub}</span>}
        </motion.div>
    )
}

function SystemHealthBar({ label, value, color }: { label: string; value: number; color: string }) {
    const danger = value > 85
    const c = danger ? '#EF4444' : color
    return (
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-white/30 w-8 flex-shrink-0">{label}</span>
            <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                    animate={{ width: `${Math.min(value, 100)}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    style={{ background: `linear-gradient(90deg, ${c}80, ${c})` }} />
            </div>
            <span className="text-[10px] font-mono w-8 text-right" style={{ color: danger ? '#EF4444' : 'rgba(255,255,255,0.4)' }}>
                {value.toFixed(0)}%
            </span>
        </div>
    )
}

export default function HomePage() {
    const { metrics, nowPlaying, accentColor, connected, queue, events } = useDashboardStore()

    const recentEvents = events.slice(0, 5)

    return (
        <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="p-4 space-y-4 pb-8">
                {/* Header */}
                <div className="flex items-center justify-between py-2">
                    <div>
                        <h1 className="text-sm font-bold text-white tracking-wide font-mono uppercase">Mission Control</h1>
                        <p className="text-[11px] text-white/30 mt-0.5">System overview — what&apos;s happening right now</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <motion.div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                            style={{
                                background: connected ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                                border: `1px solid ${connected ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                            }}>
                            <motion.div className="w-1.5 h-1.5 rounded-full"
                                style={{ background: connected ? '#10B981' : '#EF4444' }}
                                animate={{ opacity: connected ? [1, 0.3, 1] : 1 }}
                                transition={{ duration: 2, repeat: Infinity }} />
                            <span className="text-[10px] font-mono" style={{ color: connected ? '#10B981' : '#EF4444' }}>
                                {connected ? 'CONNECTED' : 'OFFLINE'}
                            </span>
                        </motion.div>
                    </div>
                </div>

                {/* Now Playing hero */}
                <NowPlaying />

                {/* Quick stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Listeners" value={nowPlaying.listeners} sub="connected now" color={accentColor} pulse={nowPlaying.isPlaying} />
                    <StatCard label="Queue" value={queue.length} sub="tracks waiting" color="#8B5CF6" />
                    <StatCard label="Streams" value={metrics.activeStreams} sub="active" color="#10B981" />
                    <StatCard label="Uptime" value={formatUptime(metrics.uptime)} sub="server" color="#F59E0B" />
                </div>

                {/* System health + recent events side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* System health */}
                    <div className="rounded-2xl p-4 space-y-4"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">System Health</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                                style={{
                                    background: metrics.status === 'online' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                    color: metrics.status === 'online' ? '#10B981' : '#EF4444',
                                }}>
                                {metrics.status.toUpperCase()}
                            </span>
                        </div>
                        <div className="space-y-3">
                            <SystemHealthBar label="CPU" value={metrics.cpuUsage} color={accentColor} />
                            <SystemHealthBar label="MEM" value={metrics.memoryUsage} color="#8B5CF6" />
                            <SystemHealthBar label="NET" value={metrics.networkHealth === 'excellent' ? 12 : metrics.networkHealth === 'good' ? 45 : 80} color="#10B981" />
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                            {[
                                { label: 'WA', value: metrics.waStatus, ok: metrics.waStatus === 'connected' },
                                { label: 'FFmpeg', value: metrics.ffmpegStatus, ok: metrics.ffmpegStatus === 'active' || metrics.ffmpegStatus === 'idle' },
                                { label: 'Net', value: metrics.networkHealth, ok: metrics.networkHealth !== 'offline' },
                            ].map(item => (
                                <div key={item.label} className="text-center">
                                    <p className="text-[9px] font-mono text-white/20">{item.label}</p>
                                    <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: item.ok ? '#10B981' : '#EF4444' }}>
                                        {item.value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recent events */}
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                            <div className="flex items-center gap-2">
                                <motion.div className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }}
                                    animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Recent Events</span>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                                style={{ background: `${accentColor}15`, color: accentColor }}>
                                {events.length}
                            </span>
                        </div>
                        <div className="p-2 space-y-0.5 max-h-48 overflow-y-auto">
                            {recentEvents.length === 0 ? (
                                <div className="flex items-center justify-center h-16">
                                    <span className="text-[11px] text-white/20">Waiting for events...</span>
                                </div>
                            ) : recentEvents.map((event) => (
                                <div key={event.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors">
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                                        style={getEventStyle(event.type)}>
                                        {event.type.toUpperCase().slice(0, 3)}
                                    </span>
                                    <p className="text-[11px] text-white/60 leading-relaxed flex-1">{event.message}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Queue preview */}
                <div style={{ minHeight: 240 }}>
                    <QueueTimeline compact />
                </div>
            </div>
        </div>
    )
}

function formatUptime(s: number): string {
    if (!s) return '—'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function getEventStyle(type: string): React.CSSProperties {
    const map: Record<string, { background: string; color: string }> = {
        info: { background: 'rgba(59,130,246,0.15)', color: '#60A5FA' },
        success: { background: 'rgba(16,185,129,0.15)', color: '#34D399' },
        warn: { background: 'rgba(245,158,11,0.15)', color: '#FBBF24' },
        error: { background: 'rgba(239,68,68,0.15)', color: '#F87171' },
    }
    return map[type] ?? map.info
}