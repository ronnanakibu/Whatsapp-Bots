'use client';

import { useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Layers, History, Trash2, GripVertical, Disc, ArrowRight, CornerDownRight } from 'lucide-react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function QueuePanel() {
  const { queue, setQueue, history, nowPlaying } = useRadioStore();
  const { rightPanelOpen } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue');

  // Handle local queue reordering
  const handleReorder = (newOrder: typeof queue) => {
    // Update local store state instantly for visual feedback
    const reindexedOrder = newOrder.map((track, idx) => ({
      ...track,
      position: idx + 1
    }));
    setQueue(reindexedOrder);
  };

  return (
    <AnimatePresence>
      {rightPanelOpen && (
        <motion.div
          className="fixed top-6 right-6 bottom-6 w-[350px] z-30 flex flex-col glass-panel select-none pointer-events-auto overflow-hidden"
          initial={{ opacity: 0, x: 100, scale: 0.95, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: 100, scale: 0.95, filter: 'blur(10px)' }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        >
          {/* Header tabs */}
          <div className="flex border-b border-white/5 p-3 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'queue'
                  ? 'bg-white/10 text-white border border-white/5'
                  : 'text-white/40 hover:text-white/80'
              }`}
            >
              <Layers className="w-4 h-4" />
              Queue ({queue.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white/10 text-white border border-white/5'
                  : 'text-white/40 hover:text-white/80'
              }`}
            >
              <History className="w-4 h-4" />
              History
            </button>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto custom-scroll p-4">
            <AnimatePresence mode="wait">
              {activeTab === 'queue' ? (
                <motion.div
                  key="queue-list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col"
                >
                  {queue.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-white/30 p-6">
                      <Disc className="w-10 h-10 mb-3 animate-spin-slow opacity-40 text-purple-400" />
                      <span className="text-sm font-semibold">Queue is Empty</span>
                      <p className="text-xs text-white/20 mt-1 max-w-[180px]">
                        Add songs from WhatsApp using the bot command `.play [song]`
                      </p>
                    </div>
                  ) : (
                    <Reorder.Group
                      axis="y"
                      values={queue}
                      onReorder={handleReorder}
                      className="flex flex-col gap-2.5 cursor-grab active:cursor-grabbing"
                    >
                      {queue.map((track) => (
                        <Reorder.Item
                          key={`${track.title}-${track.position}`}
                          value={track}
                          className="glass-panel-hover p-3 rounded-2xl flex items-center gap-3 border border-white/5 hover:border-white/10 transition-colors bg-white/[0.02]"
                          whileDrag={{ scale: 1.03, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.15)' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                        >
                          {/* Reorder drag handle */}
                          <div className="text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing p-1">
                            <GripVertical className="w-4 h-4" />
                          </div>

                          {/* Cover Thumbnail */}
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-900 border border-white/5 relative flex-shrink-0">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Disc className="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-500" />
                            )}
                          </div>

                          {/* Song Details */}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-white line-clamp-1">
                              {track.title}
                            </h4>
                            <span className="text-[10px] text-white/40 font-medium flex items-center gap-1 mt-0.5">
                              <CornerDownRight className="w-3 h-3 text-purple-400 opacity-60" />
                              Requested by {track.requestedBy || 'Bot'}
                            </span>
                          </div>

                          {/* Duration Ticker */}
                          <div className="text-[10px] text-white/50 font-mono font-bold flex-shrink-0">
                            {track.durationFormatted}
                          </div>
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="history-list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-2.5"
                >
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center text-white/30 py-20">
                      <History className="w-8 h-8 mb-3 opacity-30" />
                      <span className="text-xs font-bold uppercase tracking-wider">No Recently Played Tracks</span>
                    </div>
                  ) : (
                    history.map((track, idx) => (
                      <motion.div
                        key={`${track.title}-${idx}`}
                        className="p-3 rounded-2xl flex items-center gap-3 border border-white/5 bg-white/[0.01]"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                      >
                        {/* Cover Thumbnail */}
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-900 border border-white/5 relative flex-shrink-0">
                          {track.thumbnail ? (
                            <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Disc className="w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-500" />
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-white/70 line-clamp-1">
                            {track.title}
                          </h4>
                          <p className="text-[9px] text-white/30 font-medium mt-0.5">
                            Played recently
                          </p>
                        </div>

                        {/* Duration */}
                        <div className="text-[10px] text-white/40 font-mono font-bold">
                          {track.durationFormatted}
                        </div>
                      </motion.div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Active play panel status foot */}
          {nowPlaying && (
            <div className="p-4 border-t border-white/5 bg-black/30 backdrop-blur-md">
              <span className="text-[9px] font-bold uppercase tracking-widest text-purple-400">Now Broadcasting</span>
              <div className="flex items-center gap-2 mt-1">
                <ArrowRight className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <h5 className="text-xs font-bold text-white line-clamp-1">{nowPlaying.title}</h5>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
