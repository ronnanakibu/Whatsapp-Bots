'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { Search, Music2, GitBranch, ListMusic, BarChart3, Radio, Settings, Home, Factory, Network } from 'lucide-react'

const PAGES = [
    { id: 'home', label: 'Mission Control', icon: Home, desc: 'Overview of all systems' },
    { id: 'stream', label: 'Stream', icon: Radio, desc: 'Immersive listening experience' },
    { id: 'pipeline', label: 'Pipeline', icon: GitBranch, desc: 'Live media flow visualization' },
    { id: 'queue', label: 'Queue', icon: ListMusic, desc: 'Track timeline & history' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Platform intelligence' },
    { id: 'visualizer', label: 'Visualizer', icon: Music2, desc: 'Audio visualization lab' },
    { id: 'factory', label: 'Factory', icon: Factory, desc: 'Operational job monitor' },
    { id: 'network', label: 'Network', icon: Network, desc: 'Ecosystem graph' },
    { id: 'settings', label: 'Settings', icon: Settings, desc: 'Configure everything' },
]

export default function SearchPage() {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const { setActiveSection, queue, events, accentColor } = useDashboardStore()

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const filteredPages = query
        ? PAGES.filter(p => p.label.toLowerCase().includes(query.toLowerCase()) || p.desc.toLowerCase().includes(query.toLowerCase()))
        : PAGES

    const filteredTracks = query
        ? (queue || []).filter(t => t.title?.toLowerCase().includes(query.toLowerCase())).slice(0, 4)
        : []

    const filteredEvents = query
        ? (events || []).filter(e => e.message.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
        : []

    const totalItems = filteredPages.length + filteredTracks.length + filteredEvents.length

    useEffect(() => { setSelected(0) }, [query])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') setSelected(s => Math.min(s + 1, totalItems - 1))
            if (e.key === 'ArrowUp') setSelected(s => Math.max(s - 1, 0))
            if (e.key === 'Enter') {
                const item = filteredPages[selected]
                if (item) setActiveSection(item.id)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [filteredPages, selected, totalItems, setActiveSection])

    return (
        <div className="h-full flex flex-col overflow-hidden p-4">
            <div className="flex-shrink-0 py-2 mb-3">
                <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Search</h1>
                <p className="text-[11px] text-white/25 mt-0.5">Navigate anywhere · find anything</p>
            </div>

            {/* Search input */}
            <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 rounded-2xl mb-4"
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${accentColor}20` }}>
                <Search size={16} style={{ color: accentColor }} className="flex-shrink-0" />
                <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Search pages, tracks, events..."
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none font-mono" />
                <div className="flex items-center gap-1 text-white/20">
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.06)' }}>↑↓</kbd>
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.06)' }}>↵</kbd>
                </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto space-y-4" style={{ scrollbarWidth: 'thin' }}>

                {/* Pages */}
                {filteredPages.length > 0 && (
                    <section>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/20 px-1 mb-1.5">Navigation</p>
                        <div className="space-y-0.5">
                            {filteredPages.map((item, idx) => {
                                const Icon = item.icon
                                const isSelected = idx === selected
                                return (
                                    <motion.button key={item.id} onClick={() => setActiveSection(item.id)}
                                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors"
                                        style={{
                                            background: isSelected ? `${accentColor}10` : 'rgba(255,255,255,0.02)',
                                            border: isSelected ? `1px solid ${accentColor}20` : '1px solid transparent',
                                        }}
                                        whileHover={{ x: 2 }}>
                                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                                            style={{ background: isSelected ? `${accentColor}15` : 'rgba(255,255,255,0.05)' }}>
                                            <Icon size={14} style={{ color: isSelected ? accentColor : 'rgba(148,163,184,0.5)' }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium" style={{ color: isSelected ? 'white' : 'rgba(148,163,184,0.8)' }}>
                                                {item.label}
                                            </p>
                                            <p className="text-[10px] text-white/25 mt-0.5">{item.desc}</p>
                                        </div>
                                        {isSelected && (
                                            <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono text-white/30 flex-shrink-0"
                                                style={{ background: 'rgba(255,255,255,0.06)' }}>↵</kbd>
                                        )}
                                    </motion.button>
                                )
                            })}
                        </div>
                    </section>
                )}

                {/* Tracks */}
                {filteredTracks.length > 0 && (
                    <section>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/20 px-1 mb-1.5">Queue Tracks</p>
                        <div className="space-y-0.5">
                            {filteredTracks.map((track, i) => (
                                <div key={track.id ?? i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}>
                                    <Music2 size={13} className="text-white/30 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white/70 truncate">{track.title}</p>
                                        {track.requestedBy && <p className="text-[10px] text-white/25">by {track.requestedBy}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Events */}
                {filteredEvents.length > 0 && (
                    <section>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/20 px-1 mb-1.5">Recent Events</p>
                        <div className="space-y-0.5">
                            {filteredEvents.map((event) => (
                                <div key={event.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
                                    style={{ background: 'rgba(255,255,255,0.02)' }}>
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                                        style={{ background: 'rgba(59,130,246,0.12)', color: '#60A5FA' }}>
                                        {event.type ? event.type.toUpperCase().slice(0, 3) : 'EVT'}
                                    </span>
                                    <p className="text-xs text-white/50">{event.message}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {!query && (
                    <div className="text-center py-8">
                        <p className="text-xs text-white/20 font-mono">Start typing to search...</p>
                    </div>
                )}

                {query && filteredPages.length === 0 && filteredTracks.length === 0 && filteredEvents.length === 0 && (
                    <div className="text-center py-8">
                        <p className="text-sm text-white/25">No results for &quot;{query}&quot;</p>
                    </div>
                )}
            </div>
        </div>
    )
}