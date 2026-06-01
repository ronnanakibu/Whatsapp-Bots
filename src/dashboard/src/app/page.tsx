'use client';

import React from 'react';
import { Activity, Cpu, Radio, Users, Database, Zap } from 'lucide-react';
import PipelineVisualizer from '@/components/visualizer/PipelineVisualizer';

export default function BotwaOS() {
  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden flex flex-col font-sans selection:bg-green-500/30">

      {/* =========================================
          LAYER 0: ATMOSPHERIC BACKGROUND 
          (Sangat subtle, tidak mendominasi)
      ========================================= */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-green-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 right-0 w-[50vw] h-[50vw] bg-blue-500/5 blur-[100px] rounded-full" />
        {/* Noise overlay untuk tekstur 'mahal' (opsional, butuh file noise.png) */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('/noise.png')] mix-blend-overlay" />
      </div>

      {/* =========================================
          TOP BAR: LIVE TELEMETRY
      ========================================= */}
      <header className="z-10 h-16 border-b border-white/10 bg-black/50 backdrop-blur-xl flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20 border border-green-500/50">
            <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.8)]" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest text-white/90">BOTWA // OS</h1>
            <p className="text-[10px] font-mono text-green-400 uppercase tracking-wider">System Online • v2.0.0</p>
          </div>
        </div>

        {/* System Metrics */}
        <div className="flex items-center gap-8 font-mono text-xs text-white/60">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" />
            <span>UPTIME: <span className="text-white">48h 12m</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-blue-400" />
            <span>SOCKETS: <span className="text-white">1 Active</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Database size={14} className="text-purple-400" />
            <span>PROCESSED: <span className="text-white">1.3 GB</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-emerald-400" />
            <span>LISTENERS: <span className="text-white">4</span></span>
          </div>
        </div>
      </header>

      {/* =========================================
          MAIN COMMAND CENTER GRID
      ========================================= */}
      <main className="z-10 flex-1 grid grid-cols-12 gap-4 p-4 min-h-0">

        {/* PANEL KIRI: REALTIME EVENT FEED (3 Columns) */}
        <section className="col-span-3 flex flex-col gap-4">
          <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold text-white/50 tracking-widest uppercase">Live Activity</h2>
              <Activity size={14} className="text-white/30" />
            </div>

            {/* Terminal Feed Placeholder */}
            <div className="flex-1 overflow-y-auto font-mono text-[11px] flex flex-col gap-3 scrollbar-hide">
              <div className="flex gap-3 text-blue-300">
                <span className="opacity-50">20:30:12</span>
                <span className="break-words">[REQUEST] +62812... requested Joji - Glimpse of Us</span>
              </div>
              <div className="flex gap-3 text-yellow-300">
                <span className="opacity-50">20:30:14</span>
                <span>[SEARCH] Source located (NlprozGcs80)</span>
              </div>
              <div className="flex gap-3 text-green-300">
                <span className="opacity-50">20:30:15</span>
                <span>[DOWNLOAD] Buffering media chunk 1/4...</span>
              </div>
            </div>
          </div>
        </section>

        {/* PANEL TENGAH: THE MEDIA PIPELINE (6 Columns) */}
        <section className="col-span-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent backdrop-blur-xl relative flex flex-col overflow-hidden shadow-2xl">
          <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
            <Cpu size={14} className="text-purple-400" />
            <h2 className="text-xs font-bold text-white/50 tracking-widest uppercase">Factory Floor / Media Pipeline</h2>
          </div>
          {/* Ini adalah kanvas untuk Tahap 2 (Node & Packet Animations) */}
          <div className="flex-1 flex items-center justify-center relative w-full mt-4">
            <PipelineVisualizer />
          </div>
        </section>

        {/* PANEL KANAN: COMMUNITY & QUEUE TIMELINE (3 Columns) */}
        <section className="col-span-3 flex flex-col gap-4">
          {/* Listener Cloud */}
          <div className="h-1/3 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold text-white/50 tracking-widest uppercase">Network Nodes</h2>
              <Users size={14} className="text-white/30" />
            </div>
            {/* Listener Nodes Placeholder */}
            <div className="flex-1 flex flex-wrap gap-2 content-start">
              <div className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ronn
              </div>
              <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/60 text-xs font-medium flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/30" /> Alex
              </div>
            </div>
          </div>

          {/* Queue Timeline */}
          <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-md p-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <h2 className="text-xs font-bold text-white/50 tracking-widest uppercase">Pipeline Schedule</h2>
            </div>
            {/* Timeline Placeholder */}
            <div className="flex-1 flex flex-col gap-0 font-mono text-[11px]">
              <div className="relative pl-6 pb-6 border-l border-purple-500/30">
                <div className="absolute left-[-4px] top-1 w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                <div className="text-purple-300 font-bold mb-1">NOW PROCESSING</div>
                <div className="text-white/80 text-sm font-sans">Bassara - Let Go</div>
              </div>
              <div className="relative pl-6 pb-6 border-l border-white/10">
                <div className="absolute left-[-4px] top-1 w-2 h-2 rounded-full bg-white/30" />
                <div className="text-white/40 mb-1">T+03:15 (IN BUFFER)</div>
                <div className="text-white/60 text-sm font-sans">Die For You - The Weeknd</div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div >
  );
}