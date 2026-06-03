'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

import SSEProvider from '@/components/core/SSEProvider'
import DynamicBackground from '@/components/core/DynamicBackground'
import Sidebar from '@/components/layout/Sidebar'
import CommandPalette from '@/components/layout/CommandPalette'
import PipelineView from '@/components/pipeline/PipelineView'
import EventStream from '@/components/pipeline/EventStream'
import NowPlaying from '@/components/player/NowPlaying'
import ListenerNetwork from '@/components/network/ListenerNetwork'
import QueueTimeline from '@/components/queue/QueueTimeline'
import AnalyticsPanel from '@/components/analytics/AnalyticsPanel'

// Visualizer uses canvas — dynamic import avoids SSR issues
const Visualizer = dynamic(() => import('@/components/player/Visualizer'), { ssr: false })

export default function DashboardPage() {
    const [cmdOpen, setCmdOpen] = useState(false)

    // Ctrl+K to open command palette
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setCmdOpen((v) => !v)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [])

    return (
        <SSEProvider>
            {/* Ambient background */}
            <DynamicBackground />

            {/* Command palette */}
            <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

            {/* Main layout */}
            <div className="relative z-10 flex h-screen w-screen overflow-hidden">
                {/* Left — Sidebar */}
                <Sidebar />

                {/* Center + Right content area */}
                <div className="flex-1 flex overflow-hidden">

                    {/* CENTER — Hero zone */}
                    <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto min-w-0">
                        {/* Now Playing — top hero */}
                        <NowPlaying />

                        {/* Pipeline + Visualizer row */}
                        <div className="flex gap-4 flex-1 min-h-0" style={{ minHeight: 420 }}>
                            {/* Pipeline hero */}
                            <div className="flex-1 min-w-0">
                                <PipelineView />
                            </div>

                            {/* Visualizer */}
                            <div className="w-56 flex-shrink-0">
                                <Visualizer />
                            </div>
                        </div>

                        {/* Bottom row: Queue + Analytics */}
                        <div className="flex gap-4" style={{ height: 280 }}>
                            <div className="flex-1 min-w-0">
                                <QueueTimeline />
                            </div>
                            <div className="w-64 flex-shrink-0">
                                <AnalyticsPanel />
                            </div>
                        </div>
                    </div>

                    {/* RIGHT column — Events + Network */}
                    <div
                        className="w-72 flex-shrink-0 flex flex-col gap-4 p-4 overflow-hidden border-l"
                        style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                    >
                        {/* Event stream */}
                        <div className="flex-1 min-h-0">
                            <EventStream />
                        </div>

                        {/* Listener network */}
                        <div style={{ height: 340, flexShrink: 0 }}>
                            <ListenerNetwork />
                        </div>
                    </div>

                </div>
            </div>

            {/* Ctrl+K hint */}
            <div
                className="fixed bottom-4 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg pointer-events-none"
                style={{
                    background: 'rgba(0,0,0,0.6)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <kbd className="text-[10px] px-1 py-0.5 rounded bg-white/[0.08] font-mono text-white/60">⌘</kbd>
                <kbd className="text-[10px] px-1 py-0.5 rounded bg-white/[0.08] font-mono text-white/60">K</kbd>
                <span className="text-[10px] text-muted-foreground ml-0.5">Search</span>
            </div>
        </SSEProvider>
    )
}
