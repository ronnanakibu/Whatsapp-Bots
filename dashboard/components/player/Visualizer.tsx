'use client'

import { useRef, useEffect, useState } from 'react'
import { useDashboardStore } from '@/lib/store'
import { useAudioPlayer } from '@/hooks/useAudioAnalyzer'

type VisualizerMode = 'spectrum' | 'circular' | 'waveform'

const MODES: { id: VisualizerMode; label: string }[] = [
    { id: 'spectrum',  label: 'Spectrum' },
    { id: 'circular',  label: 'Circular' },
    { id: 'waveform',  label: 'Waveform' },
]

// Simulated frequency data for demo when no real audio
function getDemoData(size: number, t: number): Uint8Array {
    const arr = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        const base = Math.sin(t * 0.002 + i * 0.3) * 60 + 80
        const high = Math.sin(t * 0.008 + i * 0.5) * 30
        arr[i] = Math.max(0, Math.min(255, base + high + Math.random() * 20))
    }
    return arr
}

export default function Visualizer() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animRef = useRef<number>(0)
    const timeRef = useRef(0)
    const [mode, setMode] = useState<VisualizerMode>('spectrum')
    const { accentColor, nowPlaying } = useDashboardStore()
    const { analyser, isPlaying: localIsPlaying } = useAudioPlayer()

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const resize = () => {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio
            canvas.height = canvas.offsetHeight * window.devicePixelRatio
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(canvas)

        const W = () => canvas.offsetWidth
        const H = () => canvas.offsetHeight

        const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null

        const draw = (timestamp: number) => {
            timeRef.current = timestamp
            const w = W(), h = H()
            ctx.clearRect(0, 0, w, h)

            const isPlayingServer = nowPlaying.isPlaying
            const isPlaying = isPlayingServer && localIsPlaying

            let data: Uint8Array
            if (analyser && dataArray && isPlaying) {
                analyser.getByteFrequencyData(dataArray)
                data = dataArray
            } else {
                data = getDemoData(64, timestamp)
            }

            if (mode === 'spectrum') {
                drawSpectrum(ctx, data, w, h, accentColor, isPlaying)
            } else if (mode === 'circular') {
                drawCircular(ctx, data, w, h, accentColor, isPlaying)
            } else if (mode === 'waveform') {
                drawWaveform(ctx, data, w, h, accentColor, isPlaying)
            }

            animRef.current = requestAnimationFrame(draw)
        }

        animRef.current = requestAnimationFrame(draw)
        return () => {
            cancelAnimationFrame(animRef.current)
            ro.disconnect()
        }
    }, [mode, accentColor, nowPlaying.isPlaying, analyser, localIsPlaying])

    return (
        <div className="flex flex-col h-full rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
            {/* Mode switcher */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
                <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Visualizer</span>
                <div className="flex gap-1">
                    {MODES.map((m) => (
                        <button
                            key={m.id}
                            onClick={() => setMode(m.id)}
                            className="text-[10px] px-2 py-1 rounded-lg transition-all duration-200"
                            style={{
                                background: mode === m.id ? `${accentColor}20` : 'rgba(255,255,255,0.04)',
                                color: mode === m.id ? accentColor : 'rgba(148,163,184,0.7)',
                                border: `1px solid ${mode === m.id ? `${accentColor}30` : 'transparent'}`,
                            }}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                />
            </div>
        </div>
    )
}

/* ─── Drawing functions ─── */

function drawSpectrum(
    ctx: CanvasRenderingContext2D,
    data: Uint8Array,
    w: number, h: number,
    accent: string,
    active: boolean
) {
    const bars = 48
    const barW = (w / bars) * 0.7
    const gap = (w / bars) * 0.3
    const alpha = active ? 1 : 0.35

    for (let i = 0; i < bars; i++) {
        const idx = Math.floor((i / bars) * data.length)
        const value = data[idx] / 255
        const barH = Math.max(3, value * h * 0.85)
        const x = i * (barW + gap) + gap / 2

        // Gradient fill
        const grad = ctx.createLinearGradient(0, h, 0, h - barH)
        grad.addColorStop(0, `${accent}AA`)
        grad.addColorStop(1, `#8B5CF699`)

        ctx.fillStyle = grad
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.roundRect(x, h - barH, barW, barH, 2)
        ctx.fill()

        // Reflection
        ctx.globalAlpha = alpha * 0.15
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, h, barW, barH * 0.3, 2)
        ctx.fill()
    }
    ctx.globalAlpha = 1
}

function drawCircular(
    ctx: CanvasRenderingContext2D,
    data: Uint8Array,
    w: number, h: number,
    accent: string,
    active: boolean
) {
    const cx = w / 2, cy = h / 2
    const radius = Math.min(w, h) * 0.28
    const bars = 60
    const alpha = active ? 1 : 0.3

    ctx.globalAlpha = alpha

    // Inner circle
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2)
    ctx.strokeStyle = `${accent}20`
    ctx.lineWidth = 1
    ctx.stroke()

    for (let i = 0; i < bars; i++) {
        const idx = Math.floor((i / bars) * data.length)
        const value = data[idx] / 255
        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2
        const len = value * radius * 0.7
        const x1 = cx + Math.cos(angle) * radius
        const y1 = cy + Math.sin(angle) * radius
        const x2 = cx + Math.cos(angle) * (radius + len)
        const y2 = cy + Math.sin(angle) * (radius + len)

        const hue = (i / bars) * 60 + 200
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `hsl(${hue}, 80%, 65%)`
        ctx.lineWidth = 2.5
        ctx.stroke()
    }

    // Center glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.6)
    grd.addColorStop(0, `${accent}40`)
    grd.addColorStop(1, 'transparent')
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 1
}

function drawWaveform(
    ctx: CanvasRenderingContext2D,
    data: Uint8Array,
    w: number, h: number,
    accent: string,
    active: boolean
) {
    const mid = h / 2
    const alpha = active ? 1 : 0.3

    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(0, mid)

    for (let i = 0; i < data.length; i++) {
        const x = (i / data.length) * w
        const value = (data[i] / 255 - 0.5) * (h * 0.8)
        if (i === 0) ctx.moveTo(x, mid + value)
        else ctx.lineTo(x, mid + value)
    }

    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, `${accent}00`)
    grad.addColorStop(0.2, `${accent}CC`)
    grad.addColorStop(0.8, `#8B5CF6CC`)
    grad.addColorStop(1, `#8B5CF600`)

    ctx.strokeStyle = grad
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Fill below
    ctx.lineTo(w, mid)
    ctx.lineTo(0, mid)
    ctx.closePath()
    const fillGrad = ctx.createLinearGradient(0, mid - h * 0.4, 0, mid)
    fillGrad.addColorStop(0, `${accent}20`)
    fillGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = fillGrad
    ctx.fill()

    ctx.globalAlpha = 1
}
