// src/components/pages/Developer.tsx
'use client'
import React from 'react'
import { motion } from 'framer-motion'
import { 
  Github, Cpu, Heart, Code2, Award, Milestone, Rocket, 
  Sparkles, Coffee, ExternalLink, Calendar 
} from 'lucide-react'

export default function Developer() {
  const milestones = [
    {
      date: 'June 2026',
      title: 'BotOS v2.0 Launch',
      desc: 'Complete architectural migration to unified Express & Socket.IO server with high-fidelity WebGL real-time dashboard panel.',
      status: 'completed'
    },
    {
      date: 'May 2026',
      title: 'Multi-Provider AI & Failover Orchestrator',
      desc: 'Designed dynamic failover system supporting Gemini, DeepSeek, Groq, NVIDIA, OpenAI, and Claude with cost tracking.',
      status: 'completed'
    },
    {
      date: 'April 2026',
      title: 'SQLite Database & Context Buffer',
      desc: 'Implemented memory persistence using better-sqlite3 with session management caches.',
      status: 'completed'
    },
    {
      date: 'Q3 2026',
      title: 'Distributed Bot Nodes clustering',
      desc: 'Multi-session whatsapp client management via virtualization nodes.',
      status: 'planned'
    }
  ]

  return (
    <div className="space-y-8 pb-10 max-w-5xl mx-auto">
      {/* Dev profile hero */}
      <div className="relative p-8 bg-surface/20 border border-border rounded-2xl glassmorphism overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
          <Code2 size={240} />
        </div>

        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 relative z-10">
          {/* Avatar avatar */}
          <div className="relative shrink-0">
            <div className="h-24 w-24 rounded-full overflow-hidden shadow-xl shadow-accent/10 border border-white/10">
              <img 
                src="https://github.com/ronnanakibu.png" 
                alt="Ronn" 
                className="h-full w-full object-cover"
              />
            </div>
            <div className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center text-[10px] text-white">
              ⚡
            </div>
          </div>

          <div className="flex-1 text-center md:text-left min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-center md:justify-start gap-2">
              <h2 className="text-xl font-extrabold text-white">Ronn (Ronn Anakibu)</h2>
              <span className="self-center px-2 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-[9px] font-mono text-accent uppercase tracking-wider font-semibold">
                Core Developer
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 font-mono">
              JavaScript / TypeScript Backend Architect & Bot Engineer
            </p>
            
            <p className="text-xs text-muted-foreground/90 mt-4 leading-relaxed max-w-2xl">
              Building lightweight, high-performance automated systems, bot pipelines, and unified real-time panels. 
              WABOT 2.0 (BotOS) is designed to be a premium Bot Operating System with modular providers, SQLite memory context limits, and instant telemetry dashboard monitors.
            </p>

            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-6">
              <a
                href="https://github.com/ronnanakibu"
                target="_blank"
                rel="noreferrer"
                className="h-8 px-3.5 bg-muted/60 hover:bg-muted border border-border hover:border-accent text-white text-[11px] rounded-lg transition-colors flex items-center gap-2 font-mono"
              >
                <Github size={12} />
                github.com/ronnanakibu
                <ExternalLink size={10} className="opacity-60" />
              </a>
              <span className="text-[10px] text-muted-foreground/50 font-mono">
                Location: Jakarta (GMT+7)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Project Story & Specs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Story */}
        <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism md:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider">The BotOS Odyssey</h4>
          </div>
          <div className="text-xs text-muted-foreground/95 space-y-3 leading-relaxed">
            <p>
              WABOT 2.0 began as a modular command loader configured with basic whatsapp sockets. As bot logic started parsing multi-model API fallbacks and context cache files, a simple command processor was no longer sufficient. 
            </p>
            <p>
              We envisioned **BotOS**: a self-contained, enterprise-grade Bot Operating System. This dashboard eliminates double-port deployment configurations, serves dashboard files directly from Express, and feeds live WhatsApp stream telemetry instantly without page updates.
            </p>
            <p className="flex items-center gap-1.5 text-accent mt-4">
              <Heart size={12} fill="currentColor" /> Crafted with extreme detail, premium aesthetics, and clean architecture.
            </p>
          </div>
        </div>

        {/* Info specifications */}
        <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism space-y-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-accent" />
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider">BotOS Version Metadata</h4>
          </div>
          
          <div className="divide-y divide-border/60 text-[11px]">
            {[
              { name: 'Core Engine Version', val: 'v2.0.0-stable' },
              { name: 'Baileys Socket Core', val: '^6.6.0' },
              { name: 'Database Cache Engine', val: 'SQLite (better-sqlite3)' },
              { name: 'Dashboard Client Core', val: 'Next.js 15 (App Router)' },
              { name: 'Live Synchronizer', val: 'Socket.IO Server' },
              { name: 'License', val: 'MIT / Proprietary' },
            ].map((spec, index) => (
              <div key={index} className="py-2.5 flex justify-between">
                <span className="text-muted-foreground">{spec.name}</span>
                <span className="font-mono text-white font-semibold">{spec.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Project Milestones & Roadmaps */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism space-y-6">
        <div className="flex items-center gap-2">
          <Milestone size={16} className="text-accent" />
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Milestones & Development Timeline</h4>
        </div>

        <div className="relative border-l border-border/80 pl-6 ml-3 space-y-8">
          {milestones.map((mil, idx) => {
            const isCompleted = mil.status === 'completed'
            return (
              <div key={idx} className="relative">
                {/* Bullet circle */}
                <span className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 ${
                  isCompleted 
                    ? 'bg-emerald-400 border-emerald-950 shadow-emerald-500/20 shadow-lg' 
                    : 'bg-background border-border'
                }`} />

                <div>
                  <span className="text-[10px] font-mono text-muted-foreground/80 font-semibold">{mil.date}</span>
                  <h5 className="text-xs font-bold text-white mt-1 flex items-center gap-2">
                    {mil.title}
                    {isCompleted && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[8px] font-semibold text-emerald-400 border border-emerald-500/10">
                        Released
                      </span>
                    )}
                  </h5>
                  <p className="text-[11px] text-muted-foreground/90 mt-1 leading-relaxed max-w-3xl">
                    {mil.desc}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
