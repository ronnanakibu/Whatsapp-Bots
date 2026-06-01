'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Mockup aliran data (Nantinya diganti dengan WebSocket sungguhan dari backend)
const MOCK_EVENTS = [
    { type: 'REQUEST', msg: '+62 812-XXXX requested Joji - Glimpse of Us', color: 'text-blue-400' },
    { type: 'SEARCH', msg: 'Querying YouTube API for optimal source...', color: 'text-yellow-400' },
    { type: 'SEARCH', msg: 'Match found: VideoID [NlprozGcs80]', color: 'text-yellow-400' },
    { type: 'DOWNLOAD', msg: 'Establishing socket connection to source...', color: 'text-cyan-400' },
    { type: 'DOWNLOAD', msg: 'Buffering media chunk (25%)...', color: 'text-cyan-400' },
    { type: 'DOWNLOAD', msg: 'Media buffered successfully.', color: 'text-cyan-400' },
    { type: 'FFMPEG', msg: 'Extracting metadata & album art...', color: 'text-purple-400' },
    { type: 'FFMPEG', msg: 'Transcoding audio stream -> AAC 128kbps...', color: 'text-purple-400' },
    { type: 'FFMPEG', msg: 'Normalizing gain levels...', color: 'text-purple-400' },
    { type: 'BROADCAST', msg: 'Pushing payload to Icecast...', color: 'text-rose-400' },
    { type: 'BROADCAST', msg: 'Queue timeline synced.', color: 'text-rose-400' },
    { type: 'LISTENER', msg: 'User [Ronn] socket connected.', color: 'text-emerald-400' },
    { type: 'LISTENER', msg: 'User [Alex] socket connected.', color: 'text-emerald-400' }
];

export default function LiveEventFeed() {
    const [events, setEvents] = useState<any[]>([]);
    const feedEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll ke bawah setiap ada event baru
    useEffect(() => {
        if (feedEndRef.current) {
            feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [events]);

    // Engine Simulasi Log Realtime
    useEffect(() => {
        let currentIndex = 0;

        const interval = setInterval(() => {
            if (currentIndex < MOCK_EVENTS.length) {
                const newEvent = {
                    id: Date.now() + currentIndex, // ID unik
                    time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
                    ...MOCK_EVENTS[currentIndex]
                };

                setEvents(prev => [...prev, newEvent]);
                currentIndex++;
            } else {
                // Ulangi simulasi agar terminal tidak pernah mati
                currentIndex = 0;
            }
        }, 1200); // Tembakkan 1 event setiap 1.2 detik

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex-1 overflow-y-auto font-mono text-[10px] sm:text-[11px] flex flex-col gap-2 scrollbar-hide pr-2">
            <AnimatePresence initial={false}>
                {events.map((ev) => (
                    <motion.div
                        key={ev.id}
                        initial={{ opacity: 0, x: -10, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                        className="flex gap-3 leading-relaxed"
                    >
                        <span className="opacity-40 shrink-0">{ev.time}</span>
                        <span className="break-words text-white/80">
                            <span className={`font-bold ${ev.color}`}>[{ev.type}]</span> {ev.msg}
                        </span>
                    </motion.div>
                ))}
            </AnimatePresence>
            <div ref={feedEndRef} />
        </div>
    );
}