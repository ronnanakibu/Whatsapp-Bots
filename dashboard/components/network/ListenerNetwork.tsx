'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

interface NodeDot {
    id: string
    x: number
    y: number
    name: string
    connectedAt: number
}

export default function ListenerNetwork() {
    const { listeners, accentColor, nowPlaying, metrics } = useDashboardStore()
    const svgRef = useRef<SVGSVGElement>(null)
    const nodeMap = useRef<Map<string, NodeDot>>(new Map())

    // Place nodes in a semi-circle around broadcast node
    useEffect(() => {
        const cx = 280, cy = 120
        const r = 70;

        (listeners || []).forEach((l, i) => {
            if (l && l.id && !nodeMap.current.has(l.id)) {
                // semi circle on the right side
                const angle = -Math.PI/2 + (i / Math.max((listeners || []).length - 1 || 1, 1)) * Math.PI
                nodeMap.current.set(l.id, {
                    id: l.id,
                    x: cx + Math.cos(angle) * r,
                    y: cy + Math.sin(angle) * r,
                    name: l.name ?? l.id.slice(0, 8),
                    connectedAt: l.connectedAt,
                })
            }
        })

        // Cleanup removed listeners
        for (const id of nodeMap.current.keys()) {
            if (!(listeners || []).find((l) => l && l.id === id)) {
                nodeMap.current.delete(id)
            }
        }
    }, [listeners])

    const dots = Array.from(nodeMap.current.values())
    const pipelineNodes = [
        { id: 'wa', icon: '📱', label: 'WhatsApp', detail: `${metrics.connectedUsers} users`, x: 40, y: 120, active: metrics.connectedUsers > 0 },
        { id: 'cmd', icon: '⚡', label: 'Engine', detail: 'Active', x: 120, y: 120, active: true },
        { id: 'ffmpeg', icon: '⚙️', label: 'FFmpeg', detail: metrics.ffmpegStatus, x: 200, y: 120, active: metrics.ffmpegStatus === 'active' || metrics.ffmpegStatus === 'online' },
        { id: 'radio', icon: '📡', label: 'Broadcast', detail: nowPlaying.isPlaying ? 'Live' : 'Idle', x: 280, y: 120, active: nowPlaying.isPlaying }
    ]

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
                    <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Ecosystem Network</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                    {nowPlaying.isPlaying ? '📻 Live' : '⏸ Idle'}
                </span>
            </div>

            {/* Network visualization */}
            <div className="flex-1 relative overflow-hidden">
                <svg
                    ref={svgRef}
                    viewBox="0 0 400 240"
                    className="w-full h-full"
                    style={{ overflow: 'visible' }}
                >
                    {/* Pipeline lines */}
                    {pipelineNodes.map((node, i) => {
                        if (i === pipelineNodes.length - 1) return null
                        const next = pipelineNodes[i + 1]
                        return (
                            <line
                                key={`pl-${node.id}`}
                                x1={node.x} y1={node.y}
                                x2={next.x} y2={next.y}
                                stroke={node.active && next.active ? accentColor : 'rgba(255,255,255,0.2)'}
                                strokeWidth={1}
                                strokeDasharray={node.active && next.active ? "none" : "3 3"}
                            />
                        )
                    })}

                    {/* Connection lines from Broadcast to Listeners */}
                    <AnimatePresence>
                        {dots.map((dot) => (
                            <motion.line
                                key={`line-${dot.id}`}
                                x1={280} y1={120}
                                x2={dot.x} y2={dot.y}
                                stroke={accentColor}
                                strokeWidth={0.5}
                                strokeOpacity={0.4}
                                strokeDasharray="2 2"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            />
                        ))}
                    </AnimatePresence>

                    {/* Pipeline nodes */}
                    {pipelineNodes.map((node) => (
                        <g key={`pn-${node.id}`}>
                            {node.active && (
                                <motion.circle
                                    cx={node.x} cy={node.y}
                                    r={14}
                                    fill="none"
                                    stroke={accentColor}
                                    strokeWidth={0.5}
                                    initial={{ scale: 0.8, opacity: 0.8 }}
                                    animate={{ scale: 1.6, opacity: 0 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                                    style={{ transformOrigin: `${node.x}px ${node.y}px` }}
                                />
                            )}
                            <circle
                                cx={node.x} cy={node.y} r={14}
                                fill={node.active ? `${accentColor}25` : 'rgba(255,255,255,0.05)'}
                                stroke={node.active ? accentColor : 'rgba(255,255,255,0.2)'}
                                strokeWidth={1}
                            />
                            <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={10}>
                                {node.icon}
                            </text>
                            <text x={node.x} y={node.y + 24} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.8)" className="font-mono">
                                {node.label}
                            </text>
                            <text x={node.x} y={node.y + 34} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.4)" className="font-mono">
                                {node.detail}
                            </text>
                        </g>
                    ))}

                    {/* Listener nodes */}
                    <AnimatePresence>
                        {dots.map((dot) => (
                            <motion.g
                                key={dot.id}
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0 }}
                                style={{ transformOrigin: `${dot.x}px ${dot.y}px` }}
                            >
                                {nowPlaying.isPlaying && (
                                    <motion.circle
                                        cx={dot.x} cy={dot.y} r={8}
                                        fill="none"
                                        stroke={accentColor}
                                        strokeWidth={0.5}
                                        animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                                        style={{ transformOrigin: `${dot.x}px ${dot.y}px` }}
                                    />
                                )}
                                <circle
                                    cx={dot.x} cy={dot.y} r={7}
                                    fill={`${accentColor}20`}
                                    stroke={accentColor}
                                    strokeWidth={0.8}
                                />
                                <text x={dot.x} y={dot.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="rgba(255,255,255,0.8)" className="font-mono select-none">
                                    🎧
                                </text>
                                <text x={dot.x} y={dot.y + 14} textAnchor="middle" fontSize={5.5} fill="rgba(148,163,184,0.7)" className="font-mono select-none">
                                    {dot.name ? dot.name.slice(0, 8) : 'Anon'}
                                </text>
                            </motion.g>
                        ))}
                    </AnimatePresence>
                </svg>

            </div>

            {/* Listener list */}
            {Array.isArray(listeners) && listeners.length > 0 && (
                <div className="px-3 pb-3 space-y-1 max-h-24 overflow-y-auto border-t border-white/[0.04] pt-2">
                    <AnimatePresence>
                        {listeners.map((l) => (
                            <motion.div
                                key={l.id}
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                className="flex items-center justify-between"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px]">🎧</span>
                                    <span className="text-[10px] text-white/70 font-mono">
                                        {l.name ?? l.id?.slice(0, 12) ?? 'Anonymous'}
                                    </span>
                                </div>
                                <span className="text-[9px] font-mono text-muted-foreground">
                                    {formatTime(l.connectedAt)}
                                </span>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    )
}
