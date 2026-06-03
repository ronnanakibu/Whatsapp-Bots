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
    const { listeners, accentColor, nowPlaying } = useDashboardStore()
    const svgRef = useRef<SVGSVGElement>(null)
    const nodeMap = useRef<Map<string, NodeDot>>(new Map())

    // Place nodes in a circle around center
    useEffect(() => {
        const w = 260, h = 200
        const cx = w / 2, cy = h / 2
        const r = Math.min(w, h) * 0.32

        listeners.forEach((l, i) => {
            if (!nodeMap.current.has(l.id)) {
                const angle = (i / Math.max(listeners.length, 1)) * Math.PI * 2 - Math.PI / 2
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
            if (!listeners.find((l) => l.id === id)) {
                nodeMap.current.delete(id)
            }
        }
    }, [listeners])

    const dots = Array.from(nodeMap.current.values())
    const cx = 130, cy = 100

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
                    <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Listener Network</span>
                    <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: `${accentColor}20`, color: accentColor }}
                    >
                        {listeners.length}
                    </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                    {nowPlaying.isPlaying ? '📻 Live' : '⏸ Idle'}
                </span>
            </div>

            {/* Network visualization */}
            <div className="flex-1 relative overflow-hidden">
                <svg
                    ref={svgRef}
                    viewBox="0 0 260 200"
                    className="w-full h-full"
                    style={{ overflow: 'visible' }}
                >
                    {/* Connection lines from center to each listener */}
                    <AnimatePresence>
                        {dots.map((dot) => (
                            <motion.line
                                key={`line-${dot.id}`}
                                x1={cx} y1={cy}
                                x2={dot.x} y2={dot.y}
                                stroke={accentColor}
                                strokeWidth={0.5}
                                strokeOpacity={0.3}
                                strokeDasharray="3 3"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                            />
                        ))}
                    </AnimatePresence>

                    {/* Central broadcast node */}
                    <g>
                        {/* Pulse rings */}
                        {nowPlaying.isPlaying && [1, 2, 3].map((i) => (
                            <motion.circle
                                key={i}
                                cx={cx} cy={cy}
                                r={16}
                                fill="none"
                                stroke={accentColor}
                                strokeWidth={0.5}
                                initial={{ scale: 0.5, opacity: 0.8 }}
                                animate={{ scale: 1 + i * 0.5, opacity: 0 }}
                                transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.7, ease: 'easeOut' }}
                                style={{ transformOrigin: `${cx}px ${cy}px` }}
                            />
                        ))}
                        <circle
                            cx={cx} cy={cy} r={16}
                            fill={`${accentColor}25`}
                            stroke={accentColor}
                            strokeWidth={1}
                        />
                        <text
                            x={cx} y={cy + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={10}
                        >
                            📡
                        </text>
                    </g>

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
                                {/* Pulse ring for active listeners */}
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
                                <text
                                    x={dot.x} y={dot.y + 1}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize={7}
                                    fill="rgba(255,255,255,0.8)"
                                    className="font-mono select-none"
                                >
                                    🎧
                                </text>
                                <text
                                    x={dot.x}
                                    y={dot.y + 14}
                                    textAnchor="middle"
                                    fontSize={5.5}
                                    fill="rgba(148,163,184,0.7)"
                                    className="font-mono select-none"
                                >
                                    {dot.name.slice(0, 8)}
                                </text>
                            </motion.g>
                        ))}
                    </AnimatePresence>
                </svg>

                {/* Empty state */}
                {listeners.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <p className="text-[11px] text-muted-foreground">No listeners connected</p>
                    </div>
                )}
            </div>

            {/* Listener list */}
            {listeners.length > 0 && (
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
                                        {l.name ?? l.id.slice(0, 12)}
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
