'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Music } from 'lucide-react';

/**
 * Large animated album art with glow effects.
 * Pulses subtly when music is playing.
 */
export function AlbumArt() {
  const { nowPlaying, isPlaying } = useRadioStore();
  const { albumColors } = useSettingsStore();
  const thumbnail = nowPlaying?.thumbnail;
  const { primary } = albumColors;

  return (
    <div className="relative flex items-center justify-center">
      {/* Glow behind album art */}
      <motion.div
        className="absolute w-[280px] h-[280px] rounded-3xl"
        style={{
          background: `radial-gradient(circle, rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.35) 0%, transparent 70%)`,
          filter: 'blur(40px)',
        }}
        animate={{
          scale: isPlaying ? [1, 1.05, 1] : 1,
          opacity: isPlaying ? [0.5, 0.8, 0.5] : 0.3,
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Album art container */}
      <motion.div
        className="relative w-[260px] h-[260px] rounded-2xl overflow-hidden"
        style={{
          boxShadow: `0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.15)`,
        }}
        animate={{
          scale: isPlaying ? 1 : 0.95,
        }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <AnimatePresence mode="wait">
          {thumbnail ? (
            <motion.img
              key={thumbnail}
              src={thumbnail}
              alt={nowPlaying?.title || 'Album art'}
              className="w-full h-full object-cover"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              crossOrigin="anonymous"
            />
          ) : (
            <motion.div
              key="placeholder"
              className="w-full h-full flex items-center justify-center"
              style={{ background: 'var(--bg-surface)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Music className="w-16 h-16" style={{ color: 'var(--text-tertiary)' }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtle glass overlay for depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.2) 100%)',
          }}
        />
      </motion.div>
    </div>
  );
}
