'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '@/stores/settingsStore';
import { Github, Twitter, Instagram, ArrowLeft, Terminal, Server, Code2, Camera, Compass, Heart } from 'lucide-react';
import gsap from 'gsap';

// Magnetic Coordinates helper
function useMagnetic() {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setCoords({ x: x * 0.4, y: y * 0.4 });
  };
  const handleMouseLeave = () => setCoords({ x: 0, y: 0 });
  return { coords, handleMouseMove, handleMouseLeave };
}

export function MeetDeveloper() {
  const { activeView, setActiveView } = useSettingsStore();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Magnetic Coordinates for social nodes
  const ghMag = useMagnetic();
  const twMag = useMagnetic();
  const igMag = useMagnetic();

  const [uptime, setUptime] = useState({ days: 3, hours: 8, mins: 42, secs: 15 });

  // 1. Uptime clock simulation
  useEffect(() => {
    if (activeView !== 'meet-dev') return;

    const interval = setInterval(() => {
      setUptime((prev) => {
        let s = prev.secs + 1;
        let m = prev.mins;
        let h = prev.hours;
        let d = prev.days;

        if (s >= 60) {
          s = 0;
          m += 1;
        }
        if (m >= 60) {
          m = 0;
          h += 1;
        }
        if (h >= 24) {
          h = 0;
          d += 1;
        }

        return { days: d, hours: h, mins: m, secs: s };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeView]);

  // 2. GSAP stagger intro animations on mount
  useEffect(() => {
    if (activeView === 'meet-dev' && containerRef.current) {
      // Clear inline style so react state can take over safely later
      gsap.fromTo(
        containerRef.current.querySelectorAll('.gsap-animate'),
        { opacity: 0, y: 40, filter: 'blur(10px)' },
        { 
          opacity: 1, 
          y: 0, 
          filter: 'blur(0px)',
          duration: 0.8, 
          stagger: 0.12, 
          ease: 'power3.out',
          delay: 0.15 
        }
      );
    }
  }, [activeView]);

  return (
    <AnimatePresence>
      {activeView === 'meet-dev' && (
        <motion.div
          className="fixed inset-0 z-40 bg-zinc-950/95 overflow-y-auto custom-scroll flex flex-col pointer-events-auto select-none"
          initial={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Top Navbar */}
          <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-zinc-950/20 backdrop-blur-xl border-b border-white/5">
            <button
              type="button"
              onClick={() => setActiveView('home')}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors cursor-pointer group"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              Back to Player
            </button>
            <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400 font-mono">
              CREDITS & ARCHITECTURE
            </div>
          </div>

          {/* Main Cinematic Scrolling Container */}
          <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-12 flex flex-col gap-16" ref={containerRef}>
            
            {/* ── Profile Section ── */}
            <div className="flex flex-col md:flex-row gap-8 items-center md:items-start gsap-animate">
              {/* Photo Frame */}
              <div className="relative w-40 h-40 rounded-[32px] overflow-hidden border border-white/10 shadow-2xl bg-zinc-900 flex-shrink-0 group">
                <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/20 to-cyan-500/20" />
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 font-bold uppercase tracking-widest text-xs gap-1.5 p-4 text-center">
                  <Compass className="w-8 h-8 text-purple-400 animate-spin-slow" />
                  <span>Antigravity</span>
                  <span className="text-[8px] text-zinc-600">Lead AI Dev</span>
                </div>
              </div>

              {/* Bio Details */}
              <div className="flex-1 text-center md:text-left">
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 font-mono">
                  Software Architect & Bot Developer
                </span>
                <h2 className="text-4xl font-extrabold text-white mt-1.5">
                  Pair Programming Redesign
                </h2>
                <p className="text-sm text-white/60 leading-relaxed mt-4 max-w-2xl">
                  Welcome to the multimedia environment powered by the WABOT 2.0 bot network. This radio stream is delivered direct from our server using a customized high-performance FFmpeg pipeline connected directly to our WhatsApp bot ecosystem. Crafted for perfect visual feedback and cinematic music vibes.
                </p>

                {/* Live Uptime Widget */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-6">
                  <div className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.02] text-xs font-bold font-mono text-emerald-400">
                    <Server className="w-4 h-4 animate-pulse" />
                    LIVE UPTIME: {uptime.days}d {uptime.hours}h {uptime.mins}m {uptime.secs}s
                  </div>
                </div>
              </div>
            </div>

            {/* ── BOTWA Architecture (Visual flowchart) ── */}
            <div className="flex flex-col gap-4 gsap-animate">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/50 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-purple-400" /> WABOT 2.0 System Architecture Flow
              </h3>
              
              <div className="w-full p-6 rounded-3xl border border-white/5 bg-white/[0.01] flex flex-col gap-6 font-mono text-xs text-white/80">
                {/* SVG/CSS Flow Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                  
                  {/* Node 1 */}
                  <div className="p-4 rounded-2xl border border-purple-500/20 bg-purple-950/10 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-purple-400">1. INGRESS GATEWAY</span>
                    <span className="font-bold text-white mt-1">WhatsApp Web API</span>
                    <span className="text-[9px] text-white/40 mt-1">Baileys Socket Gateway</span>
                  </div>

                  {/* Node 2 */}
                  <div className="p-4 rounded-2xl border border-cyan-500/20 bg-cyan-950/10 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-cyan-400">2. COMMAND CONTROLLER</span>
                    <span className="font-bold text-white mt-1">Parser & Downloader</span>
                    <span className="text-[9px] text-white/40 mt-1">YT-DLP Media Pipeline</span>
                  </div>

                  {/* Node 3 */}
                  <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-950/10 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-amber-400">3. TRANSCODE PIPELINE</span>
                    <span className="font-bold text-white mt-1">FFmpeg Stream Engine</span>
                    <span className="text-[9px] text-white/40 mt-1">Real-time MP3 Transcoder</span>
                  </div>

                  {/* Node 4 */}
                  <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold text-emerald-400">4. AUDIO BROADCASTER</span>
                    <span className="font-bold text-white mt-1">SSE /events Endpoint</span>
                    <span className="text-[9px] text-white/40 mt-1">Next.js Web Dashboard</span>
                  </div>

                </div>

                <div className="text-[10px] text-white/40 leading-relaxed max-w-3xl mt-2 select-text">
                  * <strong>High-performance caching:</strong> Cached files bypass downloads on matching commands, ensuring instant transcode startup.
                  <br />
                  * <strong>Client SSE syncing:</strong> The Next.js dashboard establishes a non-blocking persistent Connection stream for absolute real-time visual synchronizations.
                </div>
              </div>
            </div>

            {/* ── Photography Portfolio Grid ── */}
            <div className="flex flex-col gap-4 gsap-animate">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/50 flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" /> Developer Photography Portfolio
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Photo 1: Tokyo Cyberpunk */}
                <div className="group relative rounded-3xl overflow-hidden aspect-[4/3] border border-white/10 shadow-lg bg-zinc-900 cursor-zoom-in">
                  <img
                    src="/cyberpunk_street.png"
                    alt="Rainy Tokyo Cyberpunk Alley"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-6 select-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="text-[9px] font-bold tracking-widest text-cyan-400 font-mono">TOKYO, SHIBUYA</span>
                    <h4 className="text-sm font-bold text-white mt-1">Cyberpunk Alleyway street photography</h4>
                  </div>
                </div>

                {/* Photo 2: Sunset Scene */}
                <div className="group relative rounded-3xl overflow-hidden aspect-[4/3] border border-white/10 shadow-lg bg-zinc-900 cursor-zoom-in">
                  <img
                    src="/aesthetic_sunset.png"
                    alt="Serene Sunset Mountains"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-6 select-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="text-[9px] font-bold tracking-widest text-amber-400 font-mono">SUNSET MOUNTAINS</span>
                    <h4 className="text-sm font-bold text-white mt-1">Serene lo-fi anime-style natural landscape</h4>
                  </div>
                </div>

              </div>
            </div>

            {/* ── Technology Stack ── */}
            <div className="flex flex-col gap-4 gsap-animate">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/50 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-amber-400" /> Technology Stack & Skills
              </h3>
              
              <div className="flex flex-wrap gap-2.5">
                {[
                  'React 19', 'Next.js 15', 'TypeScript', 'Tailwind CSS 4', 
                  'Framer Motion', 'GSAP', 'Zustand', 'Web Audio API', 
                  'SSE (Server-Sent Events)', 'FFmpeg Audio Transcoding', 'Node.js', 'Baileys client'
                ].map((tech) => (
                  <span
                    key={tech}
                    className="px-3.5 py-2 rounded-2xl border border-white/5 bg-white/[0.02] text-xs font-bold text-white/80 hover:border-white/10 hover:text-white transition-all cursor-default"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Foot & Contact Social nodes ── */}
            <div className="flex flex-col items-center justify-center gap-6 mt-6 pt-12 border-t border-white/5 gsap-animate">
              <div className="flex items-center gap-6">
                
                {/* GitHub node */}
                <motion.a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-14 h-14 rounded-full border border-white/5 hover:border-white/10 flex items-center justify-center text-white/60 hover:text-white bg-white/[0.01]"
                  onMouseMove={ghMag.handleMouseMove}
                  onMouseLeave={ghMag.handleMouseLeave}
                  animate={{ x: ghMag.coords.x, y: ghMag.coords.y }}
                  whileHover={{ scale: 1.12 }}
                >
                  <Github className="w-5 h-5" />
                </motion.a>

                {/* Twitter node */}
                <motion.a
                  href="https://twitter.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-14 h-14 rounded-full border border-white/5 hover:border-white/10 flex items-center justify-center text-white/60 hover:text-white bg-white/[0.01]"
                  onMouseMove={twMag.handleMouseMove}
                  onMouseLeave={twMag.handleMouseLeave}
                  animate={{ x: twMag.coords.x, y: twMag.coords.y }}
                  whileHover={{ scale: 1.12 }}
                >
                  <Twitter className="w-5 h-5" />
                </motion.a>

                {/* Instagram node */}
                <motion.a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-14 h-14 rounded-full border border-white/5 hover:border-white/10 flex items-center justify-center text-white/60 hover:text-white bg-white/[0.01]"
                  onMouseMove={igMag.handleMouseMove}
                  onMouseLeave={igMag.handleMouseLeave}
                  animate={{ x: igMag.coords.x, y: igMag.coords.y }}
                  whileHover={{ scale: 1.12 }}
                >
                  <Instagram className="w-5 h-5" />
                </motion.a>

              </div>
              
              <div className="text-[10px] text-white/30 flex items-center gap-1.5 uppercase font-bold tracking-widest font-mono">
                Crafted with <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 animate-pulse" /> by Antigravity AI
              </div>
            </div>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
