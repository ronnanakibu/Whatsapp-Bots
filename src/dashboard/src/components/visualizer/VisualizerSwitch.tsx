'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/stores/settingsStore';
import { SpectrumBars } from './SpectrumBars';
import { CircularViz } from './CircularViz';
import { WaveformViz } from './WaveformViz';
import type { VisualizerMode } from '@/types/radio';
import { BarChart3, Circle, AudioWaveform } from 'lucide-react';

const MODES: { id: VisualizerMode; label: string; icon: React.ElementType }[] = [
  { id: 'spectrum', label: 'Spectrum', icon: BarChart3 },
  { id: 'circular', label: 'Circular', icon: Circle },
  { id: 'waveform', label: 'Waveform', icon: AudioWaveform },
  { id: 'none', label: 'Off', icon: Circle },
];

export function VisualizerSwitch() {
  const { visualizerMode, setVisualizerMode } = useSettingsStore();

  return (
    <div className="relative w-full h-full">
      {/* Visualizer canvas */}
      <AnimatePresence mode="wait">
        {visualizerMode === 'spectrum' && (
          <motion.div
            key="spectrum"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4 }}
          >
            <SpectrumBars />
          </motion.div>
        )}
        {visualizerMode === 'circular' && (
          <motion.div
            key="circular"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4 }}
          >
            <CircularViz />
          </motion.div>
        )}
        {visualizerMode === 'waveform' && (
          <motion.div
            key="waveform"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4 }}
          >
            <WaveformViz />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mode switcher (bottom) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 rounded-xl glass">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = visualizerMode === mode.id;
          
          return (
            <motion.button
              key={mode.id}
              className="relative px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer outline-none flex items-center gap-1.5"
              style={{
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
              onClick={() => setVisualizerMode(mode.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'var(--accent-soft)' }}
                  layoutId="viz-mode"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="w-3 h-3 relative z-10" />
              <span className="relative z-10">{mode.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
