// types/index.ts
// Type definitions for BOTWA Dashboard

export interface SystemMetrics {
    status: 'online' | 'offline' | string
    uptime: number
    cpuUsage: number
    memoryUsage: number
    memoryTotal: number
    memoryUsed: number
    networkHealth: 'excellent' | 'good' | 'poor' | 'offline' | string
    waStatus: 'connected' | 'connecting' | 'disconnected' | 'offline' | string
    ffmpegStatus: 'active' | 'idle' | 'offline' | string
    activeStreams: number
    connectedUsers: number
    queueSize: number
    timestamp: number
}

export interface Track {
    id: string
    title: string
    url?: string
    duration?: number
    durationFormatted?: string
    thumbnail?: string | null
    requestedBy?: string
}

export interface NowPlaying {
    track: Track | null
    isPlaying: boolean
    listeners: number
    fx: string
    eq: string
    startedAt: number
    bitrate: number
    codec: string
}

export interface BotEvent {
    id: string
    type: 'info' | 'warn' | 'error' | 'success' | string
    message: string
    timestamp: number
    details?: any
}

export type PipelineStage = 
    | 'user' 
    | 'whatsapp' 
    | 'command' 
    | 'search' 
    | 'download' 
    | 'metadata' 
    | 'ffmpeg' 
    | 'broadcast' 
    | 'listeners'
    | string

export type PipelineStageStatus = 'idle' | 'active' | 'success' | 'error' | string

export interface PipelineNode {
    id: PipelineStage
    label: string
    icon: string
    status: PipelineStageStatus
}

export interface AnalyticsData {
    totalCommands: number
    totalMessages: number
    activeUsers: number
    uptime: number
    commandsDistribution: Record<string, number>
    messagesTimeline: Array<{ time: string; count: number }>
    topUsers: Array<{ jid: string; name: string; count: number }>
    // Extended stats
    commandsToday: number
    downloadsToday: number
    mediaProcessed: number
    streamsStarted: number
    peakListeners: number
    avgStreamDuration: string
    topCommands: Array<{ name: string; count: number }>
}

export interface ListenerNode {
    id: string
    ip?: string
    userAgent?: string
    connectedAt: number
    name?: string
    location?: string
}
