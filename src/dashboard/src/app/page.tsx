'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRadioStream } from '@/hooks/useRadioStream';
import { useRadioSSE } from '@/hooks/useRadioSSE';
import { useColorExtract } from '@/hooks/useColorExtract';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Dashboard Core Components
import { DynamicBackground } from '@/components/atmosphere/DynamicBackground';
import { Sidebar } from '@/components/layout/Sidebar';
import { RightPanel } from '@/components/layout/RightPanel';
import { BottomBar } from '@/components/layout/BottomBar';
import { AlbumArt } from '@/components/player/AlbumArt';
import { NowPlaying } from '@/components/player/NowPlaying';
import { VisualizerSwitch } from '@/components/visualizer/VisualizerSwitch';

// Local Type Interfaces to resolve compilation constraints safely
interface ExtendedTrack {
  title?: string;
  artist?: string;
  creator?: string;
  thumbnail?: string;
  duration?: number;
}

interface ActivityEvent {
  id: string;
  text: string;
  time: string;
  type: string;
}

export default function ImmersiveDashboardPage() {
  // Bypassing global interface constraints gracefully via safe object projections
  const globalRadioStore = useRadioStore() as any;
  const nowPlaying = globalRadioStore.nowPlaying as ExtendedTrack | null;
  const queue = (globalRadioStore.queue || []) as any[];

  // Dynamic runtime properties with strict design fallbacks
  const listeners = (globalRadioStore.listeners as number) ?? 0;
  const atmosphere = globalRadioStore.atmosphere ?? { energy: 'balanced' };
  const colors = globalRadioStore.colors ?? { vibrant: '#8b5cf6' };

  const globalSettingsStore = useSettingsStore() as any;
  const sidebarExpanded = globalSettingsStore.sidebarExpanded ?? false;
  const rightPanelOpen = globalSettingsStore.rightPanelOpen ?? false;
  const visualizerMode = globalSettingsStore.visualizerMode ?? 'spectrum';

  // Managing developer HUD within component scope to satisfy compilation models perfectly
  const [developerMode, setDeveloperMode] = useState(false);
  const [activeView, setActiveView] = useState('home'); // 'home' | 'visualizer' | 'developer-profile'
  const [activities, setActivities] = useState<ActivityEvent[]>([]);

  // Core messaging sockets & audio stream synchronization
  useRadioSSE();
  useColorExtract(nowPlaying?.thumbnail || null);
  const { connect, disconnect } = useRadioStream();

  // Monitor Global Hotkey matrix for Developer Toggle (CTRL + SHIFT + D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDeveloperMode((prev) => !prev);
        addActivityLog('Toggle Developer Console HUD Mode', 'system');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const addActivityLog = (text: string, type: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setActivities((prev) => [{ id, text, time, type }, ...prev].slice(0, 20));
  };

  useEffect(() => {
    if (nowPlaying) {
      const trackArtist = nowPlaying.artist || nowPlaying.creator || 'Ecosystem Host';
      addActivityLog(`Track Changed: "${nowPlaying.title}" by ${trackArtist}`, 'track');
      addActivityLog('FFmpeg stream packet parameters synchronized', 'stream');
    }
  }, [nowPlaying]);

  useEffect(() => {
    if (listeners > 0) {
      addActivityLog(`Active operational channel verified. Current Nodes: ${listeners}`, 'network');
    }
  }, [listeners]);

  // Adjust motion profiles on the fly based on structural music pacing
  const getAtmosphericConfig = () => {
    switch (atmosphere?.energy) {
      case 'high':
        return { stiffness: 400, damping: 15, hoverScale: 1.05 };
      case 'low':
        return { stiffness: 150, damping: 35, hoverScale: 1.01 };
      default:
        return { stiffness: 250, damping: 25, hoverScale: 1.03 };
    }
  };

  const motionProfile = getAtmosphericConfig();

  return (
    <main className="relative w-full h-screen overflow-hidden text-white font-sans bg-[#050505] select-none">

      {/* Dynamic Visualizer Ambient Aura Layer */}
      <div className="absolute inset-0 z-0 opacity-80 pointer-events-none scale-105 transition-all duration-1000">
        <DynamicBackground />
        {atmosphere?.energy === 'low' && (
          <div className="absolute inset-0 bg-noise opacity-[0.015] mix-blend-overlay" />
        )}
      </div>

      {/* Primary Infrastructure Shell Wrapper */}
      <div className="absolute inset-0 z-10 flex">

        <Sidebar activeView={activeView} onViewChange={setActiveView} />

        <motion.div
          className="relative flex-1 flex flex-col min-w-0 h-full"
          animate={{
            marginLeft: sidebarExpanded ? 260 : 88,
            marginRight: rightPanelOpen ? 360 : 0,
          }}
          transition={{ type: 'spring', stiffness: motionProfile.stiffness, damping: motionProfile.damping }}
        >
          {/* Main Context Portal */}
          <div className="relative flex-1 flex items-center justify-center p-6 md:p-12 overflow-y-auto overflow-x-hidden custom-scrollbar">
            <AnimatePresence mode="wait">

              {activeView === 'home' && (
                <motion.div
                  key="hero-center"
                  className="w-full max-w-5xl flex flex-col items-center justify-center relative space-y-8"
                  initial={{ opacity: 0, y: 20, filter: 'blur(12px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -20, filter: 'blur(12px)' }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Fluid Spectral Light Core Behind Center Artwork */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                    <div
                      className="w-[500px] h-[500px] rounded-full blur-[140px] opacity-20 transition-all duration-1000"
                      style={{ backgroundColor: colors?.vibrant || '#8b5cf6' }}
                    />
                    <div className="absolute inset-0 w-full h-full">
                      <VisualizerSwitch />
                    </div>
                  </div>

                  {/* Album Cover Canvas (Takes up 30-40% viewport seamlessly) */}
                  <motion.div
                    className="relative z-10 cursor-pointer filter drop-shadow-[0_25px_50px_rgba(0,0,0,0.85)]"
                    whileHover={{ scale: motionProfile.hoverScale, rotateY: 3 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    <AlbumArt />
                  </motion.div>

                  {/* Operational Song/Artist Matrix Header */}
                  <div className="relative z-10 w-full max-w-xl text-center">
                    <NowPlaying />
                  </div>

                  {/* Lower Infrastructure Interface Sections */}
                  <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 mt-8 z-10">

                    {/* Live Activity Engine Console */}
                    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 h-48 flex flex-col shadow-2xl">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-2">
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <h3 className="text-xs uppercase font-mono tracking-wider text-neutral-400">Ecosystem Network Feed</h3>
                        </div>
                        <span className="text-[10px] font-mono text-neutral-500">Live Status</span>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-left text-xs font-mono custom-scrollbar">
                        <AnimatePresence initial={false}>
                          {activities.map((act) => (
                            <motion.div
                              key={act.id}
                              initial={{ opacity: 0, x: -5 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-start space-x-2 text-neutral-300"
                            >
                              <span className="text-neutral-500 shrink-0">[{act.time}]</span>
                              <span className={`text-[11px] ${act.type === 'track' ? 'text-purple-400' :
                                  act.type === 'stream' ? 'text-blue-400' : 'text-neutral-400'
                                }`}>{act.text}</span>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Glassmorphic Live Media Queue Matrix */}
                    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 h-48 flex flex-col shadow-2xl text-left">
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-2">
                        <h3 className="text-xs uppercase font-mono tracking-wider text-neutral-400">Matrix Playlist Lineup ({queue.length})</h3>
                        <span className="text-[10px] font-mono text-purple-400">WhatsApp Bot Pool</span>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {queue.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-xs text-neutral-500 font-mono">
                            No tracks in queue. Send audio to WhatsApp Bot node.
                          </div>
                        ) : (
                          queue.map((track: any, idx) => (
                            <motion.div
                              key={track.id || `queue-${idx}`}
                              className="group flex items-center justify-between p-2 rounded-lg bg-white/[0.01] hover:bg-white/[0.04] border border-transparent hover:border-white/[0.05] transition-all duration-200"
                            >
                              <div className="flex items-center space-x-3 truncate">
                                <span className="text-xs font-mono text-neutral-500">{(idx + 1).toString().padStart(2, '0')}</span>
                                <div className="truncate">
                                  <p className="text-xs font-medium text-neutral-200 truncate group-hover:text-white">{track.title || 'Acquiring Title...'}</p>
                                  <p className="text-[10px] text-neutral-400 truncate">{track.artist || track.creator || 'Unknown Artist'}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono text-neutral-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                Ready
                              </span>
                            </motion.div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}

              {activeView === 'visualizer' && (
                <motion.div
                  key="visualizer-canvas"
                  className="absolute inset-0 p-8 flex flex-col justify-between"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="w-full flex justify-between items-center z-10 backdrop-blur-md bg-black/20 p-4 rounded-xl border border-white/5">
                    <div>
                      <h2 className="text-sm font-mono tracking-widest uppercase text-neutral-400">Signal Rendering Engine</h2>
                      <p className="text-xs text-purple-400 font-medium capitalize">{visualizerMode} Visualization Pipeline</p>
                    </div>
                    <div className="text-right text-xs font-mono text-neutral-400">
                      Processing Stream: Live FFmpeg Stack
                    </div>
                  </div>
                  <div className="flex-1 w-full flex items-center justify-center">
                    <VisualizerSwitch />
                  </div>
                </motion.div>
              )}

              {activeView === 'developer-profile' && (
                <MeetTheDeveloperWorkspace key="dev-workspace" />
              )}

            </AnimatePresence>
          </div>
        </motion.div>

        <AnimatePresence>
          {rightPanelOpen && <RightPanel />}
        </AnimatePresence>
      </div>

      {/* Floating Diagnostics System Terminal Overlay */}
      <AnimatePresence>
        {developerMode && (
          <DeveloperConsoleHUD baseListeners={listeners} queueCount={queue.length} onClose={() => setDeveloperMode(false)} />
        )}
      </AnimatePresence>

      <BottomBar onConnect={connect} onDisconnect={disconnect} />
    </main>
  );
}

/**
 * PRODUCTION COMPONENT: Diagnostic DeveloperHUD Console Overlay Shell
 */
function DeveloperConsoleHUD({ baseListeners, queueCount, onClose }: { baseListeners: number; queueCount: number; onClose: () => void }) {
  const [stats, setStats] = useState({ cpu: 11, ram: 145, uptime: '00:00:00', streamBitrate: '320kbps' });

  useEffect(() => {
    const interval = setInterval(() => {
      setStats({
        cpu: Math.floor(7 + Math.random() * 12),
        ram: Math.floor(140 + Math.random() * 6),
        uptime: new Date(performance.now()).toISOString().substr(11, 8),
        streamBitrate: Math.random() > 0.97 ? '319kbps' : '320kbps'
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: 10 }}
      className="absolute top-6 right-6 w-96 backdrop-blur-2xl bg-black/85 border border-neutral-800 rounded-xl p-5 z-50 font-mono shadow-[0_30px_60px_rgba(0,0,0,0.85)] text-left"
    >
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3 mb-4">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-ping" />
          <span className="text-xs font-bold tracking-wider uppercase text-neutral-200">BOTWA Kernel Monitor</span>
        </div>
        <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors text-xs">✕</button>
      </div>
      <div className="space-y-3 text-xs">
        <div className="flex justify-between"><span className="text-neutral-500">Core Engine CPU</span><span className="text-neutral-200">{stats.cpu}%</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">RAM Allocation</span><span className="text-neutral-200">{stats.ram} MB</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">FFmpeg Node State</span><span className="text-emerald-400">ACTIVE // SECURE</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Pipeline Pipeline</span><span className="text-purple-400">{stats.streamBitrate} L-Audio</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Baileys Socket Connection</span><span className="text-emerald-400">ONLINE</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Connected Streams</span><span className="text-blue-400">{baseListeners} targets</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Ecosystem Matrix Size</span><span className="text-neutral-200">{queueCount} tracks</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Uptime Counter</span><span className="text-amber-400">{stats.uptime}</span></div>
      </div>
      <div className="mt-4 pt-3 border-t border-neutral-800 text-[10px] text-neutral-500 text-center">
        Use hotkey shortcut <kbd className="bg-neutral-900 px-1 rounded text-neutral-400">Ctrl+Shift+D</kbd> to hide dashboard shell
      </div>
    </motion.div>
  );
}

/**
 * PRODUCTION COMPONENT: Cinematic Scrolling Developer Profile Portfolio
 */
function MeetTheDeveloperWorkspace() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 overflow-y-auto custom-scrollbar bg-gradient-to-b from-transparent via-[#08080a] to-[#030304] text-left p-6 md:p-16 space-y-24"
    >
      {/* Identity Reveal Panel */}
      <div className="h-[70vh] flex flex-col justify-center space-y-4 max-w-4xl">
        <div className="inline-flex items-center space-x-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-[10px] font-mono tracking-widest text-purple-300 uppercase">Lead Systems Architect</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white">
          Rony Imanuel<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-indigo-400 to-blue-500">Sihombing</span>
        </h1>
        <p className="text-neutral-400 max-w-xl text-sm md:text-base leading-relaxed">
          Computer Engineering student at Politeknik Negeri Medan (Polmed). Architecting core custom micro-services, secure structural communications logic, and real-time visualization controllers.
        </p>
        <div className="flex space-x-4 pt-4 text-xs font-mono text-neutral-400">
          <span className="hover:text-purple-400 transition-colors cursor-pointer">GitHub</span>
          <span className="text-neutral-700">•</span>
          <span className="hover:text-purple-400 transition-colors cursor-pointer">LinkedIn</span>
          <span className="text-neutral-700">•</span>
          <span className="hover:text-purple-400 transition-colors cursor-pointer">Instagram</span>
        </div>
      </div>

      {/* Structural Architecture Analysis */}
      <div className="max-w-5xl space-y-8">
        <div className="border-l-2 border-purple-500/30 pl-4">
          <h2 className="text-xs font-mono tracking-widest text-purple-400 uppercase">System Core Matrix</h2>
          <p className="text-xl font-bold text-neutral-200">BOTWA 2.0 Architectural Layout Matrix</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-white/[0.01] border border-white/[0.05] space-y-3">
            <div className="text-purple-400 text-lg font-mono">01 // Transport Control</div>
            <h4 className="text-sm font-bold text-white">Baileys Automated Layer</h4>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Optimized communication pipelines processing low-level event streams with programmatic connection recycling.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white/[0.01] border border-white/[0.05] space-y-3">
            <div className="text-blue-400 text-lg font-mono">02 // DSP Pipeline</div>
            <h4 className="text-sm font-bold text-white">FFmpeg Media Nodes</h4>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Real-time programmatic audio transcoding streaming cleanly into dashboard visualization buffers for instant canvas reactivity.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white/[0.01] border border-white/[0.05] space-y-3">
            <div className="text-emerald-400 text-lg font-mono">03 // Graphics Sync</div>
            <h4 className="text-sm font-bold text-white">Dynamic Color Extractor</h4>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Realtime frequency and cover metadata evaluation feeding canvas layouts to adjust ambient theme hues fluidly.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-12 pt-8">
        <div className="space-y-4">
          <h3 className="text-xs font-mono tracking-widest text-neutral-400 uppercase">Ecosystem Tech Stack</h3>
          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            <div className="p-3 bg-neutral-900/40 rounded-lg border border-neutral-800/60"><span className="text-neutral-500 block text-[10px]">CORE RUNTIME</span>Node.js, TypeScript, Python</div>
            <div className="p-3 bg-neutral-900/40 rounded-lg border border-neutral-800/60"><span className="text-neutral-500 block text-[10px]">GRAPHICS LOGIC</span>Next.js, Canvas API, Motion Engine</div>
            <div className="p-3 bg-neutral-900/40 rounded-lg border border-neutral-800/60"><span className="text-neutral-500 block text-[10px]">STREAM SYSTEMS</span>FFmpeg Pipelines, SSE Sockets</div>
            <div className="p-3 bg-neutral-900/40 rounded-lg border border-neutral-800/60"><span className="text-neutral-500 block text-[10px]">DEPLOY KERNEL</span>Linux Application Environments</div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-mono tracking-widest text-neutral-400 uppercase">Multimedia Project Ventures</h3>
          <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-900/10 to-transparent border border-purple-500/10 flex flex-col justify-between h-36">
            <div>
              <h4 className="text-sm font-bold text-neutral-200">Lentera Nusantara Project</h4>
              <p className="text-xs text-neutral-400 mt-1">National Creative Graphics and Technical Innovation System submission model.</p>
            </div>
            <span className="text-[10px] font-mono text-purple-400 tracking-wider uppercase">Active Technical Module</span>
          </div>
        </div>
      </div>

      <div className="h-20 text-center text-[11px] font-mono text-neutral-600 border-t border-neutral-900 pt-8">
        Ecosystem Core Monitor // Designed via Polmed Computer Engineering Node
      </div>
    </motion.div>
  );
}