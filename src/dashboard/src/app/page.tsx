'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioSSE } from '@/hooks/useRadioSSE';
import { useColorExtract } from '@/hooks/useColorExtract';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Components
import { DynamicBackground } from '@/components/atmosphere/DynamicBackground';
import { Sidebar } from '@/components/layout/Sidebar';
import { RightPanel } from '@/components/layout/RightPanel';
import { BottomBar } from '@/components/layout/BottomBar';
import { AlbumArt } from '@/components/player/AlbumArt';
import { NowPlaying } from '@/components/player/NowPlaying';
import { VisualizerSwitch } from '@/components/visualizer/VisualizerSwitch';

export default function DashboardPage() {
  // Global states
  const { nowPlaying } = useRadioStore();
  const { sidebarExpanded, rightPanelOpen } = useSettingsStore();
  const [activeView, setActiveView] = useState('home');

  // Hooks setup
  useRadioSSE(); // Real-time metadata, queue, stats updates
  useColorExtract(nowPlaying?.thumbnail || null); // Dynamic color extraction from album cover
  const { connect, disconnect } = useRadioStream(); // Audio streaming and visualizer node

  return (
    <main className="relative w-full h-full overflow-hidden text-white font-sans bg-black select-none">
      {/* Background layer */}
      <DynamicBackground />

      {/* Main Layout Grid */}
      <div className="absolute inset-0 z-10 flex">
        {/* Left Sidebar */}
        <Sidebar activeView={activeView} onViewChange={setActiveView} />

        {/* Center Canvas */}
        <motion.div
          className="relative flex-1 flex flex-col min-w-0"
          animate={{
            marginLeft: sidebarExpanded ? 240 : 72,
            marginRight: rightPanelOpen ? 340 : 0,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {/* Main View Area */}
          <div className="relative flex-1 flex items-center justify-center p-8 overflow-hidden">
            <AnimatePresence mode="wait">
              {activeView === 'home' && (
                <motion.div
                  key="home"
                  className="w-full max-w-2xl flex flex-col items-center justify-center relative"
                  initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  <div className="relative z-10">
                    <AlbumArt />
                  </div>
                  <div className="relative z-10 mt-2">
                    <NowPlaying />
                  </div>
                </motion.div>
              )}

              {activeView === 'visualizer' && (
                <motion.div
                  key="visualizer"
                  className="absolute inset-8"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <VisualizerSwitch />
                </motion.div>
              )}

              {/* Add other views (Queue, Settings) here as needed */}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Right Panel */}
        <AnimatePresence>
          {rightPanelOpen && <RightPanel />}
        </AnimatePresence>
      </div>

      {/* Bottom Bar Controls */}
      <BottomBar onConnect={connect} onDisconnect={disconnect} />
    </main>
  );
}
