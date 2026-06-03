'use client'

import { useDashboardStore } from '@/lib/store'
import PipelineNode from '@/components/pipeline/PipelineNode'
import FFmpegReactor from '@/components/ffmpeg/FFmpegReactor'
import EventStream from '@/components/pipeline/EventStream'

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="flex justify-between items-center py-1.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
            <span className="text-[11px] text-white/30">{label}</span>
            <span className="text-[11px] font-mono" style={{ color: color ?? 'rgba(255,255,255,0.7)' }}>{value}</span>
        </div>
    )
}

export default function PipelinePage() {
    const { pipelineNodes, accentColor, nowPlaying, metrics } = useDashboardStore()

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header — fixed */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b"
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <div>
                    <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Live Media Pipeline</h1>
                    <p className="text-[11px] text-white/25 mt-0.5">
                        Real-time media flow: WhatsApp → FFmpeg → Broadcast
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
                        style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-mono text-emerald-400">{metrics.activeStreams} STREAMS</span>
                    </div>
                </div>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 flex gap-4 p-4 overflow-hidden min-h-0">

                {/* Pipeline column — fixed width, internal scroll */}
                <div className="flex-shrink-0 w-24 flex flex-col items-center py-3 rounded-2xl overflow-y-auto"
                    style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        scrollbarWidth: 'none',
                    }}>
                    {pipelineNodes.map((node, idx) => (
                        <PipelineNode
                            key={node.id}
                            node={node}
                            isFirst={idx === 0}
                            isLast={idx === pipelineNodes.length - 1}
                        />
                    ))}
                </div>

                {/* Center — FFmpeg + Signal path */}
                <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    <FFmpegReactor />

                    <div className="rounded-2xl p-4 flex-1"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">Signal Path</p>
                        <div className="space-y-0">
                            <InfoRow label="Source" value="SoundCloud CDN" color={accentColor} />
                            <InfoRow label="Codec" value={nowPlaying.codec.toUpperCase()} />
                            <InfoRow label="Bitrate" value={`${nowPlaying.bitrate}kbps`} />
                            <InfoRow label="FX Chain" value={nowPlaying.fx} />
                            <InfoRow label="EQ Profile" value={nowPlaying.eq} />
                            <InfoRow label="Active Streams" value={String(metrics.activeStreams)} color="#10B981" />
                            <InfoRow label="Queue Depth" value={`${metrics.queueSize} tracks`} />
                            <InfoRow label="Connected Users" value={String(metrics.connectedUsers)} color={accentColor} />
                        </div>
                    </div>
                </div>

                {/* Right — Event stream */}
                <div className="w-72 flex-shrink-0 overflow-hidden">
                    <EventStream />
                </div>
            </div>
        </div>
    )
}