'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Radio, Disc, User } from 'lucide-react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioManager } from '@/lib/audioManager';

// Magnetic button helper hook
function useMagnetic() {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setCoords({ x: x * 0.3, y: y * 0.3 }); // 30% pull strength
  };
  const handleMouseLeave = () => setCoords({ x: 0, y: 0 });
  return { coords, handleMouseMove, handleMouseLeave };
}

interface HeroCenterProps {
  onConnect: () => void;
  onDisconnect: () => void;
}

export function HeroCenter({ onConnect, onDisconnect }: HeroCenterProps) {
  const {
    nowPlaying,
    isPlaying,
    isConnected,
    isBuffering,
    volume,
    isMuted,
    toggleMute,
  } = useRadioStore();

  const { rightPanelOpen, setRightPanelOpen, setVisualizerMode, visualizerMode } = useSettingsStore();

  const [elapsed, setElapsed] = useState(0);
  const artRef = useRef<HTMLDivElement>(null);

  // Magnetic coordinate handlers for controls
  const playMag = useMagnetic();
  const muteMag = useMagnetic();
  const actionMag = useMagnetic();

  // 1. Calculate live track elapsed time
  useEffect(() => {
    if (!nowPlaying || !isPlaying) {
      setElapsed(0);
      return;
    }

    const start = nowPlaying.startedAt || Date.now();
    const updateElapsed = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const limit = nowPlaying.duration || 300;
      setElapsed(Math.min(Math.max(diff, 0), limit));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [nowPlaying, isPlaying]);

  const duration = nowPlaying?.duration || 1;
  const progressPercent = Math.min((elapsed / duration) * 100, 100);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 2. Direct DOM pulse scale loop (0% React rendering overhead!)
  useEffect(() => {
    let animId = 0;
    const runPulseLoop = () => {
      const { bass } = audioManager.getAnalyzerVolume();
      const scale = 1 + bass * 0.06; // up to +6% scale on bass peaks
      
      if (artRef.current) {
        artRef.current.style.transform = `scale(${scale})`;
        artRef.current.style.boxShadow = `
          0 20px 80px -10px rgba(var(--accent-r), var(--accent-g), var(--accent-b), ${0.25 + bass * 0.2}), 
          0 0 60px rgba(var(--secondary-r), var(--secondary-g), var(--secondary-b), ${0.1 + bass * 0.1})
        `;
      }
      animId = requestAnimationFrame(runPulseLoop);
    };

    if (isPlaying) {
      animId = requestAnimationFrame(runPulseLoop);
    } else {
      if (artRef.current) {
        artRef.current.style.transform = 'scale(1)';
        artRef.current.style.boxShadow = '0 20px 80px -10px rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.25)';
      }
    }

    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  const handlePlayToggle = () => {
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl text-center select-none z-10 px-4">
      
      {/* ── Album Art Hero Card (35% viewport height) ── */}
      <div className="relative flex items-center justify-center w-full mb-10 group">
        <motion.div
          ref={artRef}
          className="relative flex items-center justify-center aspect-square rounded-[32px] overflow-hidden bg-zinc-950 border border-white/10 shadow-2xl glass"
          style={{
            height: '35vh',
            maxHeight: '320px',
            minHeight: '220px',
            willChange: 'transform, box-shadow',
          }}
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/10 to-cyan-500/10 opacity-60 pointer-events-none" />

          <AnimatePresence mode="wait">
            {nowPlaying?.thumbnail ? (
              <motion.img
                key={nowPlaying.thumbnail}
                src={nowPlaying.thumbnail}
                alt={nowPlaying.title}
                className="w-full h-full object-cover select-none pointer-events-none animate-fade-in"
                initial={{ opacity: 0, scale: 1.1, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(6px)' }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            ) : (
              <motion.div
                key="default-disc"
                className="w-full h-full flex flex-col items-center justify-center text-zinc-600 bg-gradient-to-br from-zinc-900 to-black p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Disc className="w-18 h-18 animate-spin-slow text-zinc-500 opacity-65" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 mt-4 font-mono">Offline Stream</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Buffering overlay */}
          {isBuffering && (
            <div className="absolute inset-0 bg-black/65 backdrop-blur-sm flex flex-col items-center justify-center z-10">
              <div className="w-10 h-10 rounded-full border-t-2 border-r-2 border-purple-500 animate-spin" />
              <span className="text-[10px] text-purple-400 mt-3 font-semibold uppercase tracking-widest font-mono">Buffering...</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Metadata Showcase ── */}
      <div className="w-full max-w-2xl mb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={nowPlaying?.title || 'idle'}
            initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white line-clamp-1 max-w-full drop-shadow-md">
              {nowPlaying?.title || 'RonnBot Radio'}
            </h1>
            <p className="text-sm text-white/50 font-medium tracking-wide mt-2 flex items-center gap-2">
              <User className="w-4 h-4 text-purple-400 opacity-70" />
              {nowPlaying?.requestedBy ? `Requested by ${nowPlaying.requestedBy}` : 'Station Idle — awaiting commands'}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Progress Bar ── */}
      {nowPlaying && (
        <div className="w-full max-w-md flex flex-col gap-2 mb-8">
          <div className="relative w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-400 rounded-full"
              style={{ width: `${progressPercent}%` }}
              transition={{ type: 'spring', stiffness: 80, damping: 15 }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/40 font-semibold font-mono tracking-wider">
            <span>{formatTime(elapsed)}</span>
            <span>{nowPlaying.durationFormatted || 'Live'}</span>
          </div>
        </div>
      )}

      {/* ── Magnetic Controls (Secured with explicit type="button") ── */}
      <div className="flex items-center gap-6 z-20">
        
        {/* Toggle Mute Button */}
        <motion.button
          type="button"
          onMouseMove={muteMag.handleMouseMove}
          onMouseLeave={muteMag.handleMouseLeave}
          onClick={toggleMute}
          className="relative w-12 h-12 flex items-center justify-center rounded-full glass border border-white/5 hover:border-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
          animate={{ x: muteMag.coords.x, y: muteMag.coords.y }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
        </motion.button>

        {/* Play/Pause Main Connection Button */}
        <motion.button
          type="button"
          onMouseMove={playMag.handleMouseMove}
          onMouseLeave={playMag.handleMouseLeave}
          onClick={handlePlayToggle}
          className="relative w-20 h-20 flex items-center justify-center rounded-full cursor-pointer transition-shadow"
          style={{
            background: 'linear-gradient(135deg, rgba(var(--accent-r), 0.85) 0%, rgba(var(--secondary-r), 0.85) 100%)',
          }}
          animate={{ x: playMag.coords.x, y: playMag.coords.y }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.93 }}
        >
          {isConnected ? (
            <Pause className="w-7 h-7 text-white fill-white" />
          ) : (
            <Play className="w-7 h-7 text-white fill-white ml-0.5" />
          )}
        </motion.button>

        {/* Queue panel toggler */}
        <motion.button
          type="button"
          onMouseMove={actionMag.handleMouseMove}
          onMouseLeave={actionMag.handleMouseLeave}
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className="relative w-12 h-12 flex items-center justify-center rounded-full glass border border-white/5 hover:border-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
          style={{
            borderColor: rightPanelOpen ? 'rgba(var(--accent-r), 0.35)' : 'rgba(255, 255, 255, 0.05)'
          }}
          animate={{ x: actionMag.coords.x, y: actionMag.coords.y }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <Radio className={`w-5 h-5 ${rightPanelOpen ? 'text-purple-400' : ''}`} />
        </motion.button>

      </div>

      {/* Visualizer selector pills (Secured with type="button") */}
      <div className="flex gap-2 mt-8 z-20">
        {(['spectrum', 'circular', 'waveform', 'galaxy', 'particles', 'aurora'] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            onClick={() => setVisualizerMode(mode)}
            className={`px-3.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all cursor-pointer ${
              visualizerMode === mode
                ? 'bg-white text-black border-white shadow-lg'
                : 'bg-black/40 text-white/50 border-white/5 hover:border-white/10 hover:text-white/80'
            }`}
          >
            {mode === 'particles' ? 'Storm' : mode}
          </button>
        ))}
      </div>

    </div>
  );
}
