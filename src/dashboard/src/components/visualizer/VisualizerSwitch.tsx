'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/stores/settingsStore';
<<<<<<< HEAD
import { SpectrumBars } from './SpectrumBars';
import { CircularViz } from './CircularViz';
import { WaveformViz } from './WaveformViz';
import { GalaxyViz } from './GalaxyViz';
import { ParticleStormViz } from './ParticleStormViz';
import { AuroraViz } from './AuroraViz';
=======
import { SpectrumVisualizer } from './modes/SpectrumVisualizer';
import { CircularVisualizer } from './modes/CircularVisualizer';
import { WaveformVisualizer } from './modes/WaveformVisualizer';
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99

export function VisualizerSwitch() {
  const { visualizerMode } = useSettingsStore();

  return (
<<<<<<< HEAD
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
      <AnimatePresence mode="wait">
        {visualizerMode === 'spectrum' && (
          <motion.div
            key="spectrum"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <SpectrumBars />
          </motion.div>
        )}
        {visualizerMode === 'circular' && (
          <motion.div
            key="circular"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <CircularViz />
          </motion.div>
        )}
        {visualizerMode === 'waveform' && (
          <motion.div
            key="waveform"
            className="absolute inset-0 animate-fade-in"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <WaveformViz />
          </motion.div>
        )}
        {visualizerMode === 'galaxy' && (
          <motion.div
            key="galaxy"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <GalaxyViz />
          </motion.div>
        )}
        {visualizerMode === 'particles' && (
          <motion.div
            key="particles"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <ParticleStormViz />
          </motion.div>
        )}
        {visualizerMode === 'aurora' && (
          <motion.div
            key="aurora"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <AuroraViz />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
=======
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
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99
  );
}