'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useDashboardStore } from '@/lib/store'
import type { Track, BotEvent, PipelineStage } from '@/types'

const getSseUrl = () => {
    return 'http://ap2.nzb.zelpstore.id:25637/events'
}

const SSE_URL = getSseUrl()

let eventIdCounter = 0
function mkId() { return `evt-${Date.now()}-${eventIdCounter++}` }

export function useSSE() {
    const esRef = useRef<EventSource | null>(null)
    const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryDelay = useRef(1000)

    const {
        setConnected,
        setNowPlaying,
        setQueue,
        addEvent,
        setPipelineStatus,
        metrics,
        setMetrics,
        setAnalytics,
    } = useDashboardStore()

    const connect = useCallback(() => {
        if (esRef.current) {
            esRef.current.close()
        }

        const es = new EventSource(SSE_URL)
        esRef.current = es

        es.addEventListener('open', () => {
            setConnected(true)
            retryDelay.current = 1000
        })

        // Initial full state
        es.addEventListener('init', (e: MessageEvent) => {
            try {
                const data = JSON.parse(e.data)
                if (data.nowPlaying) {
                    setNowPlaying({
                        track: data.nowPlaying as Track,
                        isPlaying: data.isPlaying ?? false,
                        listeners: data.listeners ?? 0,
                        fx: data.fx ?? 'normal',
                        eq: data.eq ?? 'flat',
                        startedAt: data.nowPlaying?.startedAt ?? Date.now(),
                    })
                }
                if (data.queue) {
                    setQueue(data.queue as Track[])
                }
                if (data.listeners !== undefined) {
                    setMetrics({ connectedUsers: data.listeners, queueSize: data.queueLength ?? 0 })
                }
                if (data.metrics) {
                    setMetrics(data.metrics)
                }
                if (data.analytics) {
                    setAnalytics(data.analytics)
                }
            } catch { /* ignore parse errors */ }
        })

        // Track started
        es.addEventListener('track:start', (e: MessageEvent) => {
            try {
                const track = JSON.parse(e.data) as Track
                setNowPlaying({ track, isPlaying: true, startedAt: Date.now() })
                setPipelineStatus('broadcast' as PipelineStage, 'active')
                setPipelineStatus('ffmpeg' as PipelineStage, 'active')
                addEvent({
                    id: mkId(),
                    type: 'success',
                    message: `▶ Now Playing: ${track.title}`,
                    timestamp: Date.now(),
                })
            } catch { /* ignore */ }
        })

        // Queue update
        es.addEventListener('queue:update', (e: MessageEvent) => {
            try {
                const q = JSON.parse(e.data) as Track[]
                setQueue(q)
                setMetrics({ queueSize: q.length })
            } catch { /* ignore */ }
        })

        // Listeners update
        es.addEventListener('listeners:update', (e: MessageEvent) => {
            try {
                const { count } = JSON.parse(e.data)
                setNowPlaying({ listeners: count })
                setMetrics({ connectedUsers: count })
                addEvent({
                    id: mkId(),
                    type: 'info',
                    message: `🎧 Listeners: ${count} connected`,
                    timestamp: Date.now(),
                })
            } catch { /* ignore */ }
        })

        // Radio idle
        es.addEventListener('radio:idle', () => {
            setNowPlaying({ isPlaying: false, track: null })
            setPipelineStatus('ffmpeg' as PipelineStage, 'idle')
            setPipelineStatus('broadcast' as PipelineStage, 'idle')
            addEvent({
                id: mkId(),
                type: 'info',
                message: '⏸ Radio idle — queue empty',
                timestamp: Date.now(),
            })
        })

        // Radio stop
        es.addEventListener('radio:stop', () => {
            setNowPlaying({ isPlaying: false })
            addEvent({
                id: mkId(),
                type: 'warn',
                message: '⏹ Radio stopped',
                timestamp: Date.now(),
            })
        })

        // FX change
        es.addEventListener('fx:change', (e: MessageEvent) => {
            try {
                const { fx } = JSON.parse(e.data)
                setNowPlaying({ fx })
                addEvent({
                    id: mkId(),
                    type: 'info',
                    message: `🎛 FX changed: ${fx}`,
                    timestamp: Date.now(),
                })
            } catch { /* ignore */ }
        })

        // EQ change
        es.addEventListener('eq:change', (e: MessageEvent) => {
            try {
                const { eq } = JSON.parse(e.data)
                setNowPlaying({ eq })
            } catch { /* ignore */ }
        })

        // Metrics update
        es.addEventListener('metrics', (e: MessageEvent) => {
            try {
                const metricsData = JSON.parse(e.data)
                setMetrics(metricsData)
            } catch { /* ignore */ }
        })

        // Analytics update
        es.addEventListener('analytics', (e: MessageEvent) => {
            try {
                const analyticsData = JSON.parse(e.data)
                setAnalytics(analyticsData)
            } catch { /* ignore */ }
        })

        es.onerror = () => {
            setConnected(false)
            es.close()
            esRef.current = null

            // Exponential backoff retry (max 30s)
            const delay = Math.min(retryDelay.current, 30_000)
            retryDelay.current = delay * 2
            retryTimeout.current = setTimeout(connect, delay)
        }
    }, [setConnected, setNowPlaying, setQueue, addEvent, setPipelineStatus, setMetrics, setAnalytics])

    useEffect(() => {
        connect()
        return () => {
            esRef.current?.close()
            if (retryTimeout.current) clearTimeout(retryTimeout.current)
        }
    }, [connect])
}
