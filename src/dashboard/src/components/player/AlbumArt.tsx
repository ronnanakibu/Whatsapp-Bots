'use client';

import { motion } from 'framer-motion';
import { useRadioStore } from '@/stores/radioStore';

export function AlbumArt() {
  const { nowPlaying } = useRadioStore();

  return (
    <motion.div
      className="relative w-64 h-64 rounded-2xl overflow-hidden shadow-2xl"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {nowPlaying?.thumbnail ? (
        <motion.img
          src={nowPlaying.thumbnail}
          alt={nowPlaying.title}
          className="w-full h-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <div className="text-white text-center">
            <div className="text-4xl mb-2">🎵</div>
            <p className="text-sm font-semibold">No Album Art</p>
          </div>
        </div>
      )}
      <motion.div
        className="absolute inset-0 glass-hover"
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
}