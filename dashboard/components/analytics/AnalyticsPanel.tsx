'use client'

import { useDashboardStore } from '@/lib/store'
import type { AnalyticsData } from '@/types'
import { BarChart3, Download, Radio, Users, Command } from 'lucide-react'
import { motion } from 'framer-motion'

const MOCK_ANALYTICS: AnalyticsData = {
    totalCommands: 0,
    totalMessages: 0,
    uptime: 0,
    commandsDistribution: {},
    messagesTimeline: [],
    topUsers: [],
    commandsToday: 142,
    downloadsToday: 38,
    mediaProcessed: 38,
    streamsStarted: 12,
    activeUsers: 7,
    topCommands: [
        { name: 'play', count: 58 },
        { name: 'skip', count: 24 },
        { name: 'queue', count: 18 },
        { name: 'np', count: 15 },
        { name: 'fx', count: 9 },
    ],
    peakListeners: 14,
    avgStreamDuration: '23m',
}

export default function AnalyticsPanel() {
    const { accentColor, analytics } = useDashboardStore()
    const data = analytics ?? MOCK_ANALYTICS

    const stats = [
        { label: 'Commands', value: data.commandsToday, icon: <Command size={14} />, color: accentColor },
        { label: 'Downloads', value: data.downloadsToday, icon: <Download size={14} />, color: '#10B981' },
        { label: 'Streams', value: data.streamsStarted, icon: <Radio size={14} />, color: '#8B5CF6' },
        { label: 'Peak Users', value: data.peakListeners, icon: <Users size={14} />, color: '#F59E0B' },
    ]

    const maxCmd = Math.max(...data.topCommands.map((c) => c.count))

    return (
        <div
            className="flex flex-col h-full rounded-2xl overflow-hidden"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05] flex-shrink-0">
                <BarChart3 size={13} style={{ color: accentColor }} />
                <span className="text-[11px] font-semibold text-white uppercase tracking-wide">Analytics</span>
                <span className="text-[10px] text-muted-foreground ml-auto">Today</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Stat grid */}
                <div className="grid grid-cols-2 gap-2">
                    {stats.map((s, i) => (
                        <motion.div
                            key={s.label}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="rounded-xl p-3 flex flex-col gap-1"
                            style={{
                                background: `${s.color}08`,
                                border: `1px solid ${s.color}18`,
                            }}
                        >
                            <div className="flex items-center gap-1.5" style={{ color: s.color }}>
                                {s.icon}
                                <span className="text-[10px] text-muted-foreground">{s.label}</span>
                            </div>
                            <span className="text-xl font-bold" style={{ color: s.color }}>
                                {s.value}
                            </span>
                        </motion.div>
                    ))}
                </div>

                {/* Top commands */}
                <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                        Top Commands
                    </p>
                    <div className="space-y-2">
                        {data.topCommands.map((cmd: { name: string; count: number }, i: number) => (
                            <div key={cmd.name} className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-white/60 w-14 flex-shrink-0">
                                    !{cmd.name}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                    <motion.div
                                        className="h-full rounded-full"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${(cmd.count / maxCmd) * 100}%` }}
                                        transition={{ delay: i * 0.05 + 0.1, duration: 0.6, ease: 'easeOut' }}
                                        style={{
                                            background: `linear-gradient(90deg, ${accentColor}, #8B5CF6)`,
                                        }}
                                    />
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground w-6 text-right">
                                    {cmd.count}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Extra stats */}
                <div className="grid grid-cols-2 gap-2 text-center">
                    <div
                        className="rounded-xl py-2 px-3"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                        <p className="text-[9px] text-muted-foreground uppercase">Avg Duration</p>
                        <p className="text-sm font-mono text-white mt-0.5">{data.avgStreamDuration}</p>
                    </div>
                    <div
                        className="rounded-xl py-2 px-3"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                        <p className="text-[9px] text-muted-foreground uppercase">Active Users</p>
                        <p className="text-sm font-mono" style={{ color: accentColor, marginTop: 2 }}>
                            {data.activeUsers}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
