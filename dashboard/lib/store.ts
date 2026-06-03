// lib/store.ts
// Zustand global state for BOTWA Dashboard

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
    SystemMetrics,
    NowPlaying,
    Track,
    BotEvent,
    PipelineNode,
    AnalyticsData,
    ListenerNode,
    PipelineStage,
    PipelineStageStatus,
} from '@/types'

// ─────────────────────────────────────────────
// DEFAULT STATES
// ─────────────────────────────────────────────

const defaultMetrics: SystemMetrics = {
    status: 'offline',
    uptime: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: 0,
    memoryUsed: 0,
    networkHealth: 'offline',
    waStatus: 'offline',
    ffmpegStatus: 'offline',
    activeStreams: 0,
    connectedUsers: 0,
    queueSize: 0,
    timestamp: Date.now(),
}

const defaultNowPlaying: NowPlaying = {
    track: null,
    isPlaying: false,
    listeners: 0,
    fx: 'normal',
    eq: 'flat',
    startedAt: 0,
    bitrate: 128,
    codec: 'mp3',
}

const defaultPipelineNodes: PipelineNode[] = [
    { id: 'user', label: 'User', icon: '👤', status: 'idle' },
    { id: 'whatsapp', label: 'WhatsApp', icon: '💬', status: 'idle' },
    { id: 'command', label: 'Command', icon: '⚡', status: 'idle' },
    { id: 'search', label: 'Search', icon: '🔍', status: 'idle' },
    { id: 'download', label: 'Download', icon: '⬇️', status: 'idle' },
    { id: 'metadata', label: 'Metadata', icon: '📊', status: 'idle' },
    { id: 'ffmpeg', label: 'FFmpeg', icon: '⚙️', status: 'idle' },
    { id: 'broadcast', label: 'Broadcast', icon: '📡', status: 'idle' },
    { id: 'listeners', label: 'Listeners', icon: '🎧', status: 'idle' },
]

// ─────────────────────────────────────────────
// STORE INTERFACE
// ─────────────────────────────────────────────

interface DashboardStore {
    // Connection
    connected: boolean
    setConnected: (v: boolean) => void

    // System metrics
    metrics: SystemMetrics
    setMetrics: (m: Partial<SystemMetrics>) => void

    // Accent color (from album art)
    accentColor: string
    setAccentColor: (c: string) => void

    // Now playing
    nowPlaying: NowPlaying
    setNowPlaying: (n: Partial<NowPlaying>) => void

    // Queue
    queue: Track[]
    setQueue: (q: Track[]) => void
    addToQueue: (t: Track) => void
    removeFromQueue: (id: string) => void

    // Events feed
    events: BotEvent[]
    addEvent: (e: BotEvent) => void
    clearEvents: () => void

    // Pipeline
    pipelineNodes: PipelineNode[]
    updateNode: (id: PipelineStage, update: Partial<PipelineNode>) => void
    setPipelineStatus: (id: PipelineStage, status: PipelineStageStatus) => void

    // Analytics
    analytics: AnalyticsData | null
    setAnalytics: (a: AnalyticsData) => void

    // Listeners
    listeners: ListenerNode[]
    addListener: (l: ListenerNode) => void
    removeListener: (id: string) => void
    updateListener: (id: string, update: Partial<ListenerNode>) => void

    // UI state
    activeSection: string
    setActiveSection: (s: string) => void
    sidebarExpanded: boolean
    setSidebarExpanded: (v: boolean) => void
}

// ─────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────

export const useDashboardStore = create<DashboardStore>()(
    subscribeWithSelector((set, get) => ({
        // Connection
        connected: false,
        setConnected: (v) => set({ connected: v }),

        // System metrics
        metrics: defaultMetrics,
        setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),

        // Accent color
        accentColor: '#00D4FF',
        setAccentColor: (c) => set({ accentColor: c }),

        // Now playing
        nowPlaying: defaultNowPlaying,
        setNowPlaying: (n) => set((s) => ({ nowPlaying: { ...s.nowPlaying, ...n } })),

        // Queue
        queue: [],
        setQueue: (q) => set({ queue: q }),
        addToQueue: (t) => set((s) => ({ queue: [...s.queue, t] })),
        removeFromQueue: (id) => set((s) => ({ queue: s.queue.filter((t) => t.id !== id) })),

        // Events (keep last 100)
        events: [],
        addEvent: (e) => set((s) => ({
            events: [e, ...s.events].slice(0, 100)
        })),
        clearEvents: () => set({ events: [] }),

        // Pipeline
        pipelineNodes: defaultPipelineNodes,
        updateNode: (id, update) => set((s) => ({
            pipelineNodes: s.pipelineNodes.map((n) =>
                n.id === id ? { ...n, ...update } : n
            ),
        })),
        setPipelineStatus: (id, status) => set((s) => ({
            pipelineNodes: s.pipelineNodes.map((n) =>
                n.id === id ? { ...n, status } : n
            ),
        })),

        // Analytics
        analytics: null,
        setAnalytics: (a) => set({ analytics: a }),

        // Listeners
        listeners: [],
        addListener: (l) => set((s) => ({ listeners: [...s.listeners, l] })),
        removeListener: (id) => set((s) => ({
            listeners: s.listeners.filter((l) => l.id !== id)
        })),
        updateListener: (id, update) => set((s) => ({
            listeners: s.listeners.map((l) =>
                l.id === id ? { ...l, ...update } : l
            ),
        })),

        // UI
        activeSection: 'home',
        setActiveSection: (s) => set({ activeSection: s }),
        sidebarExpanded: true,
        setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
    }))
)