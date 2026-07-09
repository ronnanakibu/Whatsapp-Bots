'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

const getStreamUrl = () => {
    if (process.env.NEXT_PUBLIC_API_URL) {
        return `${process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')}/stream`
    }
    if (typeof window !== 'undefined') {
        const origin = window.location.origin
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            const devHost = process.env.NEXT_PUBLIC_DEV_API_URL || 'http://localhost:25637'
            return `${devHost.replace(/\/$/, '')}/stream`
        }
        return `${origin}/stream`
    }
    return 'http://localhost:25637/stream'
}

const STREAM_URL = getStreamUrl()

export interface AudioPlayerContextType {
    isPlaying: boolean
    isMuted: boolean
    volume: number
    analyser: AnalyserNode | null
    isConnected: boolean
    play: () => void
    pause: () => void
    togglePlay: () => void
    toggleMute: () => void
    setVolume: (vol: number) => void
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null)

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
    const [isPlaying, setIsPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [volume, setVolumeState] = useState(0.8) // Default volume 80%
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
    const [isConnected, setIsConnected] = useState(false)

    const audioCtxRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current.src = ''
            }
            if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
                audioCtxRef.current.close()
            }
        }
    }, [])

    const initAudio = useCallback(() => {
        if (audioRef.current) return audioRef.current

        try {
            const audio = new Audio()
            audio.crossOrigin = 'anonymous'
            // To prevent caching issue on live streams, we append a timestamp
            audio.src = `${STREAM_URL}?t=${Date.now()}`
            audio.volume = isMuted ? 0 : volume
            audioRef.current = audio

            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
            audioCtxRef.current = ctx

            const analyserNode = ctx.createAnalyser()
            analyserNode.fftSize = 256
            analyserNode.smoothingTimeConstant = 0.8
            analyserRef.current = analyserNode

            const source = ctx.createMediaElementSource(audio)
            source.connect(analyserNode)
            analyserNode.connect(ctx.destination) // Connect to destination so user can hear it!
            sourceRef.current = source

            setAnalyser(analyserNode)
            setIsConnected(true)

            return audio
        } catch (err) {
            console.error('[AudioPlayer] Initialization failed:', err)
            return null
        }
    }, [volume, isMuted])

    const play = useCallback(async () => {
        let audio = audioRef.current
        if (!audio) {
            audio = initAudio()
        }

        if (!audio) return

        try {
            // Resume context if suspended (browser autoplay policy)
            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                await audioCtxRef.current.resume()
            }

            // For live stream, reconnecting to the source ensures we get the most real-time audio (reducing latency/buffering catchup)
            audio.src = `${STREAM_URL}?t=${Date.now()}`
            await audio.play()
            setIsPlaying(true)
        } catch (err) {
            console.error('[AudioPlayer] Play failed:', err)
        }
    }, [initAudio])

    const pause = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause()
            // Clear source on pause to disconnect from the live stream and stop buffering
            audioRef.current.src = ''
            setIsPlaying(false)
        }
    }, [])

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            pause()
        } else {
            play()
        }
    }, [isPlaying, play, pause])

    const toggleMute = useCallback(() => {
        if (audioRef.current) {
            const nextMute = !isMuted
            audioRef.current.volume = nextMute ? 0 : volume
            setIsMuted(nextMute)
        } else {
            setIsMuted(!isMuted)
        }
    }, [isMuted, volume])

    const setVolume = useCallback((vol: number) => {
        const normalized = Math.max(0, Math.min(1, vol))
        setVolumeState(normalized)
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : normalized
        }
    }, [isMuted])

    return (
        <AudioPlayerContext.Provider
            value={{
                isPlaying,
                isMuted,
                volume,
                analyser,
                isConnected,
                play,
                pause,
                togglePlay,
                toggleMute,
                setVolume,
            }}
        >
            {children}
        </AudioPlayerContext.Provider>
    )
}

export function useAudioPlayer() {
    const context = useContext(AudioPlayerContext)
    if (!context) {
        throw new Error('useAudioPlayer must be used within an AudioPlayerProvider')
    }
    return context
}
