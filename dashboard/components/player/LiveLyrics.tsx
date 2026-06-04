'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'
import { useAccentColor } from '@/hooks/useAccentColor'
import { Disc3, Search, Music } from 'lucide-react'

interface LyricLine {
    time: number
    text: string
}

function parseLrc(lrcString: string): LyricLine[] {
    const lines = lrcString.split('\n')
    const lyrics: LyricLine[] = []
    // Match [mm:ss.xx] or [mm:ss.xxx]
    const timeRegEx = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/
    for (const line of lines) {
        const match = timeRegEx.exec(line)
        if (match) {
            const min = parseInt(match[1], 10)
            const sec = parseInt(match[2], 10)
            const msStr = match[3]
            const ms = parseInt(msStr, 10) / (msStr.length === 2 ? 100 : 1000)
            const time = min * 60 + sec + ms
            const text = line.replace(timeRegEx, '').trim()
            lyrics.push({ time, text: text || '...' }) // replace empty lines with ...
        }
    }
    return lyrics
}

export default function LiveLyrics() {
    const { nowPlaying, accentColor } = useDashboardStore()
    const { track, isPlaying } = nowPlaying

    const [lyrics, setLyrics] = useState<LyricLine[]>([])
    const [plainLyrics, setPlainLyrics] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    
    const containerRef = useRef<HTMLDivElement>(null)
    const activeLineRef = useRef<HTMLDivElement>(null)

    // Fetch lyrics when track changes
    useEffect(() => {
        if (!track?.title) {
            setLyrics([])
            setPlainLyrics(null)
            return
        }

        let isMounted = true
        setIsLoading(true)
        setError(false)
        setLyrics([])
        setPlainLyrics(null)

        const fetchLyrics = async () => {
            try {
                // First try to search using lrclib
                // We use search because track title might contain artist like "Alan Walker - Faded"
                const cleanTitle = track.title.replace(/\(Official.*?\)/ig, '').trim()
                const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`)
                if (!res.ok) throw new Error('API Error')
                const data = await res.json()
                
                if (isMounted) {
                    if (data && data.length > 0) {
                        const bestMatch = data.find((d: any) => d.syncedLyrics) || data[0]
                        if (bestMatch.syncedLyrics) {
                            setLyrics(parseLrc(bestMatch.syncedLyrics))
                        } else if (bestMatch.plainLyrics) {
                            setPlainLyrics(bestMatch.plainLyrics)
                        } else {
                            setError(true)
                        }
                    } else {
                        setError(true)
                    }
                    setIsLoading(false)
                }
            } catch (err) {
                if (isMounted) {
                    setError(true)
                    setIsLoading(false)
                }
            }
        }

        // debounce slightly
        const timeout = setTimeout(fetchLyrics, 1000)
        return () => {
            isMounted = false
            clearTimeout(timeout)
        }
    }, [track?.title])

    // Sync loop for synced lyrics
    useEffect(() => {
        if (!isPlaying || !track?.duration || lyrics.length === 0) return

        let animationFrame: number
        
        const sync = () => {
            const elapsed = (Date.now() - nowPlaying.startedAt) / 1000
            
            // Find current line index
            let currentIndex = -1
            for (let i = 0; i < lyrics.length; i++) {
                if (elapsed >= lyrics[i].time) {
                    currentIndex = i
                } else {
                    break
                }
            }
            
            if (currentIndex !== activeIndex) {
                setActiveIndex(currentIndex)
                // Auto scroll to active line
                if (activeLineRef.current && containerRef.current) {
                    activeLineRef.current.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    })
                }
            }
            
            animationFrame = requestAnimationFrame(sync)
        }

        animationFrame = requestAnimationFrame(sync)
        return () => cancelAnimationFrame(animationFrame)
    }, [isPlaying, track, nowPlaying.startedAt, lyrics, activeIndex])

    return (
        <div 
            className="flex flex-col h-full w-full rounded-2xl overflow-hidden relative backdrop-blur-xl"
            style={{ 
                background: 'rgba(8,12,20,0.4)',
                border: `1px solid ${accentColor}20`,
                boxShadow: `inset 0 0 40px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.4)`
            }}
        >
            <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none" />
            <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-black/80 to-transparent z-10 pointer-events-none" />

            {/* Header / Status */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                <div 
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono tracking-wider uppercase backdrop-blur-md"
                    style={{ background: `${accentColor}20`, color: accentColor }}
                >
                    {isLoading ? (
                        <><Search size={10} className="animate-pulse" /> Searching</>
                    ) : lyrics.length > 0 ? (
                        <><Music size={10} /> Live Sync</>
                    ) : plainLyrics ? (
                        <><Disc3 size={10} /> Static Lyrics</>
                    ) : (
                        'No Lyrics'
                    )}
                </div>
            </div>

            <div 
                ref={containerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide py-32 px-6 sm:px-10 relative z-0"
                style={{ scrollBehavior: 'smooth' }}
            >
                <AnimatePresence mode="wait">
                    {isLoading ? (
                        <motion.div 
                            key="loading"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="flex flex-col items-center justify-center h-full text-white/40 gap-4"
                        >
                            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" style={{ borderTopColor: accentColor }} />
                        </motion.div>
                    ) : lyrics.length > 0 ? (
                        <motion.div 
                            key="synced" 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="flex flex-col gap-6"
                        >
                            {lyrics.map((line, idx) => {
                                const isActive = idx === activeIndex
                                const isPassed = idx < activeIndex
                                
                                return (
                                    <div 
                                        key={idx} 
                                        ref={isActive ? activeLineRef : null}
                                        className="transition-all duration-500 ease-out origin-left"
                                        style={{
                                            opacity: isActive ? 1 : isPassed ? 0.3 : 0.5,
                                            transform: `scale(${isActive ? 1.05 : 1})`,
                                            filter: `blur(${isActive ? 0 : 1}px)`
                                        }}
                                    >
                                        <p 
                                            className={`text-2xl sm:text-3xl font-bold leading-tight ${isActive ? 'text-white drop-shadow-lg' : 'text-white/60'}`}
                                            style={{
                                                textShadow: isActive ? `0 0 20px ${accentColor}80` : 'none'
                                            }}
                                        >
                                            {line.text}
                                        </p>
                                    </div>
                                )
                            })}
                        </motion.div>
                    ) : plainLyrics ? (
                        <motion.div 
                            key="plain"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="text-white/60 text-lg sm:text-xl font-medium leading-relaxed whitespace-pre-line text-center"
                        >
                            {plainLyrics}
                        </motion.div>
                    ) : (
                        <motion.div 
                            key="error"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="flex items-center justify-center h-full text-white/30 text-lg font-medium"
                        >
                            {error ? "Couldn't find lyrics for this track." : "Play a track to see lyrics."}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}
