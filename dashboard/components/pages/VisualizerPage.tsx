'use client'

import dynamic from 'next/dynamic'

const Visualizer = dynamic(() => import('@/components/player/Visualizer'), { ssr: false })

export default function VisualizerPage() {
    return (
        <div className="h-full p-4 flex flex-col gap-3">
            <div className="flex-shrink-0 py-2">
                <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Audio Visualization Lab</h1>
                <p className="text-[11px] text-white/25 mt-0.5">Real-time audio spectrum — switch modes to explore</p>
            </div>
            <div className="flex-1 min-h-0">
                <Visualizer fullPage />
            </div>
        </div>
    )
}