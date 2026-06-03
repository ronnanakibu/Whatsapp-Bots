'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useDashboardStore } from '@/lib/store'

import SSEProvider from '@/components/core/SSEProvider'
import DynamicBackground from '@/components/core/DynamicBackground'
import { AudioPlayerProvider } from '@/hooks/useAudioAnalyzer'
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
    const { activeSection, setActiveSection } = useDashboardStore()

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

    // Render content based on active section
    const renderContent = () => {
        switch (activeSection) {
            case 'pipeline':
                return (
                    <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
                        <div className="flex-1 min-w-0">
                            <PipelineView />
                        </div>
                        <div className="w-full lg:w-96 flex-shrink-0 flex flex-col gap-4">
                            <div className="flex-1 min-h-0">
                                <EventStream />
                            </div>
                        </div>
                    </div>
                )
            case 'stream':
                return (
                    <div className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
                        <NowPlaying />
                        <div className="flex-1 min-h-0 flex items-center justify-center">
                            <div className="w-full max-w-2xl h-64 lg:h-96">
                                <Visualizer />
                            </div>
                        </div>
                    </div>
                )
            case 'queue':
                return (
                    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
                        <div className="flex-1 min-w-0">
                            <QueueTimeline />
                        </div>
                    </div>
                )
            case 'analytics':
                return (
                    <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
                        <div className="flex-1 min-w-0">
                            <AnalyticsPanel />
                        </div>
                        <div className="w-full lg:w-96 flex-shrink-0">
                            <div className="h-64 lg:h-full">
                                <ListenerNetwork />
                            </div>
                        </div>
                    </div>
                )
            case 'home':
            default:
                return (
                    <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
                        {/* CENTER — Hero zone */}
                        <div className="flex-1 flex flex-col gap-4 p-4 lg:overflow-y-auto min-w-0">
                            {/* Now Playing — top hero */}
                            <NowPlaying />

                            {/* Pipeline + Visualizer row */}
                            <div className="flex flex-col xl:flex-row gap-4 flex-none xl:flex-1 min-h-0" style={{ minHeight: 420 }}>
                                {/* Pipeline hero */}
                                <div className="flex-1 min-w-0 h-96 xl:h-auto">
                                    <PipelineView />
                                </div>

                                {/* Visualizer */}
                                <div className="w-full xl:w-56 flex-shrink-0 h-48 xl:h-auto">
                                    <Visualizer />
                                </div>
                            </div>

                            {/* Bottom row: Queue + Analytics */}
                            <div className="flex flex-col xl:flex-row gap-4 flex-none" style={{ minHeight: 280 }}>
                                <div className="flex-1 min-w-0 h-64 xl:h-auto">
                                    <QueueTimeline />
                                </div>
                                <div className="w-full xl:w-64 flex-shrink-0 h-64 xl:h-auto">
                                    <AnalyticsPanel />
                                </div>
                            </div>
                        </div>

                        {/* RIGHT column — Events + Network */}
                        <div
                            className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4 p-4 lg:overflow-hidden border-t lg:border-t-0 lg:border-l"
                            style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                        >
                            {/* Event stream */}
                            <div className="flex-1 min-h-0 h-64 lg:h-auto">
                                <EventStream />
                            </div>

                            {/* Listener network */}
                            <div className="h-64 lg:h-[340px] flex-shrink-0">
                                <ListenerNetwork />
                            </div>
                        </div>
                    </div>
                )
        }
    }

    return (
        <SSEProvider>
            <AudioPlayerProvider>
                {/* Ambient background */}
                <DynamicBackground />

                {/* Command palette */}
                <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

                {/* Main layout */}
                <div className="relative z-10 flex flex-col md:flex-row h-screen w-screen overflow-hidden">
                    {/* Left — Sidebar (Hidden on Mobile) */}
                    <div className="hidden md:block h-full">
                        <Sidebar />
                    </div>

                    {/* Mobile Header */}
                    <div className="md:hidden flex items-center justify-between p-4 border-b bg-black/40 backdrop-blur-md" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/10 border border-white/20">
                                <span className="text-white font-bold text-xs">V2</span>
                            </div>
                            <div>
                                <p className="text-sm font-bold text-white leading-tight">BOTWA</p>
                                <p className="text-[10px] text-muted-foreground leading-tight">Command Center</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setCmdOpen(true)}
                            className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/70"
                        >
                            <span className="text-xs">⌘K</span>
                        </button>
                    </div>

                    {/* Main content area */}
                    <div className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
                        {renderContent()}
                    </div>

                    {/* Mobile Bottom Nav */}
                    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-black/80 backdrop-blur-xl border-t border-white/10 flex items-center justify-around px-2 z-50">
                        {['home', 'stream', 'pipeline', 'queue', 'analytics'].map((id) => (
                            <button
                                key={id}
                                onClick={() => setActiveSection(id)}
                                className={`flex flex-col items-center justify-center w-14 h-full gap-1 transition-colors ${
                                    activeSection === id ? 'text-white' : 'text-white/40'
                                }`}
                            >
                                <span className="text-[10px] capitalize font-medium">{id}</span>
                                {activeSection === id && (
                                    <div className="w-1 h-1 rounded-full bg-white absolute bottom-2" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Ctrl+K hint (Desktop only) */}
                <div
                    className="hidden md:flex fixed bottom-4 right-4 z-30 items-center gap-1.5 px-2.5 py-1.5 rounded-lg pointer-events-none"
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
            </AudioPlayerProvider>
        </SSEProvider>
    )
}
