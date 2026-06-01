'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioSSE } from '@/hooks/useRadioSSE';
import { useColorExtract } from '@/hooks/useColorExtract';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Components
import { DynamicBackground } from '@/components/atmosphere/DynamicBackground';
import { VisualizerSwitch } from '@/components/visualizer/VisualizerSwitch';
import { HeroCenter } from '@/components/player/HeroCenter';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { ActivityFeed } from '@/components/feed/ActivityFeed';
import { DeveloperConsole } from '@/components/developer/DeveloperConsole';
import { MeetDeveloper } from '@/components/developer/MeetDeveloper';
import { Shield, Sparkles, Terminal, Info } from 'lucide-react';

export default function DashboardPage() {
  // Global stores
  const { nowPlaying, listenerCount, isConnected } = useRadioStore();
  const { activeView, setActiveView } = useSettingsStore();

  // Hooks setup
  useRadioSSE(); // Pushes real-time SSE states (queue, metadata) and pushes to activity feed
  useColorExtract(nowPlaying?.thumbnail || null); // sampled canvas colors
  const { connect, disconnect } = useRadioStream(); // Web Audio API streams and updates analyzerData

  return (
    <main className="relative w-full h-full min-h-screen overflow-hidden text-white font-sans bg-black select-none flex flex-col">
      {/* 1. Dynamic Atmosphere background layers (Gradients + film grain) */}
      <DynamicBackground />

      {/* 2. Interactive Audio Visualizers Switcher (Galaxy, Aurora, Storm, etc. rendered in back) */}
      <VisualizerSwitch />

      {/* 3. Floating HUD Header */}
      <header className="absolute top-6 left-6 z-30 flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/5 p-2 px-4 rounded-2xl select-none select-none">
        <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-purple-500 animate-pulse' : 'bg-zinc-600'}`} />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-white/80 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          WABOT Broadcast
        </span>
        <span className="w-1 h-1 rounded-full bg-white/20" />
        <span className="text-[10px] font-bold text-white/50 font-mono uppercase">
          {listenerCount} LISTENERS
        </span>
      </header>

      {/* 4. Main Immersive Visual Center */}
      <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden z-10">
        <AnimatePresence mode="wait">
          {activeView === 'home' && (
            <motion.div
              key="home"
              className="w-full h-full flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.96, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <HeroCenter onConnect={connect} onDisconnect={disconnect} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 5. Floating Glass Queue panel (Toggleable overlay) */}
      <QueuePanel />

      {/* 6. Real-time Log Notification HUD (bottom-left) */}
      <ActivityFeed />

      {/* 7. Hidden Developer Console overlay (Triggered globally via CTRL+SHIFT+D) */}
      <DeveloperConsole />

      {/* 8. Meet The Developer cinematic overlay page */}
      <MeetDeveloper />

      {/* 9. Minimalist Interactive Footer */}
      <footer className="absolute bottom-6 right-6 z-30 flex items-center gap-2 select-none select-none">
        {/* Toggle Meet Dev */}
        <button
          onClick={() => setActiveView('meet-dev')}
          className="p-3 rounded-2xl glass-light border border-white/5 hover:border-white/10 hover:text-white transition-all cursor-pointer flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/60 shadow-lg"
        >
          <Info className="w-4 h-4 text-purple-400" />
          Meet The Developer
        </button>

        {/* Console shortcut hint pill */}
        <div className="hidden sm:flex items-center gap-2 p-3 rounded-2xl glass border border-white/5 text-xs text-white/40 font-mono">
          <Terminal className="w-3.5 h-3.5" />
          <span>Press</span>
          <kbd className="bg-white/10 px-1 border border-white/10 rounded text-white text-[10px]">ctrl</kbd>
          <span>+</span>
          <kbd className="bg-white/10 px-1 border border-white/10 rounded text-white text-[10px]">shift</kbd>
          <span>+</span>
          <kbd className="bg-white/10 px-1 border border-white/10 rounded text-white text-[10px]">d</kbd>
        </div>
      </footer>
    </main>
  );
}
