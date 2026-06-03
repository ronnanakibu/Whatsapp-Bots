'use client'

import { useState, useEffect } from 'react'
import { useDashboardStore } from '@/lib/store'

import SSEProvider from '@/components/core/SSEProvider'
import DynamicBackground from '@/components/core/DynamicBackground'
import { AudioPlayerProvider } from '@/hooks/useAudioAnalyzer'
import Sidebar from '@/components/layout/Sidebar'
import CommandPalette from '@/components/layout/CommandPalette'

// Pages
import HomePage from '@/components/pages/HomePage'
import StreamPage from '@/components/pages/StreamPage'
import PipelinePage from '@/components/pages/PipelinePage'
import QueuePage from '@/components/pages/QueuePage'
import AnalyticsPage from '@/components/pages/AnalyticsPage'
import VisualizerPage from '@/components/pages/VisualizerPage'
import SearchPage from '@/components/pages/SearchPage'
import SettingsPage from '@/components/pages/SettingsPage'
import FactoryPage from '@/components/pages/FactoryPage'
import NetworkPage from '@/components/pages/NetworkPage'

const NAV_ITEMS = [
    { id: 'home', label: 'Home', emoji: '⌂' },
    { id: 'stream', label: 'Stream', emoji: '▶' },
    { id: 'pipeline', label: 'Pipeline', emoji: '⬡' },
    { id: 'queue', label: 'Queue', emoji: '≡' },
    { id: 'analytics', label: 'Analytics', emoji: '◈' },
    { id: 'visualizer', label: 'Visual', emoji: '◎' },
]

function renderPage(section: string) {
    switch (section) {
        case 'home': return <HomePage />
        case 'stream': return <StreamPage />
        case 'pipeline': return <PipelinePage />
        case 'queue': return <QueuePage />
        case 'analytics': return <AnalyticsPage />
        case 'visualizer': return <VisualizerPage />
        case 'search': return <SearchPage />
        case 'settings': return <SettingsPage />
        case 'factory': return <FactoryPage />
        case 'network': return <NetworkPage />
        default: return <HomePage />
    }
}

export default function DashboardPage() {
    const [cmdOpen, setCmdOpen] = useState(false)
    const { activeSection, setActiveSection } = useDashboardStore()

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
            <AudioPlayerProvider>
                <DynamicBackground />
                <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

                <div className="relative z-10 flex h-screen w-screen overflow-hidden">
                    {/* Sidebar */}
                    <div className="hidden md:block h-full flex-shrink-0">
                        <Sidebar onOpenSearch={() => { setActiveSection('search'); setCmdOpen(false) }} />
                    </div>

                    {/* Main */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        {/* Mobile header */}
                        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
                            style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(8,12,20,0.9)', backdropFilter: 'blur(20px)' }}>
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                                    style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF' }}>
                                    B
                                </div>
                                <span className="text-sm font-semibold text-white tracking-wide">BOTWA 2.0</span>
                            </div>
                            <button onClick={() => setCmdOpen(true)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-white/50"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <span>⌘</span><span>K</span>
                            </button>
                        </div>

                        {/* Page content — each page manages its own scrolling */}
                        <div className="flex-1 overflow-hidden">
                            {renderPage(activeSection)}
                        </div>

                        {/* Mobile bottom nav */}
                        <div className="md:hidden flex-shrink-0 h-16 flex items-center justify-around px-2 border-t"
                            style={{ background: 'rgba(8,12,20,0.95)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,255,255,0.06)' }}>
                            {NAV_ITEMS.map(item => (
                                <button key={item.id} onClick={() => setActiveSection(item.id)}
                                    className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all"
                                    style={{ color: activeSection === item.id ? '#00D4FF' : 'rgba(148,163,184,0.5)' }}>
                                    <span className="text-base">{item.emoji}</span>
                                    <span className="text-[9px] font-mono uppercase tracking-wider">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Ctrl+K hint */}
                <div className="hidden md:flex fixed bottom-4 right-4 z-30 items-center gap-1.5 px-2.5 py-1.5 rounded-lg pointer-events-none"
                    style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)' }}>
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono text-white/40" style={{ background: 'rgba(255,255,255,0.06)' }}>⌘K</kbd>
                    <span className="text-[10px] text-white/30">search</span>
                </div>
            </AudioPlayerProvider>
        </SSEProvider>
    )
}