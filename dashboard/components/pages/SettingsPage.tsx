'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'

const ACCENT_PRESETS = [
    { label: 'Cyan', color: '#00D4FF' },
    { label: 'Purple', color: '#8B5CF6' },
    { label: 'Emerald', color: '#10B981' },
    { label: 'Amber', color: '#F59E0B' },
    { label: 'Pink', color: '#EC4899' },
    { label: 'Blue', color: '#3B82F6' },
]

function SettingRow({ label, description, children }: {
    label: string; description?: string; children: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between py-3.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            <div className="flex-1 min-w-0 mr-4">
                <p className="text-sm text-white/80">{label}</p>
                {description && <p className="text-[11px] text-white/25 mt-0.5">{description}</p>}
            </div>
            <div className="flex-shrink-0">{children}</div>
        </div>
    )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button onClick={() => onChange(!value)}
            className="relative w-9 h-5 rounded-full transition-all duration-200 flex-shrink-0"
            style={{ background: value ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.1)' }}>
            <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                animate={{ left: value ? '18px' : '2px' }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
        </button>
    )
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
    return (
        <select value={value} onChange={e => onChange(e.target.value)}
            className="text-xs font-mono px-2.5 py-1.5 rounded-lg outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid rgba(255,255,255,0.08)`, color: 'rgba(255,255,255,0.7)' }}>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
    )
}

const CATEGORIES = ['Appearance', 'Audio', 'Visualizer', 'Performance', 'Pipeline', 'About']

export default function SettingsPage() {
    const { accentColor, setAccentColor, settings, setSetting } = useDashboardStore()
    const [activeCategory, setActiveCategory] = useState('Appearance')

    const set = (key: keyof typeof settings, val: boolean | string) => setSetting(key, val)

    return (
        <div className="h-full flex overflow-hidden">
            {/* Category sidebar */}
            <div className="w-40 flex-shrink-0 border-r p-2 space-y-0.5"
                style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
                {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setActiveCategory(cat)}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs transition-colors"
                        style={{
                            background: activeCategory === cat ? `${accentColor}12` : 'transparent',
                            color: activeCategory === cat ? 'white' : 'rgba(148,163,184,0.45)',
                            border: activeCategory === cat ? `1px solid ${accentColor}20` : '1px solid transparent',
                        }}>
                        {cat}
                    </button>
                ))}
            </div>

            {/* Settings panel */}
            <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: 'thin' }}>
                <div className="max-w-lg">
                    <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wide mb-1">{activeCategory}</h2>
                    <p className="text-[11px] text-white/25 mb-5">Configure {activeCategory.toLowerCase()} preferences</p>

                    {activeCategory === 'Appearance' && (
                        <div>
                            <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-3">Accent Color</p>
                            <div className="flex gap-2 mb-5 flex-wrap">
                                {ACCENT_PRESETS.map(preset => (
                                    <button key={preset.color} onClick={() => setAccentColor(preset.color)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all"
                                        style={{
                                            background: accentColor === preset.color ? `${preset.color}20` : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${accentColor === preset.color ? `${preset.color}40` : 'rgba(255,255,255,0.06)'}`,
                                        }}>
                                        <div className="w-3 h-3 rounded-full" style={{ background: preset.color }} />
                                        <span style={{ color: accentColor === preset.color ? preset.color : 'rgba(255,255,255,0.4)' }}>
                                            {preset.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <SettingRow label="Dynamic album colors" description="Extract color from album art automatically">
                                <Toggle value={settings.dynamicColors as boolean} onChange={v => set('dynamicColors', v)} />
                            </SettingRow>
                            <SettingRow label="Particle background" description="Animated particles in the background">
                                <Toggle value={settings.particles as boolean} onChange={v => set('particles', v)} />
                            </SettingRow>
                            <SettingRow label="Blur / glassmorphism" description="Backdrop blur on panels">
                                <Toggle value={settings.blur as boolean} onChange={v => set('blur', v)} />
                            </SettingRow>
                            <SettingRow label="Vignette overlay" description="Dark vignette on screen edges">
                                <Toggle value={settings.vignette as boolean} onChange={v => set('vignette', v)} />
                            </SettingRow>
                        </div>
                    )}

                    {activeCategory === 'Audio' && (
                        <div>
                            <SettingRow label="Stream quality" description="Audio bitrate for live stream">
                                <Select value={settings.audioQuality} options={['64kbps', '96kbps', '128kbps', '192kbps', '320kbps']} onChange={v => set('audioQuality', v)} />
                            </SettingRow>
                            <SettingRow label="Latency mode" description="Lower latency = less buffer">
                                <Select value={settings.audioLatency} options={['Low', 'Normal', 'Balanced']} onChange={v => set('audioLatency', v)} />
                            </SettingRow>
                        </div>
                    )}

                    {activeCategory === 'Visualizer' && (
                        <div>
                            <SettingRow label="Default mode" description="Starting visualization mode">
                                <Select value={settings.vizMode} options={['Spectrum', 'Circular', 'Waveform', 'Fluid', 'Galaxy']} onChange={v => set('vizMode', v)} />
                            </SettingRow>
                            <SettingRow label="Render quality" description="Higher quality uses more GPU">
                                <Select value={settings.vizQuality} options={['Low', 'Medium', 'High', 'Ultra']} onChange={v => set('vizQuality', v)} />
                            </SettingRow>
                            <SettingRow label="Waveform reflection" description="Mirror reflection below waveform">
                                <Toggle value={settings.showWaveReflection as boolean} onChange={v => set('showWaveReflection', v)} />
                            </SettingRow>
                        </div>
                    )}

                    {activeCategory === 'Performance' && (
                        <div>
                            <SettingRow label="FPS limit" description="Cap animation frame rate">
                                <Select value={settings.fpsLimit} options={['30', '60', 'Unlimited']} onChange={v => set('fpsLimit', v)} />
                            </SettingRow>
                            <SettingRow label="Particle count" description="Number of background particles">
                                <Select value={settings.particleCount} options={['20', '40', '60', '80', '100']} onChange={v => set('particleCount', v)} />
                            </SettingRow>
                        </div>
                    )}

                    {activeCategory === 'Pipeline' && (
                        <div>
                            <SettingRow label="Pipeline animations" description="Animated node transitions and connectors">
                                <Toggle value={settings.pipelineAnimations as boolean} onChange={v => set('pipelineAnimations', v)} />
                            </SettingRow>
                            <SettingRow label="Auto reconnect" description="Reconnect SSE on disconnect">
                                <Toggle value={settings.autoReconnect as boolean} onChange={v => set('autoReconnect', v)} />
                            </SettingRow>
                            <SettingRow label="Event history" description="Maximum events to keep in memory">
                                <Select value={settings.eventHistory} options={['50', '100', '200', '500']} onChange={v => set('eventHistory', v)} />
                            </SettingRow>
                        </div>
                    )}

                    {activeCategory === 'About' && (
                        <div className="space-y-3">
                            {[
                                ['Dashboard', 'BOTWA 2.0 Command Center'],
                                ['Version', '2.0.0'],
                                ['Stack', 'Next.js 15 · Zustand · Framer Motion'],
                                ['Backend', 'Node.js · Baileys · FFmpeg'],
                                ['Radio', 'Icecast-compatible HTTP stream'],
                            ].map(([key, val]) => (
                                <div key={key} className="flex justify-between items-center py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                                    <span className="text-xs text-white/25 font-mono">{key}</span>
                                    <span className="text-xs text-white/60 font-mono">{val}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}