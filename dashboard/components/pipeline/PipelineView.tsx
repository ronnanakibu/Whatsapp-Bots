'use client'

import { useDashboardStore } from '@/lib/store'
import PipelineNode from './PipelineNode'
import FFmpegReactor from '@/components/ffmpeg/FFmpegReactor'

export default function PipelineView() {
    const { pipelineNodes, accentColor, nowPlaying, metrics } = useDashboardStore()

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div>
                    <h2 className="text-sm font-semibold text-white tracking-wide">LIVE MEDIA PIPELINE</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        Real-time media flow visualization
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-mono text-emerald-400">STREAMING</span>
                    </div>
                    <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {metrics.connectedUsers} listeners
                        </span>
                    </div>
                </div>
            </div>

            {/* Main pipeline layout: nodes left, reactor + details right */}
            <div className="flex gap-6 flex-1 min-h-0">

                {/* Pipeline nodes column */}
                <div
                    className="flex flex-col items-center py-4 px-3 rounded-2xl flex-shrink-0"
                    style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        backdropFilter: 'blur(12px)',
                    }}
                >
                    {pipelineNodes.map((node, idx) => (
                        <PipelineNode
                            key={node.id}
                            node={node}
                            isFirst={idx === 0}
                            isLast={idx === pipelineNodes.length - 1}
                        />
                    ))}
                </div>

                {/* Right: FFmpeg Reactor + Now Playing info */}
                <div className="flex-1 flex flex-col gap-4 min-w-0">

                    {/* FFmpeg Reactor */}
                    <FFmpegReactor />

                    {/* Signal path info */}
                    <div
                        className="rounded-xl p-4 flex-1"
                        style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.05)',
                        }}
                    >
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">
                            Signal Path
                        </p>
                        <div className="space-y-2">
                            <InfoRow label="Source" value="SoundCloud CDN" color={accentColor} />
                            <InfoRow label="Codec" value={nowPlaying.codec.toUpperCase()} />
                            <InfoRow label="Bitrate" value={`${nowPlaying.bitrate}kbps`} />
                            <InfoRow label="FX" value={nowPlaying.fx} />
                            <InfoRow label="EQ" value={nowPlaying.eq} />
                            <InfoRow label="Active Streams" value={String(metrics.activeStreams)} color="#10B981" />
                            <InfoRow label="Queue" value={`${metrics.queueSize} tracks`} />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="flex justify-between items-center py-1 border-b border-white/[0.03]">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span
                className="text-[11px] font-mono"
                style={{ color: color ?? 'rgba(255,255,255,0.8)' }}
            >
                {value}
            </span>
        </div>
    )
}
