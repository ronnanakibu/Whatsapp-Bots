'use client'

import { useEffect, useRef } from 'react'
import { useDashboardStore } from '@/lib/store'

function extractDominantColor(img: HTMLImageElement): string {
    try {
        const canvas = document.createElement('canvas')
        const size = 50
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return '#00D4FF'

        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data

        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 16) {
            const cr = data[i], cg = data[i + 1], cb = data[i + 2], a = data[i + 3]
            if (a < 128) continue

            // Skip near-black and near-white
            const brightness = (cr + cg + cb) / 3
            if (brightness < 30 || brightness > 220) continue

            r += cr; g += cg; b += cb; count++
        }

        if (count === 0) return '#00D4FF'

        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)

        // Boost saturation
        const max = Math.max(r, g, b)
        const factor = 1.4
        r = Math.min(255, Math.round((r / max) * 255 * factor * (r / 255)))
        g = Math.min(255, Math.round((g / max) * 255 * factor * (g / 255)))
        b = Math.min(255, Math.round((b / max) * 255 * factor * (b / 255)))

        return `rgb(${r}, ${g}, ${b})`
    } catch {
        return '#00D4FF'
    }
}

export function useAccentColor(thumbnailUrl: string | null | undefined) {
    const setAccentColor = useDashboardStore((s) => s.setAccentColor)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!thumbnailUrl) {
            setAccentColor('#00D4FF')
            return
        }

        if (debounceRef.current) clearTimeout(debounceRef.current)

        debounceRef.current = setTimeout(() => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                const color = extractDominantColor(img)
                setAccentColor(color)
                // Also update CSS variable
                document.documentElement.style.setProperty('--accent-color', color)
            }
            img.onerror = () => setAccentColor('#00D4FF')
            img.src = thumbnailUrl
        }, 300)

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
        }
    }, [thumbnailUrl, setAccentColor])
}
