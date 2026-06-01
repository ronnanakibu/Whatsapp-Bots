'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';

/**
 * Now Playing metadata display with animated text transitions.
 */
export function NowPlaying() {
  const { nowPlaying, isPlaying, listenerCount, activeFx, activeEq } = useRadioStore();

  return (
    <div className="flex flex-col items-center text-center mt-6 space-y-3">
      {/* Song title */}
      <AnimatePresence mode="wait">
        <motion.h1
          key={nowPlaying?.title || 'idle'}
          className="text-xl font-bold tracking-tight max-w-[400px] leading-tight"
          style={{ color: 'var(--text-primary)' }}
          initial={{ opacity: 0, y: 15, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -15, filter: 'blur(4px)' }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {nowPlaying?.title || 'No Track Playing'}
        </motion.h1>
      </AnimatePresence>

      {/* Artist / Requester */}
      <AnimatePresence mode="wait">
        <motion.p
          key={nowPlaying?.requestedBy || 'none'}
          className="text-sm"
          style={{ color: 'var(--text-secondary)' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {nowPlaying?.requestedBy
            ? `Requested by ${nowPlaying.requestedBy.split('@')[0]}`
            : 'Waiting for requests...'}
        </motion.p>
      </AnimatePresence>

      {/* Metadata badges */}
      <motion.div
        className="flex items-center gap-2 mt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {isPlaying && (
          <>
            {/* Duration badge */}
            {nowPlaying?.durationFormatted && (
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-medium glass-light"
                style={{ color: 'var(--text-secondary)' }}
              >
                {nowPlaying.durationFormatted}
              </span>
            )}
            
            {/* Listeners badge */}
            <span
              className="px-2.5 py-1 rounded-full text-[11px] font-medium glass-light flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-green-400"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              {listenerCount} listening
            </span>

            {/* FX badge */}
            {activeFx !== 'normal' && (
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                FX: {activeFx}
              </span>
            )}

            {/* EQ badge */}
            {activeEq !== 'flat' && (
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                EQ: {activeEq}
              </span>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
