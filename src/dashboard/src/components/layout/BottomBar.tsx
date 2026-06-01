'use client';

import { motion } from 'framer-motion';
import { Play, Pause, SkipForward, Volume2, VolumeX, Radio, Loader2 } from 'lucide-react';
import { useRadioStore } from '@/stores/radioStore';
import { cn } from '@/lib/utils';

interface BottomBarProps {
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Bottom player controls bar — glassmorphism fixed bar with
 * playback controls, volume slider, and stream connection button.
 */
export function BottomBar({ onConnect, onDisconnect }: BottomBarProps) {
  const {
    nowPlaying,
    isPlaying,
    isConnected,
    isBuffering,
    volume,
    isMuted,
    setVolume,
    toggleMute,
    listenerCount,
  } = useRadioStore();

  const handlePlayPause = () => {
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  return (
    <motion.div
      className="fixed bottom-0 left-0 right-0 z-50 glass"
      style={{ height: 'var(--bottom-bar-height)' }}
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25, delay: 0.3 }}
    >
      <div className="h-full flex items-center px-6 gap-6" style={{ paddingLeft: 'calc(var(--sidebar-width) + 24px)' }}>
        {/* Left: Track info (compact) */}
        <div className="flex items-center gap-3 min-w-[200px]">
          {nowPlaying?.thumbnail ? (
            <motion.img
              src={nowPlaying.thumbnail}
              alt=""
              className="w-12 h-12 rounded-lg object-cover"
              style={{
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
              animate={{ scale: isPlaying ? 1 : 0.9, opacity: isPlaying ? 1 : 0.7 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            />
          ) : (
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--bg-surface)' }}
            >
              <Radio className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
            </div>
          )}
          
          <div className="overflow-hidden">
            <p className="text-sm font-medium truncate max-w-[160px]" style={{ color: 'var(--text-primary)' }}>
              {nowPlaying?.title || 'Not Connected'}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
              {nowPlaying?.durationFormatted || '—'}
            </p>
          </div>
        </div>

        {/* Center: Playback controls */}
        <div className="flex-1 flex items-center justify-center gap-4">
          {/* Connect/Disconnect button */}
          <motion.button
            className={cn(
              'relative flex items-center justify-center w-12 h-12 rounded-full',
              'cursor-pointer outline-none focus:outline-none',
              'transition-colors duration-200',
            )}
            style={{
              background: isConnected
                ? 'var(--accent)'
                : 'rgba(255, 255, 255, 0.1)',
              boxShadow: isConnected
                ? '0 0 20px var(--accent-glow)'
                : 'none',
            }}
            onClick={handlePlayPause}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            {isBuffering ? (
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#fff' }} />
            ) : isConnected ? (
              <Pause className="w-5 h-5" style={{ color: '#fff' }} />
            ) : (
              <Play className="w-5 h-5 ml-0.5" style={{ color: 'var(--text-primary)' }} />
            )}
          </motion.button>
        </div>

        {/* Right: Volume + info */}
        <div className="flex items-center gap-4 min-w-[200px] justify-end">
          {/* Listener count */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <motion.span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: isConnected ? '#22c55e' : '#666' }}
              animate={isConnected ? { opacity: [0.5, 1, 0.5] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />
            {listenerCount}
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-2">
            <motion.button
              onClick={toggleMute}
              className="cursor-pointer outline-none p-1 rounded-md hover:bg-white/[0.05]"
              whileTap={{ scale: 0.9 }}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <Volume2 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              )}
            </motion.button>

            <div className="relative w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <motion.div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{ background: 'var(--accent)' }}
                animate={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          </div>

          {/* Quality badge */}
          <span
            className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            128k
          </span>
        </div>
      </div>
    </motion.div>
  );
}
