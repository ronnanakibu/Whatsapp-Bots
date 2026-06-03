'use client'

import { useRef, useEffect, useState } from 'react'
import { useDashboardStore } from '@/lib/store'
import { useAudioPlayer } from '@/hooks/useAudioAnalyzer'

type VisualizerMode = 'spectrum' | 'circular' | 'waveform' | 'fluid' | 'galaxy'

const MODES: { id: VisualizerMode; label: string }[] = [
    { id: 'spectrum', label: 'Spectrum' },
    { id: 'circular', label: 'Circular' },
    { id: 'waveform', label: 'Waveform' },
    { id: 'fluid', label: 'Fluid' },
    { id: 'galaxy', label: 'Galaxy' },
]

function getDemoData(size: number, t: number): Uint8Array {
    const arr = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        const base = Math.sin(t * 0.002 + i * 0.3) * 60 + 80
        const high = Math.sin(t * 0.008 + i * 0.5) * 30
        arr[i] = Math.max(0, Math.min(255, base + high + Math.random() * 20))
    }
    return arr
}

interface Props { compact?: boolean; fullPage?: boolean }

export default function Visualizer({ compact, fullPage }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animRef = useRef<number>(0)
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
            const w = W(), h = H()
            ctx.clearRect(0, 0, w, h)

            const isPlaying = nowPlaying.isPlaying && localIsPlaying
            let data: Uint8Array
            if (analyser && dataArray && isPlaying) {
                analyser.getByteFrequencyData(dataArray)
                data = dataArray
            } else {
                data = getDemoData(64, timestamp)
            }

            switch (mode) {
                case 'spectrum': drawSpectrum(ctx, data, w, h, accentColor, isPlaying); break
                case 'circular': drawCircular(ctx, data, w, h, accentColor, isPlaying); break
                case 'waveform': drawWaveform(ctx, data, w, h, accentColor, isPlaying); break
                case 'fluid': drawFluid(ctx, data, w, h, accentColor, timestamp, isPlaying); break
                case 'galaxy': drawGalaxy(ctx, data, w, h, accentColor, timestamp, isPlaying); break
            }

            animRef.current = requestAnimationFrame(draw)
        }

        animRef.current = requestAnimationFrame(draw)
        return () => { cancelAnimationFrame(animRef.current); ro.disconnect() }
    }, [mode, accentColor, nowPlaying.isPlaying, analyser, localIsPlaying])

    if (compact) {
        return (
            <div className="w-full h-full rounded-2xl overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <canvas ref={canvasRef} className="w-full h-full" />
            </div>
        )
    }

    return (
        <div className={`flex flex-col rounded-2xl overflow-hidden ${fullPage ? 'h-full' : ''}`}
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">Visualizer</span>
                <div className="flex gap-1">
                    {MODES.map(m => (
                        <button key={m.id} onClick={() => setMode(m.id)}
                            className="text-[10px] px-2 py-1 rounded-lg transition-all"
                            style={{
                                background: mode === m.id ? `${accentColor}18` : 'rgba(255,255,255,0.04)',
                                color: mode === m.id ? accentColor : 'rgba(148,163,184,0.5)',
                                border: `1px solid ${mode === m.id ? `${accentColor}25` : 'transparent'}`,
                            }}>
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 relative min-h-0">
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            </div>
        </div>
    )
}

/* ─── Drawing functions ─── */

function drawSpectrum(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number, accent: string, active: boolean) {
    const bars = 48, barW = (w / bars) * 0.65, gap = (w / bars) * 0.35, alpha = active ? 1 : 0.35
    for (let i = 0; i < bars; i++) {
        const value = data[Math.floor((i / bars) * data.length)] / 255
        const barH = Math.max(3, value * h * 0.85)
        const x = i * (barW + gap) + gap / 2
        const grad = ctx.createLinearGradient(0, h, 0, h - barH)
        grad.addColorStop(0, `${accent}BB`); grad.addColorStop(1, '#8B5CF699')
        ctx.fillStyle = grad; ctx.globalAlpha = alpha
        ctx.beginPath(); ctx.roundRect(x, h - barH, barW, barH, 2); ctx.fill()
        ctx.globalAlpha = alpha * 0.12
        ctx.beginPath(); ctx.roundRect(x, h, barW, barH * 0.25, 2); ctx.fill()
    }
    ctx.globalAlpha = 1
}

function drawCircular(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number, accent: string, active: boolean) {
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.28, bars = 60, alpha = active ? 1 : 0.3
    ctx.globalAlpha = alpha
    ctx.beginPath(); ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2)
    ctx.strokeStyle = `${accent}18`; ctx.lineWidth = 1; ctx.stroke()
    for (let i = 0; i < bars; i++) {
        const value = data[Math.floor((i / bars) * data.length)] / 255
        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2
        const len = value * radius * 0.7
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
        ctx.lineTo(cx + Math.cos(angle) * (radius + len), cy + Math.sin(angle) * (radius + len))
        ctx.strokeStyle = `hsl(${(i / bars) * 60 + 200}, 80%, 65%)`
        ctx.lineWidth = 2; ctx.stroke()
    }
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.6)
    grd.addColorStop(0, `${accent}30`); grd.addColorStop(1, 'transparent')
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
}

function drawWaveform(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number, accent: string, active: boolean) {
    const mid = h / 2; ctx.globalAlpha = active ? 1 : 0.3
    ctx.beginPath()
    data.forEach((v, i) => {
        const x = (i / data.length) * w, y = mid + (v / 255 - 0.5) * h * 0.8
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, `${accent}00`); grad.addColorStop(0.2, `${accent}CC`)
    grad.addColorStop(0.8, '#8B5CF6CC'); grad.addColorStop(1, '#8B5CF600')
    ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
    ctx.lineTo(w, mid); ctx.lineTo(0, mid); ctx.closePath()
    const fill = ctx.createLinearGradient(0, mid - h * 0.4, 0, mid)
    fill.addColorStop(0, `${accent}18`); fill.addColorStop(1, 'transparent')
    ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1
}

function drawFluid(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number, accent: string, t: number, active: boolean) {
    const alpha = active ? 1 : 0.3; ctx.globalAlpha = alpha
    const layers = 4
    for (let layer = 0; layer < layers; layer++) {
        const offset = layer * (data.length / layers)
        const amplitude = (data[Math.floor(offset)] / 255) * h * 0.2
        const speed = 0.001 + layer * 0.0005
        const hue = 195 + layer * 30
        ctx.beginPath()
        for (let x = 0; x <= w; x += 4) {
            const idx = Math.floor((x / w) * (data.length / layers) + offset) % data.length
            const wave = Math.sin(x * 0.02 + t * speed + layer) * amplitude * (data[idx] / 255)
            const y = h * 0.5 + wave + (layer - layers / 2) * h * 0.1
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath()
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.3)`)
        grad.addColorStop(1, `hsla(${hue}, 60%, 40%, 0.05)`)
        ctx.fillStyle = grad; ctx.fill()
    }
    ctx.globalAlpha = 1
}

function drawGalaxy(ctx: CanvasRenderingContext2D, data: Uint8Array, w: number, h: number, accent: string, t: number, active: boolean) {
    const cx = w / 2, cy = h / 2, alpha = active ? 1 : 0.3
    ctx.globalAlpha = alpha
    const avg = data.reduce((a, b) => a + b, 0) / data.length / 255
    for (let i = 0; i < data.length; i++) {
        const angle = (i / data.length) * Math.PI * 4 + t * 0.0008
        const r = (i / data.length) * Math.min(w, h) * 0.42
        const brightness = data[i] / 255
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r * 0.5
        const size = brightness * 3 + 0.5
        const hue = 195 + (i / data.length) * 120
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 80%, 70%, ${brightness * 0.8})`; ctx.fill()
    }
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.15)
    grd.addColorStop(0, `${accent}${Math.floor(avg * 80).toString(16).padStart(2, '0')}`)
    grd.addColorStop(1, 'transparent')
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.15, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
}