'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/stores/settingsStore';
import { SpectrumVisualizer } from './modes/SpectrumVisualizer';
import { CircularVisualizer } from './modes/CircularVisualizer';
import { WaveformVisualizer } from './modes/WaveformVisualizer';

export function VisualizerSwitch() {
  const { visualizerMode } = useSettingsStore();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={visualizerMode}
        className="w-full h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {visualizerMode === 'spectrum' && <SpectrumVisualizer />}
        {visualizerMode === 'circular' && <CircularVisualizer />}
        {visualizerMode === 'waveform' && <WaveformVisualizer />}
      </motion.div>
    </AnimatePresence>
  );
}