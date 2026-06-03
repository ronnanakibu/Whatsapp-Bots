'use client'

import { useEffect, useRef } from 'react'
import { useDashboardStore } from '@/lib/store'

export default function DynamicBackground() {
    const accentColor = useDashboardStore((s) => s.accentColor)
    const isPlaying = useDashboardStore((s) => s.nowPlaying.isPlaying)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const animRef = useRef<number>(0)
    const timeRef = useRef(0)

    // Particle system
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const resize = () => {
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
        }
        resize()
        window.addEventListener('resize', resize)

        // Particles
        const particles: Array<{
            x: number; y: number; vx: number; vy: number
            size: number; opacity: number; color: string
        }> = []

        const colors = ['#00D4FF', '#8B5CF6', '#10B981']
        for (let i = 0; i < 60; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2 + 0.5,
                opacity: Math.random() * 0.4 + 0.1,
                color: colors[Math.floor(Math.random() * colors.length)],
            })
        }

        const draw = (t: number) => {
            timeRef.current = t
            ctx.clearRect(0, 0, canvas.width, canvas.height)

            const speed = isPlaying ? 1 : 0.4
            particles.forEach((p) => {
                p.x += p.vx * speed
                p.y += p.vy * speed
                if (p.x < 0) p.x = canvas.width
                if (p.x > canvas.width) p.x = 0
                if (p.y < 0) p.y = canvas.height
                if (p.y > canvas.height) p.y = 0

                ctx.beginPath()
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
                ctx.fillStyle = p.color
                ctx.globalAlpha = p.opacity * (0.7 + 0.3 * Math.sin(t * 0.001 + p.x))
                ctx.fill()
            })
            ctx.globalAlpha = 1

            animRef.current = requestAnimationFrame(draw)
        }

        animRef.current = requestAnimationFrame(draw)
        return () => {
            cancelAnimationFrame(animRef.current)
            window.removeEventListener('resize', resize)
        }
    }, [isPlaying])

    // Parse accent color for gradients
    const accent = accentColor ?? '#00D4FF'

    return (
        <>
            {/* Fixed mesh gradient layer */}
            <div
                className="fixed inset-0 z-0 pointer-events-none transition-all duration-[3000ms]"
                style={{
                    background: `
                        radial-gradient(ellipse at 20% 10%, ${accent}18 0%, transparent 50%),
                        radial-gradient(ellipse at 80% 20%, #8B5CF618 0%, transparent 45%),
                        radial-gradient(ellipse at 10% 80%, #0D1117 0%, transparent 60%),
                        radial-gradient(ellipse at 90% 90%, ${accent}08 0%, transparent 50%),
                        #080C14
                    `,
                }}
            />

            {/* Noise texture overlay */}
            <div
                className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                    backgroundSize: '256px',
                }}
            />

            {/* Particle canvas */}
            <canvas
                ref={canvasRef}
                className="fixed inset-0 z-0 pointer-events-none"
                style={{ opacity: 0.6 }}
            />

            {/* Vignette */}
            <div
                className="fixed inset-0 z-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)',
                }}
            />
        </>
    )
}
