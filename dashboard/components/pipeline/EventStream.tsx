'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import type { BotEvent } from '@/types'

const EVENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    info:    { bg: 'rgba(59,130,246,0.15)',   text: '#60A5FA', label: 'INFO' },
    success: { bg: 'rgba(16,185,129,0.15)',   text: '#34D399', label: 'OK' },
    warn:    { bg: 'rgba(245,158,11,0.15)',   text: '#FBBF24', label: 'WARN' },
    error:   { bg: 'rgba(239,68,68,0.15)',    text: '#F87171', label: 'ERR' },
    request: { bg: 'rgba(0,212,255,0.1)',     text: '#00D4FF', label: 'REQ' },
    search:  { bg: 'rgba(139,92,246,0.15)',   text: '#A78BFA', label: 'SRCH' },
    download:{ bg: 'rgba(16,185,129,0.1)',    text: '#6EE7B7', label: 'DL' },
    ffmpeg:  { bg: 'rgba(245,158,11,0.1)',    text: '#FCD34D', label: 'FF' },
    broadcast:{ bg: 'rgba(236,72,153,0.1)',   text: '#F472B6', label: 'BCAST' },
    listener:{ bg: 'rgba(0,212,255,0.08)',    text: '#67E8F9', label: 'USER' },
}

function EventItem({ event }: { event: BotEvent }) {
    const style = EVENT_COLORS[event.type] ?? EVENT_COLORS.info
    const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: 20, height: 0 }}
            animate={{ opacity: 1, x: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex items-start gap-2 py-1.5 px-1 rounded-lg group hover:bg-white/[0.03] transition-colors"
        >
            <span
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                style={{ background: style.bg, color: style.text }}
            >
                {style.label}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/90 leading-relaxed line-clamp-2">
                    {event.message}
                </p>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/60 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {time}
            </span>
        </motion.div>
    )
}

export default function EventStream() {
    const { events, clearEvents, accentColor } = useDashboardStore()

    return (
        <div className="flex flex-col h-full rounded-2xl overflow-hidden"
            style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.05)',
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05] flex-shrink-0">
                <div className="flex items-center gap-2">
                    <motion.div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: accentColor }}
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                    />
                    <span className="text-[11px] font-semibold text-white tracking-wide uppercase">
                        Live Events
                    </span>
                    <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: `${accentColor}20`, color: accentColor }}
                    >
                        {events.length}
                    </span>
                </div>
                {events.length > 0 && (
                    <button
                        onClick={clearEvents}
                        className="text-[10px] text-muted-foreground hover:text-white transition-colors"
                    >
                        clear
                    </button>
                )}
            </div>

            {/* Events list */}
            <div className="flex-1 overflow-y-auto px-3 py-2 event-feed">
                <AnimatePresence initial={false} mode="popLayout">
                    {events.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center h-32 gap-2"
                        >
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.04)' }}
                            >
                                <span className="text-base">📡</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">Waiting for events...</p>
                        </motion.div>
                    ) : (
                        events.map((event) => (
                            <EventItem key={event.id} event={event} />
                        ))
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
