'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import {
    Home, Radio, GitBranch, ListMusic, BarChart3,
    Music2, Search, Settings, ChevronRight,
    Factory, Network
} from 'lucide-react'

const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: Home, desc: 'Mission control' },
    { id: 'stream', label: 'Stream', icon: Radio, desc: 'Live listening' },
    { id: 'pipeline', label: 'Pipeline', icon: GitBranch, desc: 'Media flow' },
    { id: 'queue', label: 'Queue', icon: ListMusic, desc: 'Track timeline' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Platform intel' },
    { id: 'visualizer', label: 'Visualizer', icon: Music2, desc: 'Audio viz lab' },
]

const BOTTOM_NAV = [
    { id: 'factory', label: 'Factory', icon: Factory },
    { id: 'network', label: 'Network', icon: Network },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'settings', label: 'Settings', icon: Settings },
]

interface SidebarProps {
    onOpenSearch?: () => void
}

export default function Sidebar({ onOpenSearch }: SidebarProps) {
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

    const handleNav = (id: string) => {
        if (id === 'search' && onOpenSearch) onOpenSearch()
        else setActiveSection(id)
    }

    return (
        <motion.aside
            animate={{ width: sidebarExpanded ? 216 : 60 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="flex-shrink-0 h-full flex flex-col relative z-20"
            style={{
                background: 'rgba(6,9,16,0.92)',
                backdropFilter: 'blur(24px)',
                borderRight: '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* Logo */}
            <div className="flex items-center gap-3 px-3.5 pt-5 pb-4 overflow-hidden flex-shrink-0">
                <motion.div
                    className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center relative font-bold text-sm"
                    style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}35`, color: accentColor }}
                    animate={{ boxShadow: `0 0 ${nowPlaying.isPlaying ? '14px' : '6px'} ${accentColor}30` }}
                    transition={{ duration: 2.5, repeat: Infinity, repeatType: 'reverse' }}
                >
                    B
                </motion.div>
                <AnimatePresence>
                    {sidebarExpanded && (
                        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
                            <p className="text-xs font-bold text-white tracking-[0.08em] font-mono">BOTWA 2.0</p>
                            <p className="text-[9px] text-white/30 font-mono tracking-wider">COMMAND CENTER</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Connection pill */}
            <div className="px-2.5 mb-3 flex-shrink-0">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg overflow-hidden"
                    style={{
                        background: connected ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
                        border: `1px solid ${connected ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)'}`,
                    }}>
                    <motion.div
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: connected ? '#10B981' : '#EF4444' }}
                        animate={{ opacity: connected ? [1, 0.4, 1] : 1 }}
                        transition={{ duration: 2, repeat: Infinity }}
                    />
                    <AnimatePresence>
                        {sidebarExpanded && (
                            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="text-[9px] font-mono tracking-widest"
                                style={{ color: connected ? '#10B981' : '#EF4444' }}>
                                {connected ? 'LIVE' : 'OFFLINE'}
                            </motion.span>
                        )}
                    </AnimatePresence>
                    {sidebarExpanded && connected && (
                        <AnimatePresence>
                            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                className="text-[9px] font-mono text-white/25 ml-auto">
                                {metrics.connectedUsers}
                            </motion.span>
                        </AnimatePresence>
                    )}
                </div>
            </div>

            {/* Main nav */}
            <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                        <motion.button key={item.id} onClick={() => handleNav(item.id)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left relative group"
                            style={{
                                background: isActive ? `${accentColor}0F` : 'transparent',
                                border: isActive ? `1px solid ${accentColor}1A` : '1px solid transparent',
                                color: isActive ? 'white' : 'rgba(148,163,184,0.65)',
                            }}
                            whileHover={{ x: 2 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                            {isActive && (
                                <motion.div layoutId="nav-active" className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full"
                                    style={{ background: accentColor }} />
                            )}
                            <Icon size={15} className="flex-shrink-0" style={{ color: isActive ? accentColor : 'inherit' }} />
                            <AnimatePresence>
                                {sidebarExpanded && (
                                    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.15 }} className="flex-1 min-w-0">
                                        <p className="text-xs font-medium">{item.label}</p>
                                        {isActive && <p className="text-[9px] text-white/25 font-mono">{item.desc}</p>}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.button>
                    )
                })}

                {/* Divider */}
                <div className="mx-2 my-2" style={{ height: '1px', background: 'rgba(255,255,255,0.04)' }} />

                {/* Bottom nav items */}
                {BOTTOM_NAV.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                        <motion.button key={item.id} onClick={() => handleNav(item.id)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left relative"
                            style={{
                                background: isActive ? `${accentColor}0F` : 'transparent',
                                color: isActive ? accentColor : 'rgba(148,163,184,0.4)',
                            }}
                            whileHover={{ x: 2 }}>
                            <Icon size={14} className="flex-shrink-0" />
                            <AnimatePresence>
                                {sidebarExpanded && (
                                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        className="text-xs font-medium">{item.label}</motion.span>
                                )}
                            </AnimatePresence>
                        </motion.button>
                    )
                })}
            </nav>

            {/* Now Playing mini */}
            <AnimatePresence>
                {sidebarExpanded && nowPlaying.track && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                        className="mx-2 mb-2 p-2.5 rounded-xl overflow-hidden flex-shrink-0"
                        style={{ background: `${accentColor}0C`, border: `1px solid ${accentColor}18` }}>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex-shrink-0 overflow-hidden"
                                style={{ background: `${accentColor}25` }}>
                                {nowPlaying.track?.thumbnail && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={nowPlaying.track.thumbnail} alt="" className="w-full h-full object-cover" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-medium text-white truncate">{nowPlaying.track?.title ?? '—'}</p>
                                <p className="text-[9px] font-mono" style={{ color: accentColor }}>
                                    {nowPlaying.isPlaying ? '▶ LIVE' : '⏸ PAUSED'} · {nowPlaying.listeners}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Metrics footer */}
            <AnimatePresence>
                {sidebarExpanded && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="px-3 pb-4 pt-2 space-y-1 border-t flex-shrink-0"
                        style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                        {[
                            ['CPU', `${metrics.cpuUsage.toFixed(0)}%`],
                            ['MEM', `${metrics.memoryUsage.toFixed(0)}%`],
                            ['UP', formatUptime(metrics.uptime)],
                        ].map(([label, value]) => (
                            <div key={label} className="flex justify-between items-center">
                                <span className="text-[9px] font-mono text-white/20">{label}</span>
                                <span className="text-[9px] font-mono text-white/40">{value}</span>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Collapse toggle */}
            <button onClick={() => setSidebarExpanded(!sidebarExpanded)}
                className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center z-30 transition-all hover:scale-110"
                style={{ background: '#0A0D14', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
                <motion.div animate={{ rotate: sidebarExpanded ? 180 : 0 }} transition={{ duration: 0.3 }}>
                    <ChevronRight size={11} className="text-white/30" />
                </motion.div>
            </button>
        </motion.aside>
    )
}

function formatUptime(seconds: number): string {
    if (!seconds) return '—'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h${m}m`
}