'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import {
    Home, Radio, GitBranch, ListMusic, BarChart3,
    Music2, Search, Settings, ChevronRight, Wifi, WifiOff
} from 'lucide-react'

const NAV_ITEMS = [
    { id: 'home',       label: 'Home',       icon: Home },
    { id: 'stream',     label: 'Stream',     icon: Radio },
    { id: 'pipeline',   label: 'Pipeline',   icon: GitBranch },
    { id: 'queue',      label: 'Queue',      icon: ListMusic },
    { id: 'analytics',  label: 'Analytics',  icon: BarChart3 },
    { id: 'visualizer', label: 'Visualizer', icon: Music2 },
    { id: 'search',     label: 'Search',     icon: Search },
    { id: 'settings',   label: 'Settings',   icon: Settings },
]

export default function Sidebar() {
    const {
        sidebarExpanded,
        setSidebarExpanded,
        activeSection,
        setActiveSection,
        connected,
        metrics,
        nowPlaying,
        accentColor,
    } = useDashboardStore()

    return (
        <motion.aside
            animate={{ width: sidebarExpanded ? 220 : 64 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex-shrink-0 h-full flex flex-col relative z-20"
            style={{
                background: 'rgba(8, 12, 20, 0.85)',
                backdropFilter: 'blur(20px)',
                borderRight: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            {/* Logo / Brand */}
            <div className="flex items-center gap-3 px-4 pt-5 pb-4 overflow-hidden">
                <motion.div
                    className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center relative"
                    style={{ background: `${accentColor}22`, border: `1px solid ${accentColor}44` }}
                    animate={{ boxShadow: `0 0 ${nowPlaying.isPlaying ? '16px' : '8px'} ${accentColor}44` }}
                    transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                >
                    <Radio size={16} style={{ color: accentColor }} />
                </motion.div>
                <AnimatePresence>
                    {sidebarExpanded && (
                        <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <p className="text-sm font-bold text-white tracking-wide">BOTWA</p>
                            <p className="text-[10px] text-muted-foreground font-mono">v2.0 Command Center</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Connection Status */}
            <div className="px-3 mb-3">
                <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg overflow-hidden"
                    style={{
                        background: connected ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${connected ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    }}
                >
                    {connected
                        ? <Wifi size={12} className="text-emerald-400 flex-shrink-0" />
                        : <WifiOff size={12} className="text-red-400 flex-shrink-0" />
                    }
                    <AnimatePresence>
                        {sidebarExpanded && (
                            <motion.span
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className={`text-[10px] font-mono ${connected ? 'text-emerald-400' : 'text-red-400'}`}
                            >
                                {connected ? 'LIVE' : 'OFFLINE'}
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Nav Items */}
            <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                        <motion.button
                            key={item.id}
                            onClick={() => setActiveSection(item.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-150 relative group"
                            style={{
                                background: isActive ? `${accentColor}12` : 'transparent',
                                border: isActive ? `1px solid ${accentColor}22` : '1px solid transparent',
                                color: isActive ? 'white' : 'rgba(148,163,184,0.8)',
                            }}
                            whileHover={{ x: 2 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        >
                            {/* Active indicator */}
                            {isActive && (
                                <motion.div
                                    layoutId="active-indicator"
                                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                                    style={{ background: accentColor }}
                                />
                            )}
                            <Icon
                                size={16}
                                className="flex-shrink-0"
                                style={{ color: isActive ? accentColor : 'inherit' }}
                            />
                            <AnimatePresence>
                                {sidebarExpanded && (
                                    <motion.span
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -8 }}
                                        transition={{ duration: 0.15 }}
                                        className="text-sm font-medium truncate"
                                    >
                                        {item.label}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>
                    )
                })}
            </nav>

            {/* Now Playing mini */}
            <AnimatePresence>
                {sidebarExpanded && nowPlaying.track && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="mx-2 mb-2 p-3 rounded-xl overflow-hidden"
                        style={{
                            background: `${accentColor}10`,
                            border: `1px solid ${accentColor}20`,
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden"
                                style={{ background: `${accentColor}30` }}
                            >
                                {nowPlaying.track?.thumbnail && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={nowPlaying.track.thumbnail}
                                        alt={nowPlaying.track.title}
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-medium text-white truncate">
                                    {nowPlaying.track?.title ?? '—'}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                    {nowPlaying.isPlaying ? '▶ Playing' : '⏸ Paused'} · {nowPlaying.listeners} listeners
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* System metrics footer */}
            <AnimatePresence>
                {sidebarExpanded && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="px-3 pb-4 pt-2 space-y-1.5 border-t border-white/[0.04]"
                    >
                        <MetricRow label="CPU" value={`${metrics.cpuUsage.toFixed(0)}%`} />
                        <MetricRow label="MEM" value={`${metrics.memoryUsage.toFixed(0)}%`} />
                        <MetricRow label="UPTIME" value={formatUptime(metrics.uptime)} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Collapse toggle */}
            <button
                onClick={() => setSidebarExpanded(!sidebarExpanded)}
                className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center z-30 transition-all hover:scale-110"
                style={{
                    background: '#0D1117',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                }}
            >
                <motion.div animate={{ rotate: sidebarExpanded ? 180 : 0 }} transition={{ duration: 0.3 }}>
                    <ChevronRight size={12} className="text-muted-foreground" />
                </motion.div>
            </button>
        </motion.aside>
    )
}

function MetricRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
            <span className="text-[10px] font-mono text-white/70">{value}</span>
        </div>
    )
}

function formatUptime(seconds: number): string {
    if (!seconds) return '—'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
}
