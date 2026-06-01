'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';
import { Disc, Users, Filter, Sliders, Radio, Cpu, Network, Database } from 'lucide-react';

export function ActivityFeed() {
  const { activityEvents } = useRadioStore();

  // We display only the 4 most recent events in the live HUD feed
  const activeLogs = activityEvents.slice(0, 4);

  const getIcon = (type: string) => {
    switch (type) {
      case 'track':
        return <Disc className="w-3.5 h-3.5 text-purple-400 animate-spin-slow" />;
      case 'listener':
        return <Users className="w-3.5 h-3.5 text-cyan-400" />;
      case 'fx':
        return <Filter className="w-3.5 h-3.5 text-pink-400" />;
      case 'eq':
        return <Sliders className="w-3.5 h-3.5 text-amber-400" />;
      case 'ffmpeg':
        return <Cpu className="w-3.5 h-3.5 text-green-400" />;
      case 'socket':
        return <Network className="w-3.5 h-3.5 text-blue-400" />;
      case 'download':
        return <Database className="w-3.5 h-3.5 text-teal-400" />;
      default:
        return <Radio className="w-3.5 h-3.5 text-zinc-400" />;
    }
  };

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'track':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'listener':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'fx':
        return 'bg-pink-500/10 text-pink-400 border-pink-500/20';
      case 'eq':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'ffmpeg':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'socket':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'download':
        return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      default:
        return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-30 flex flex-col gap-2 max-w-sm pointer-events-none select-none">
      <AnimatePresence mode="popLayout">
        {activeLogs.map((log) => (
          <motion.div
            key={log.id}
            layout
            className="flex items-center gap-3 p-3 rounded-2xl glass-light border border-white/5 pointer-events-auto bg-black/40 backdrop-blur-xl shadow-lg w-full"
            initial={{ opacity: 0, x: -40, scale: 0.9, filter: 'blur(4px)' }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -40, scale: 0.9, filter: 'blur(4px)', transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          >
            {/* Icon Pill */}
            <div className={`p-2 rounded-xl border flex items-center justify-center ${getBadgeColor(log.type)}`}>
              {getIcon(log.type)}
            </div>

            {/* Event Log text */}
            <div className="flex-1 min-w-0 pr-1">
              <span className="text-[10px] text-white/80 font-bold tracking-wide line-clamp-2 leading-relaxed">
                {log.text}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[8px] uppercase tracking-wider text-white/30 font-bold font-mono">
                  {log.type}
                </span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="text-[8px] text-white/30 font-semibold font-mono">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
