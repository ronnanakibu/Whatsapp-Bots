'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { AlertTriangle } from 'lucide-react'

function useWaveformBars(active: boolean, barCount = 40) {
    const barsRef = useRef<number[]>(Array(barCount).fill(10))
    const animRef = useRef<number>(0)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const accentColor = useDashboardStore((s) => s.accentColor)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = canvas.offsetWidth * window.devicePixelRatio
        canvas.height = canvas.offsetHeight * window.devicePixelRatio
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
        const W = canvas.offsetWidth
        const H = canvas.offsetHeight

        const draw = () => {
            ctx.clearRect(0, 0, W, H)
            const barW = (W / barCount) * 0.6
            const gap = (W / barCount) * 0.4

            barsRef.current = barsRef.current.map((h, i) => {
                const target = active
                    ? Math.random() * H * 0.8 + H * 0.1
                    : H * 0.15 + Math.sin(Date.now() * 0.003 + i * 0.5) * H * 0.1
                return h + (target - h) * 0.2
            })

            barsRef.current.forEach((barH, i) => {
                const x = i * (barW + gap)
                const grad = ctx.createLinearGradient(0, H, 0, H - barH)
                grad.addColorStop(0, `${accentColor}BB`)
                grad.addColorStop(1, `#8B5CF666`)

                ctx.fillStyle = grad
                ctx.globalAlpha = active ? 0.9 : 0.3
                ctx.beginPath()
                ctx.roundRect(x, H - barH, barW, barH, 2)
                ctx.fill()
            })
            ctx.globalAlpha = 1

            animRef.current = requestAnimationFrame(draw)
        }

        animRef.current = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(animRef.current)
    }, [active, accentColor, barCount])

    return canvasRef
}

export default function FFmpegReactor() {
    const { metrics, accentColor } = useDashboardStore()
    const ffmpegStatus = metrics.ffmpegStatus as string
    const isActive = ffmpegStatus === 'active' || ffmpegStatus === 'online'
    const isError = ffmpegStatus === 'error'
    const waveCanvasRef = useWaveformBars(isActive)
    const { nowPlaying } = useDashboardStore()

    const coreColor = isError ? '#EF4444' : isActive ? accentColor : '#8B5CF6'

    return (
        <div
            className="rounded-2xl overflow-hidden relative"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${coreColor}22`,
            }}
        >
            <div className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-base">⚙️</span>
                        <span className="text-[11px] font-semibold text-white uppercase tracking-wide">
                            FFmpeg Reactor
                        </span>
                    </div>
                    <span
                        className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{
                            background: `${coreColor}18`,
                            color: coreColor,
                            border: `1px solid ${coreColor}30`,
                        }}
                    >
                        {ffmpegStatus}
                    </span>
                </div>

                <div className="flex gap-4 items-center">
                    {/* Reactor core */}
                    <div className="flex-shrink-0 relative w-16 h-16 flex items-center justify-center">
                        {/* Outer glow rings */}
                        <motion.div
                            className="absolute inset-0 rounded-full"
                            style={{ border: `1px solid ${coreColor}40` }}
                            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
                            transition={{ duration: isActive ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.div
                            className="absolute inset-2 rounded-full"
                            style={{ border: `1px solid ${coreColor}60` }}
                            animate={{ scale: [1, 1.08, 1], opacity: [0.8, 0.2, 0.8] }}
                            transition={{ duration: isActive ? 1 : 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                        />

                        {/* Core */}
                        <motion.div
                            className="w-10 h-10 rounded-full flex items-center justify-center"
                            style={{ background: `${coreColor}20`, border: `1px solid ${coreColor}50` }}
                            animate={{
                                boxShadow: isActive
                                    ? [`0 0 10px ${coreColor}60`, `0 0 25px ${coreColor}80`, `0 0 10px ${coreColor}60`]
                                    : `0 0 8px ${coreColor}30`,
                            }}
                            transition={{ duration: isActive ? 0.8 : 3, repeat: Infinity }}
                        >
                            <span className="text-lg">{isError ? '⚠' : '⚙️'}</span>
                        </motion.div>
                    </div>

                    {/* Waveform + stats */}
                    <div className="flex-1 min-w-0">
                        {/* Waveform canvas */}
                        <div className="h-10 relative mb-2">
                            <canvas
                                ref={waveCanvasRef}
                                className="absolute inset-0 w-full h-full"
                            />
                            {!isActive && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-[10px] text-muted-foreground/50 font-mono">STANDBY</span>
                                </div>
                            )}
                        </div>

                        {/* Stats row */}
                        <div className="flex gap-3">
                            <Stat label="BITRATE" value={isActive ? `${nowPlaying.bitrate}k` : '—'} color={coreColor} />
                            <Stat label="CPU" value={`${metrics.cpuUsage.toFixed(0)}%`} />
                            <Stat label="MEM" value={`${metrics.memoryUsage.toFixed(0)}%`} />
                        </div>
                    </div>
                </div>

                {/* Error state */}
                <AnimatePresence>
                    {isError && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3 flex items-center gap-2 p-2 rounded-lg"
                            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                        >
                            <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                            <span className="text-[11px] text-red-400">FFmpeg process error — check logs</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase">{label}</p>
            <p className="text-[11px] font-mono" style={{ color: color ?? 'rgba(255,255,255,0.8)' }}>
                {value}
            </p>
        </div>
    )
}
