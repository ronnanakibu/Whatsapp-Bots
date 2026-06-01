'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { User, MessageSquare, Search, Download, Cpu, Radio } from 'lucide-react';

const STAGES = [
  { id: 'user', icon: User, label: 'USER', color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/10', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.5)]' },
  { id: 'wa', icon: MessageSquare, label: 'SOCKET', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.5)]' },
  { id: 'search', icon: Search, label: 'RESOLVE', color: 'text-yellow-400', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', glow: 'shadow-[0_0_15px_rgba(234,179,8,0.5)]' },
  { id: 'dl', icon: Download, label: 'BUFFER', color: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', glow: 'shadow-[0_0_15px_rgba(6,182,212,0.5)]' },
  { id: 'ffmpeg', icon: Cpu, label: 'FFMPEG CORE', color: 'text-purple-400', border: 'border-purple-500/50', bg: 'bg-purple-500/20', glow: 'shadow-[0_0_30px_rgba(168,85,247,0.8)]', isLarge: true },
  { id: 'broadcast', icon: Radio, label: 'BROADCAST', color: 'text-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.5)]' },
];

export default function PipelineVisualizer() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative px-8">
      
      {/* Garis Koneksi Utama (Background Line) */}
      <div className="absolute top-1/2 left-12 right-12 h-[2px] bg-white/10 -translate-y-1/2 z-0" />

      {/* Container Pipeline */}
      <div className="w-full flex items-center justify-between relative z-10">
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          const isLast = index === STAGES.length - 1;

          return (
            <React.Fragment key={stage.id}>
              {/* Node Item */}
              <div className="flex flex-col items-center gap-4 relative">
                <motion.div 
                  initial={{ opacity: 0.5, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ 
                    duration: 1.5, 
                    repeat: Infinity, 
                    repeatType: 'reverse',
                    delay: index * 0.2 // Efek menyala berurutan
                  }}
                  className={`
                    flex items-center justify-center rounded-full backdrop-blur-md
                    border ${stage.border} ${stage.bg} ${stage.glow}
                    ${stage.isLarge ? 'w-24 h-24 border-2' : 'w-16 h-16'}
                  `}
                >
                  <Icon size={stage.isLarge ? 40 : 24} className={stage.color} />
                  
                  {/* Efek Waveform khusus untuk FFmpeg */}
                  {stage.isLarge && (
                    <motion.div 
                      animate={{ rotate: 360 }} 
                      transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-0 rounded-full border border-dashed border-purple-500/50"
                    />
                  )}
                </motion.div>

                {/* Label Node */}
                <span className={`font-mono text-[10px] font-bold tracking-widest ${stage.color}`}>
                  {stage.label}
                </span>
              </div>

              {/* Animasi Paket Data Bergerak di antara Node */}
              {!isLast && (
                <div className="flex-1 relative h-[2px] mx-2 flex items-center">
                   <motion.div
                     initial={{ left: "0%", opacity: 0 }}
                     animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
                     transition={{
                       duration: 1.5,
                       repeat: Infinity,
                       ease: "linear",
                       delay: index * 0.4
                     }}
                     className="absolute w-8 h-[2px] bg-white rounded-full shadow-[0_0_10px_#ffffff]"
                   />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

    </div>
  );
}
