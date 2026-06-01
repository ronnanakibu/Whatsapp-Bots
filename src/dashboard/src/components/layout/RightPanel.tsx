'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ListMusic, Clock, Users, Music, Zap } from 'lucide-react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { QueueTrack, Track } from '@/types/radio';

function QueueItem({ track, index }: { track: QueueTrack; index: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 px-3 py-2 rounded-xl glass-hover cursor-default"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.05 }}
      layout
    >
      {/* Position number */}
      <span
        className="w-5 text-center text-xs font-mono tabular-nums"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {track.position}
      </span>

      {/* Thumbnail */}
      {track.thumbnail ? (
        <img
          src={track.thumbnail}
          alt=""
          className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
        />
      ) : (
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--bg-surface)' }}
        >
          <Music className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {track.title}
        </p>
        <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
          {track.durationFormatted}
        </p>
      </div>
    </motion.div>
  );
}

function HistoryItem({ track, index }: { track: Track; index: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 px-3 py-2 rounded-xl opacity-60"
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.6 }}
      transition={{ delay: index * 0.05 }}
    >
      {/* Thumbnail */}
      {track.thumbnail ? (
        <img
          src={track.thumbnail}
          alt=""
          className="w-8 h-8 rounded-lg object-cover flex-shrink-0 grayscale"
        />
      ) : (
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--bg-surface)' }}
        >
          <Music className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
          {track.title}
        </p>
      </div>
    </motion.div>
  );
}

export function RightPanel() {
  const { queue, history, listenerCount, isPlaying, activeFx, activeEq } = useRadioStore();
  const { rightPanelOpen } = useSettingsStore();

  if (!rightPanelOpen) return null;

  return (
    <motion.aside
      className="fixed right-0 top-0 bottom-0 z-30 glass overflow-hidden flex flex-col"
      style={{
        width: 'var(--right-panel-width)',
        paddingBottom: 'var(--bottom-bar-height)',
      }}
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Live Info
        </h2>
      </div>

      {/* Stats cards */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        <StatCard
          icon={Users}
          label="Listeners"
          value={String(listenerCount)}
          color="var(--accent)"
        />
        <StatCard
          icon={ListMusic}
          label="In Queue"
          value={String(queue.length)}
          color="var(--secondary)"
        />
        <StatCard
          icon={Zap}
          label="FX"
          value={activeFx}
          color="var(--tertiary)"
        />
        <StatCard
          icon={Clock}
          label="EQ"
          value={activeEq}
          color="var(--accent)"
        />
      </div>

      {/* Queue section */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-5 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Up Next ({queue.length})
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <AnimatePresence mode="popLayout">
            {queue.length > 0 ? (
              queue.map((track, i) => (
                <QueueItem key={`${track.title}-${i}`} track={track} index={i} />
              ))
            ) : (
              <motion.div
                className="flex flex-col items-center justify-center py-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <ListMusic className="w-8 h-8 mb-2" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Queue empty
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* History section */}
        {history.length > 0 && (
          <>
            <div className="px-5 py-2 border-t border-white/[0.06]">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Recently Played
              </h3>
            </div>
            <div className="overflow-y-auto px-2 space-y-0.5 max-h-[200px]">
              {history.slice(0, 5).map((track, i) => (
                <HistoryItem key={`hist-${i}`} track={track} index={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </motion.aside>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="glass-light rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </span>
      </div>
      <p className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}
