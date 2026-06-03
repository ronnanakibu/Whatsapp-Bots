'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import type { PipelineNode as PipelineNodeType } from '@/types'

interface Props {
    node: PipelineNodeType
    isFirst?: boolean
    isLast?: boolean
}

const STATUS_STYLES: Record<string, { glow: string; border: string; bg: string; pulse: boolean }> = {
    idle: {
        glow: 'transparent',
        border: 'rgba(255,255,255,0.06)',
        bg: 'rgba(255,255,255,0.02)',
        pulse: false,
    },
    active: {
        glow: 'rgba(0,212,255,0.4)',
        border: 'rgba(0,212,255,0.4)',
        bg: 'rgba(0,212,255,0.06)',
        pulse: true,
    },
    success: {
        glow: 'rgba(16,185,129,0.4)',
        border: 'rgba(16,185,129,0.4)',
        bg: 'rgba(16,185,129,0.06)',
        pulse: false,
    },
    error: {
        glow: 'rgba(239,68,68,0.5)',
        border: 'rgba(239,68,68,0.5)',
        bg: 'rgba(239,68,68,0.08)',
        pulse: true,
    },
    processing: {
        glow: 'rgba(139,92,246,0.4)',
        border: 'rgba(139,92,246,0.4)',
        bg: 'rgba(139,92,246,0.06)',
        pulse: true,
    },
}

export default function PipelineNode({ node, isFirst, isLast }: Props) {
    const accentColor = useDashboardStore((s) => s.accentColor)
    const styles = STATUS_STYLES[node.status] ?? STATUS_STYLES.idle

    return (
        <div className="flex flex-col items-center">
            {/* Connector above */}
            {!isFirst && (
                <motion.div
                    className="w-px flex-shrink-0"
                    style={{ height: 20 }}
                    animate={{
                        background: node.status === 'active'
                            ? `linear-gradient(180deg, ${accentColor}80, ${accentColor}20)`
                            : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                    }}
                    transition={{ duration: 0.5 }}
                />
            )}

            {/* Node card */}
            <motion.div
                animate={{
                    boxShadow: styles.pulse
                        ? [`0 0 12px ${styles.glow}`, `0 0 24px ${styles.glow}`, `0 0 12px ${styles.glow}`]
                        : `0 0 8px transparent`,
                    borderColor: styles.border,
                    backgroundColor: styles.bg,
                }}
                transition={{ duration: 1.5, repeat: styles.pulse ? Infinity : 0 }}
                className="relative rounded-xl p-3 flex flex-col items-center gap-1.5 w-[88px] overflow-hidden"
                style={{
                    border: `1px solid ${styles.border}`,
                    backdropFilter: 'blur(8px)',
                    minHeight: 80,
                }}
            >
                {/* Scan line for active */}
                <AnimatePresence>
                    {node.status === 'active' && (
                        <motion.div
                            key="scan"
                            initial={{ top: '-100%' }}
                            animate={{ top: '200%' }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', repeatDelay: 0.5 }}
                            className="absolute left-0 right-0 h-px pointer-events-none"
                            style={{
                                background: `linear-gradient(90deg, transparent, ${accentColor}80, transparent)`,
                            }}
                        />
                    )}
                </AnimatePresence>

                {/* Icon */}
                <motion.span
                    className="text-2xl leading-none"
                    animate={{ scale: node.status === 'active' ? [1, 1.1, 1] : 1 }}
                    transition={{ duration: 1, repeat: node.status === 'active' ? Infinity : 0 }}
                >
                    {node.icon}
                </motion.span>

                {/* Label */}
                <span className="text-[10px] font-medium text-center leading-tight" style={{
                    color: node.status === 'idle' ? 'rgba(148,163,184,0.6)' : 'rgba(255,255,255,0.9)',
                }}>
                    {node.label}
                </span>

                {/* Status badge */}
                <span
                    className="text-[8px] uppercase tracking-widest font-mono px-1.5 py-0.5 rounded-full"
                    style={{
                        background: `${styles.border}30`,
                        color: styles.border === 'rgba(255,255,255,0.06)' ? 'rgba(148,163,184,0.5)' : styles.border,
                    }}
                >
                    {node.status}
                </span>
            </motion.div>

            {/* Connector below */}
            {!isLast && (
                <motion.div
                    className="w-px flex-shrink-0 flex items-center justify-center relative"
                    style={{ height: 20 }}
                    animate={{
                        background: node.status === 'active' || node.status === 'success'
                            ? `linear-gradient(180deg, ${accentColor}40, rgba(139,92,246,0.3))`
                            : 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
                    }}
                    transition={{ duration: 0.5 }}
                >
                    {/* Travelling dot on active connectors */}
                    <AnimatePresence>
                        {(node.status === 'active' || node.status === 'success') && (
                            <motion.div
                                key="dot"
                                className="absolute w-1.5 h-1.5 rounded-full"
                                style={{ background: accentColor }}
                                initial={{ top: 0, opacity: 0 }}
                                animate={{ top: 20, opacity: [0, 1, 1, 0] }}
                                transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }}
                            />
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
        </div>
    )
}
