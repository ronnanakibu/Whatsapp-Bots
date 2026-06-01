'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Terminal, Shield, Cpu, HardDrive, Wifi, Activity, X } from 'lucide-react';

export function DeveloperConsole() {
  const { developerModeOpen, setDeveloperModeOpen } = useSettingsStore();
  const { queue, listenerCount, activityEvents, isConnected } = useRadioStore();

  const [cpu, setCpu] = useState(12);
  const [ram, setRam] = useState(195.4);
  const [ping, setPing] = useState(14);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // 1. Globally listen for CTRL + SHIFT + D keyboard shortcut
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDeveloperModeOpen(!developerModeOpen);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [developerModeOpen, setDeveloperModeOpen]);

  // 2. Simulate fluctuating server load and latency metrics
  useEffect(() => {
    if (!developerModeOpen) return;

    const interval = setInterval(() => {
      setCpu((prev) => {
        const delta = (Math.random() - 0.5) * 4;
        return Math.min(Math.max(Math.round(prev + delta), 8), 35);
      });
      setRam((prev) => {
        const delta = (Math.random() - 0.5) * 1.5;
        return parseFloat(Math.min(Math.max(prev + delta, 185.0), 220.0).toFixed(1));
      });
      setPing((prev) => {
        const delta = Math.random() > 0.8 ? (Math.random() - 0.5) * 6 : 0;
        return Math.min(Math.max(Math.round(prev + delta), 10), 32);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [developerModeOpen]);

  // Auto-scroll terminal log to bottom on new events
  useEffect(() => {
    if (developerModeOpen) {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activityEvents, developerModeOpen]);

  // Render ASCII loading progress bar
  const renderAsciiBar = (percent: number, max = 15) => {
    const filledCount = Math.round((percent / 100) * max);
    const emptyCount = max - filledCount;
    return `[${'='.repeat(filledCount)}${'.'.repeat(emptyCount)}] ${percent}%`;
  };

  return (
    <AnimatePresence>
      {developerModeOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Main Terminal Box */}
          <motion.div
            className="w-full max-w-4xl h-[80vh] flex flex-col rounded-2xl border border-emerald-500/30 bg-black text-emerald-400 crt-screen font-mono crt-flicker relative overflow-hidden"
            initial={{ scale: 0.9, y: 30, filter: 'blur(10px)' }}
            animate={{ scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ scale: 0.9, y: 30, filter: 'blur(10px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {/* Terminal Scanline Visual Overlay */}
            <div className="crt-scanline" />

            {/* Header Titlebar */}
            <div className="flex items-center justify-between border-b border-emerald-500/20 bg-emerald-950/10 px-4 py-3 select-none">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400 crt-glow">
                <Terminal className="w-4 h-4" />
                RonnBot Stream Control Console — v2.0.4-live
              </div>
              <button
                type="button"
                onClick={() => setDeveloperModeOpen(false)}
                className="p-1 hover:bg-emerald-900/20 rounded-md transition-colors text-emerald-500 hover:text-emerald-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Main Console Content Grid */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
              
              {/* Left Column: Real-time Shell Log Feeder */}
              <div className="flex-1 flex flex-col border-r border-emerald-500/10 p-4 overflow-hidden min-h-0">
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500/60 mb-2 border-b border-emerald-500/10 pb-1">
                  Active Log Stream
                </span>
                
                <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-1.5 text-xs text-emerald-400/90 min-h-0 select-text">
                  <div className="text-emerald-500/50">-- Console initialization complete. Listening for events... --</div>
                  
                  {activityEvents.length === 0 ? (
                    <div className="text-emerald-500/30 mt-4">[IDLE] Waiting for WABOT events...</div>
                  ) : (
                    [...activityEvents].reverse().map((event) => (
                      <div key={event.id} className="flex gap-2.5 items-start leading-relaxed font-mono">
                        <span className="text-emerald-500/40 select-none">
                          [{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                        </span>
                        <div>
                          <span className={`font-bold mr-1.5 uppercase ${
                            event.type === 'socket' ? 'text-blue-400' :
                            event.type === 'ffmpeg' ? 'text-green-400' :
                            event.type === 'track' ? 'text-purple-400' :
                            'text-emerald-500'
                          }`}>
                            [{event.type}]
                          </span>
                          <span className="crt-glow">{event.text}</span>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={consoleEndRef} />
                </div>
              </div>

              {/* Right Column: Hardware Metrics HUD */}
              <div className="w-full md:w-[280px] bg-emerald-950/[0.02] p-4 flex flex-col gap-5 select-none text-xs border-t md:border-t-0 border-emerald-500/10 overflow-y-auto custom-scroll">
                
                {/* 1. Host hardware usage */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500/60 border-b border-emerald-500/10 pb-1 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" /> Hardware CPU/RAM
                  </span>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span>Server CPU:</span>
                      <span className="crt-glow font-bold">{cpu}%</span>
                    </div>
                    <div className="text-emerald-500/40 font-mono text-[10px]">
                      {renderAsciiBar(cpu, 12)}
                    </div>
                    <div className="flex justify-between mt-2">
                      <span>Allocated RAM:</span>
                      <span className="crt-glow font-bold">{ram} MB</span>
                    </div>
                    <div className="text-emerald-500/40 font-mono text-[10px]">
                      {renderAsciiBar(Math.round((ram / 512) * 100), 12)}
                    </div>
                  </div>
                </div>

                {/* 2. SSE Server socket health */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500/60 border-b border-emerald-500/10 pb-1 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5" /> SSE Network Stream
                  </span>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={`font-bold crt-glow ${isConnected ? 'text-emerald-400' : 'text-amber-500 animate-pulse'}`}>
                        {isConnected ? 'STABLE' : 'CONNECTING'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Latency:</span>
                      <span className="crt-glow font-bold">{isConnected ? `${ping}ms` : '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Listeners:</span>
                      <span className="crt-glow font-bold">{listenerCount} active</span>
                    </div>
                  </div>
                </div>

                {/* 3. Audio stream transcode statistics */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500/60 border-b border-emerald-500/10 pb-1 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" /> Transcode Status
                  </span>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span>FFmpeg Engine:</span>
                      <span className="text-green-400 font-bold crt-glow">ACTIVE</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Codec / Rate:</span>
                      <span className="crt-glow font-bold">MP3 / 128kbps</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sync Engine:</span>
                      <span className="crt-glow font-bold">100% OK</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Queue Length:</span>
                      <span className="crt-glow font-bold">{queue.length} track(s)</span>
                    </div>
                  </div>
                </div>

                {/* 4. Help hints */}
                <div className="mt-auto pt-3 border-t border-emerald-500/10 text-[10px] text-emerald-600 leading-relaxed font-mono">
                  <div>* Press <kbd className="bg-emerald-950 px-1 border border-emerald-500/30 rounded text-emerald-500">CTRL+SHIFT+D</kbd> to close.</div>
                  <div className="mt-1">* Run radio command `.skip` from WhatsApp to bypass tracks.</div>
                </div>

              </div>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
