'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

const getStreamUrl = () => {
    if (process.env.NEXT_PUBLIC_STREAM_URL) return process.env.NEXT_PUBLIC_STREAM_URL
    if (typeof window !== 'undefined') {
        if (window.location.port === '3001') {
            return `http://${window.location.hostname}:25637/stream`
        }
        return '/stream'
    }
    return 'http://localhost:8080/stream'
}

const STREAM_URL = getStreamUrl()

export interface AudioAnalyzerState {
    analyser: AnalyserNode | null
    dataArray: Uint8Array | null
    frequencyData: Uint8Array | null
    isConnected: boolean
}

export function useAudioAnalyzer(): AudioAnalyzerState {
    const [state, setState] = useState<AudioAnalyzerState>({
        analyser: null,
        dataArray: null,
        frequencyData: null,
        isConnected: false,
    })

    const audioCtxRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    const connect = useCallback(() => {
        try {
            if (audioCtxRef.current?.state === 'running') return

            const audio = new Audio()
            audio.crossOrigin = 'anonymous'
            audio.src = STREAM_URL
            audio.volume = 0 // silent — only for analysis
            audioRef.current = audio

            const ctx = new AudioContext()
            audioCtxRef.current = ctx

            const analyser = ctx.createAnalyser()
            analyser.fftSize = 256
            analyser.smoothingTimeConstant = 0.8
            analyserRef.current = analyser

            const source = ctx.createMediaElementSource(audio)
            source.connect(analyser)
            // Do NOT connect to destination — we don't want to play sound here
            sourceRef.current = source

            const bufferLength = analyser.frequencyBinCount
            const dataArray = new Uint8Array(bufferLength)
            const frequencyData = new Uint8Array(bufferLength)

            audio.play().catch(() => {
                // Autoplay blocked — that's fine, we still have the analyser
            })

            setState({
                analyser,
                dataArray,
                frequencyData,
                isConnected: true,
            })
        } catch {
            // Web Audio API not available or stream error — graceful degrade
        }
    }, [])

    useEffect(() => {
        // Defer connect to after user gesture if needed
        const handleInteraction = () => {
            connect()
            document.removeEventListener('click', handleInteraction)
            document.removeEventListener('keydown', handleInteraction)
        }

        document.addEventListener('click', handleInteraction, { once: true })
        document.addEventListener('keydown', handleInteraction, { once: true })

        return () => {
            audioRef.current?.pause()
            audioCtxRef.current?.close()
        }
    }, [connect])

    return state
}
