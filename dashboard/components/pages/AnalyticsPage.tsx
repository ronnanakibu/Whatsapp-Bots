'use client'

import { motion } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import ListenerNetwork from '@/components/network/ListenerNetwork'

function BigStat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-4 flex flex-col gap-1"
            style={{ background: `${color}07`, border: `1px solid ${color}15` }}>
            <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">{label}</span>
            <span className="text-3xl font-bold font-mono leading-none" style={{ color }}>{value}</span>
            {sub && <span className="text-[10px] text-white/25">{sub}</span>}
        </motion.div>
    )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
    const pct = Math.min((value / max) * 100, 100)
    return (
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-white/30 w-16 flex-shrink-0 truncate">!{label}</span>
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
                    style={{ background: `linear-gradient(90deg, ${color}80, ${color})` }} />
            </div>
            <span className="text-[10px] font-mono text-white/30 w-8 text-right">{value}</span>
        </div>
    )
}

const MOCK_ANALYTICS = {
    commandsToday: 142, downloadsToday: 38, mediaProcessed: 38,
    streamsStarted: 12, activeUsers: 7, peakListeners: 14,
    avgStreamDuration: '23m',
    topCommands: [
        { name: 'play', count: 58 }, { name: 'skip', count: 24 },
        { name: 'queue', count: 18 }, { name: 'np', count: 15 }, { name: 'fx', count: 9 },
    ],
    totalCommands: 0, totalMessages: 0, uptime: 0,
    commandsDistribution: {}, messagesTimeline: [], topUsers: [],
}

export default function AnalyticsPage() {
    const { accentColor, analytics, metrics } = useDashboardStore()
    const data = analytics ?? MOCK_ANALYTICS
    const maxCmd = Math.max(...data.topCommands.map(c => c.count))

    return (
        <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="p-4 space-y-4 pb-8">
                {/* Header */}
                <div className="py-2">
                    <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">System Intelligence</h1>
                    <p className="text-[11px] text-white/25 mt-0.5">Platform usage · performance · trends</p>
                </div>

                {/* Big stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <BigStat label="Commands Today" value={data.commandsToday} color={accentColor} />
                    <BigStat label="Downloads" value={data.downloadsToday} color="#10B981" />
                    <BigStat label="Stream Sessions" value={data.streamsStarted} color="#8B5CF6" />
                    <BigStat label="Peak Listeners" value={data.peakListeners} color="#F59E0B" />
                </div>

                {/* System + Commands in 2-col */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* System resources */}
                    <div className="rounded-2xl p-4 space-y-4"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-white/25">System Resources</span>
                        <div className="space-y-3">
                            {[
                                { label: 'CPU', value: metrics.cpuUsage, color: accentColor },
                                { label: 'MEM', value: metrics.memoryUsage, color: '#8B5CF6' },
                                { label: 'DISK', value: 42, color: '#10B981' },
                                { label: 'NET TX', value: 15, color: '#F59E0B' },
                            ].map(r => (
                                <div key={r.label} className="flex items-center gap-3">
                                    <span className="text-[10px] font-mono text-white/30 w-12 flex-shrink-0">{r.label}</span>
                                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                        <motion.div className="h-full rounded-full" initial={{ width: 0 }}
                                            animate={{ width: `${Math.min(r.value, 100)}%` }}
                                            transition={{ duration: 1, ease: 'easeOut' }}
                                            style={{ background: `linear-gradient(90deg, ${r.color}60, ${r.color})` }} />
                                    </div>
                                    <span className="text-[10px] font-mono text-white/40 w-8 text-right">
                                        {r.value.toFixed(0)}%
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                            <div className="text-center">
                                <p className="text-[9px] font-mono text-white/20">Active Users</p>
                                <p className="text-lg font-bold font-mono" style={{ color: accentColor }}>{data.activeUsers}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-[9px] font-mono text-white/20">Avg Duration</p>
                                <p className="text-lg font-bold font-mono text-white">{data.avgStreamDuration}</p>
                            </div>
                            <div className="text-center">
                                <p className="text-[9px] font-mono text-white/20">Media Proc.</p>
                                <p className="text-lg font-bold font-mono text-white">{data.mediaProcessed}</p>
                            </div>
                        </div>
                    </div>

                    {/* Top commands */}
                    <div className="rounded-2xl p-4 space-y-4"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-white/25">Top Commands</span>
                        <div className="space-y-3">
                            {data.topCommands.map((cmd, i) => (
                                <BarRow key={cmd.name} label={cmd.name} value={cmd.count} max={maxCmd}
                                    color={[accentColor, '#8B5CF6', '#10B981', '#F59E0B', '#EC4899'][i % 5]} />
                            ))}
                        </div>

                        <div className="pt-3 border-t space-y-2" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                            <p className="text-[9px] font-mono uppercase tracking-widest text-white/20">Bot Status</p>
                            {[
                                { label: 'WhatsApp', value: metrics.waStatus, ok: metrics.waStatus === 'connected' },
                                { label: 'FFmpeg', value: metrics.ffmpegStatus, ok: metrics.ffmpegStatus !== 'error' },
                                { label: 'Network', value: metrics.networkHealth, ok: metrics.networkHealth !== 'offline' },
                            ].map(s => (
                                <div key={s.label} className="flex items-center justify-between">
                                    <span className="text-[10px] font-mono text-white/30">{s.label}</span>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                                        style={{
                                            background: s.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                            color: s.ok ? '#10B981' : '#EF4444',
                                        }}>
                                        {s.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Listener network */}
                <div style={{ height: 300 }}>
                    <ListenerNetwork />
                </div>
            </div>
        </div>
    )
}