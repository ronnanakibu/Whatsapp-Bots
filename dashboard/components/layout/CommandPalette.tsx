'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Command, Music2, GitBranch, ListMusic, BarChart3, Radio, X } from 'lucide-react'
import { useDashboardStore } from '@/lib/store'

const COMMANDS = [
    { id: 'home',       label: 'Go to Home',       icon: Radio,      section: 'home' },
    { id: 'pipeline',   label: 'View Pipeline',    icon: GitBranch,  section: 'pipeline' },
    { id: 'queue',      label: 'View Queue',        icon: ListMusic,  section: 'queue' },
    { id: 'analytics',  label: 'View Analytics',   icon: BarChart3,  section: 'analytics' },
    { id: 'visualizer', label: 'Open Visualizer',  icon: Music2,     section: 'visualizer' },
]

interface CommandPaletteProps {
    open: boolean
    onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const { setActiveSection, queue, nowPlaying, accentColor } = useDashboardStore()

    useEffect(() => {
        if (open) {
            setQuery('')
            setSelected(0)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [open])

    const filtered = query
        ? COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
        : COMMANDS

    // Also show current queue items in results
    const queueResults = query
        ? queue.filter((t) =>
            t.title?.toLowerCase().includes(query.toLowerCase())
          ).slice(0, 3)
        : []

    const totalItems = filtered.length + queueResults.length

    useEffect(() => {
        setSelected(0)
    }, [query])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!open) return
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, totalItems - 1))
            if (e.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0))
            if (e.key === 'Enter') {
                const item = filtered[selected]
                if (item) {
                    setActiveSection(item.section)
                    onClose()
                }
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, filtered, selected, totalItems, setActiveSection, onClose])

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 command-overlay"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        className="fixed left-1/2 top-[20%] -translate-x-1/2 z-50 w-full max-w-lg command-panel rounded-2xl overflow-hidden"
                    >
                        {/* Search Input */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                            <Search size={16} className="text-muted-foreground flex-shrink-0" />
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search commands, tracks..."
                                className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none"
                            />
                            <div className="flex items-center gap-1 text-muted-foreground">
                                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] font-mono">ESC</kbd>
                            </div>
                            <button onClick={onClose}>
                                <X size={14} className="text-muted-foreground hover:text-white" />
                            </button>
                        </div>

                        {/* Now Playing context */}
                        {nowPlaying.track && (
                            <div className="px-4 py-2 border-b border-white/[0.04]">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Now Playing</p>
                                <p className="text-sm text-white truncate">{nowPlaying.track.title}</p>
                            </div>
                        )}

                        {/* Commands */}
                        <div className="py-2 max-h-80 overflow-y-auto">
                            {filtered.length > 0 && (
                                <div>
                                    <p className="px-4 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                                        Navigation
                                    </p>
                                    {filtered.map((item, idx) => {
                                        const Icon = item.icon
                                        const isSelected = idx === selected
                                        return (
                                            <motion.button
                                                key={item.id}
                                                onClick={() => { setActiveSection(item.section); onClose() }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                                                style={{
                                                    background: isSelected ? `${accentColor}12` : 'transparent',
                                                    color: isSelected ? 'white' : 'rgba(148,163,184,0.9)',
                                                }}
                                                whileHover={{ x: 4 }}
                                            >
                                                <Icon size={14} style={{ color: isSelected ? accentColor : 'inherit' }} />
                                                <span className="text-sm">{item.label}</span>
                                                {isSelected && (
                                                    <div className="ml-auto flex items-center gap-1">
                                                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] font-mono">↵</kbd>
                                                    </div>
                                                )}
                                            </motion.button>
                                        )
                                    })}
                                </div>
                            )}

                            {queueResults.length > 0 && (
                                <div className="mt-2">
                                    <p className="px-4 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                                        Queue
                                    </p>
                                    {queueResults.map((track, idx) => {
                                        const isSelected = filtered.length + idx === selected
                                        return (
                                            <div
                                                key={track.id ?? idx}
                                                className="flex items-center gap-3 px-4 py-2.5"
                                                style={{ background: isSelected ? `${accentColor}12` : 'transparent' }}
                                            >
                                                <Music2 size={14} className="text-muted-foreground" />
                                                <div className="min-w-0">
                                                    <p className="text-sm text-white truncate">{track.title}</p>
                                                    {track.requestedBy && (
                                                        <p className="text-[10px] text-muted-foreground">
                                                            by {track.requestedBy}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {filtered.length === 0 && queueResults.length === 0 && (
                                <div className="px-4 py-8 text-center">
                                    <p className="text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
                                </div>
                            )}
                        </div>

                        {/* Footer hint */}
                        <div className="px-4 py-2 border-t border-white/[0.04] flex items-center gap-4">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Command size={10} />
                                <span className="text-[10px]">K to open</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="text-[10px] font-mono">↑↓</span>
                                <span className="text-[10px]">navigate</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="text-[10px] font-mono">↵</span>
                                <span className="text-[10px]">select</span>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
