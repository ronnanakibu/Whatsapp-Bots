'use client';

import { motion } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';

export function NowPlaying() {
  const { nowPlaying } = useRadioStore();

  if (!nowPlaying) {
    return (
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <p className="text-secondary">No track playing</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="text-center max-w-md"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.h1
        className="text-3xl font-bold glow-text mb-2 line-clamp-2"
        key={nowPlaying.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {nowPlaying.title}
      </motion.h1>
      <motion.p
        className="text-lg text-secondary line-clamp-1"
        key={`artist-${nowPlaying.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        {nowPlaying.artist}
      </motion.p>
      {nowPlaying.duration && (
        <motion.div
          className="mt-4 w-full bg-white/10 rounded-full h-1 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500"
            initial={{ width: '0%' }}
            animate={{ width: `${nowPlaying.currentTime ? (nowPlaying.currentTime / nowPlaying.duration) * 100 : 0}%` }}
            transition={{ duration: 0.1 }}
          />
        </motion.div>
      )}
    </motion.div>
  );
}