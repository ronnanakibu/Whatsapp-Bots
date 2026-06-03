'use client'

import { useDashboardStore } from '@/lib/store'
import ListenerNetwork from '@/components/network/ListenerNetwork'

export default function NetworkPage() {
    const { accentColor, metrics, listeners, nowPlaying, queue } = useDashboardStore()

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 flex-shrink-0 border-b"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Ecosystem Network</h1>
                <p className="text-[11px] text-white/25 mt-0.5">
                    Visualize the full BOTWA connection graph: Users → Requests → Media → Listeners
                </p>
            </div>

            <div className="flex-1 flex gap-4 p-4 overflow-hidden min-h-0">
                {/* Main network viz */}
                <div className="flex-1 min-w-0">
                    <ListenerNetwork />
                </div>

                {/* Stats column */}
                <div className="w-56 flex-shrink-0 space-y-3 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {/* Network summary */}
                    <div className="rounded-2xl p-4 space-y-3"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/25">Network</p>
                        {[
                            { label: 'Connected', value: listeners.length, color: accentColor },
                            { label: 'Peak today', value: '—', color: '#8B5CF6' },
                            { label: 'Total users', value: metrics.connectedUsers, color: '#10B981' },
                        ].map(s => (
                            <div key={s.label} className="flex justify-between items-center">
                                <span className="text-[10px] text-white/30">{s.label}</span>
                                <span className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</span>
                            </div>
                        ))}
                    </div>

                    {/* Flow path */}
                    <div className="rounded-2xl p-4"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-3">Signal Path</p>
                        {[
                            { node: 'WhatsApp Users', detail: `${metrics.connectedUsers} connected`, color: '#25D366' },
                            { node: 'Command Engine', detail: 'Processing', color: accentColor },
                            { node: 'Search & DL', detail: `Queue: ${queue.length}`, color: '#8B5CF6' },
                            { node: 'FFmpeg', detail: metrics.ffmpegStatus, color: '#F59E0B' },
                            { node: 'Broadcast', detail: nowPlaying.isPlaying ? 'LIVE' : 'Idle', color: '#10B981' },
                            { node: 'HTTP Listeners', detail: `${listeners.length} tuned in`, color: accentColor },
                        ].map((n, i) => (
                            <div key={n.node}>
                                <div className="flex items-start gap-2 py-1.5">
                                    <div className="flex flex-col items-center flex-shrink-0 mt-1">
                                        <div className="w-2 h-2 rounded-full" style={{ background: n.color }} />
                                        {i < 5 && <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />}
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-medium" style={{ color: n.color }}>{n.node}</p>
                                        <p className="text-[9px] text-white/25 font-mono">{n.detail}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Active listener list */}
                    {listeners.length > 0 && (
                        <div className="rounded-2xl p-4"
                            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-2">Active Listeners</p>
                            <div className="space-y-1.5">
                                {listeners.map(l => (
                                    <div key={l.id} className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accentColor }} />
                                        <span className="text-[10px] font-mono text-white/50 truncate">
                                            {l.name ?? l.id.slice(0, 12)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}