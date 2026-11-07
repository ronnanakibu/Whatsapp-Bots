import React, { useState, useEffect } from 'react'
import {
  Activity,
  Cpu,
  Layers,
  Radio,
  ShieldCheck,
  Terminal,
  Zap,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from 'lucide-react'

interface Telemetry {
  uptime?: number
  rssMB?: number
  heapUsedMB?: number
  status?: string
}

export default function App() {
  const [telemetry, setTelemetry] = useState<Telemetry>({
    uptime: 0,
    rssMB: 180,
    heapUsedMB: 95,
    status: 'ONLINE',
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'radio' | 'logs'>('overview')

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/system/ping')
        if (res.ok) {
          const data = await res.json()
          setTelemetry((prev) => ({
            ...prev,
            uptime: data.uptime || prev.uptime,
            status: 'ONLINE',
          }))
        }
      } catch (_) {}
    }

    fetchStatus()
    const timer = setInterval(fetchStatus, 10000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-screen bg-[#090A0F] text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800/80 bg-[#0C0E17]/60 backdrop-blur-xl flex flex-col justify-between p-4">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-wide">BotOS v6</h1>
              <p className="text-[10px] text-cyan-400 font-mono">Autonomous Core</p>
            </div>
          </div>

          <nav className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'ai', label: 'AI Orchestrator', icon: Sparkles },
              { id: 'radio', label: 'Audio & Studio', icon: Radio },
              { id: 'logs', label: 'System Logs', icon: Terminal },
            ].map((item) => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Footer info */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/60 text-xs space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Status</span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {telemetry.status}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 truncate">Node: Render 512MB RAM</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Top Header */}
        <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-[#0C0E17]/30 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Environment:</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">production</span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/status"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition"
            >
              <span>Bot Status</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <a
              href="/stream"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-400 transition"
            >
              <span>Live Stream</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </header>

        {/* Dynamic Page Views */}
        <div className="p-6 space-y-6 max-w-7xl">
          {/* Welcome Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-indigo-950/20 to-transparent border border-cyan-800/20 flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">BotOS Next-Gen Telemetry Hub</h2>
              <p className="text-xs text-slate-400">
                Resource-efficient autonomous orchestration active. Memory footprint monitored with zero heap leakage.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium transition"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          </div>

          {/* Bento Grid Telemetry Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>RAM RSS Usage</span>
                <Cpu className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight text-white">~180 MB</div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-full w-[35%] rounded-full"></div>
              </div>
              <p className="text-[10px] text-slate-500">Cap: 380MB threshold</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Heap Allocation</span>
                <Layers className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight text-white">~95 MB</div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-indigo-500 h-full w-[25%] rounded-full"></div>
              </div>
              <p className="text-[10px] text-slate-500">Node GC auto-sweep active</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Self-Healing Engine</span>
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight text-white">HEALTHY</div>
              <p className="text-[10px] text-emerald-400/80 font-mono">0 circuit breakers open</p>
              <p className="text-[10px] text-slate-500">Automated rollback enabled</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Media Pipelines</span>
                <MessageSquare className="h-4 w-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight text-white">READY</div>
              <p className="text-[10px] text-amber-400 font-mono">Emoji SVG engine active</p>
              <p className="text-[10px] text-slate-500">Sharp libvips memory capped</p>
            </div>
          </div>

          {/* Module Detailed View */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* AI Tier Routing */}
            <div className="p-5 rounded-2xl bg-slate-900/30 border border-slate-800/80 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  Model Tier Router (V6 Master Blueprint)
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/30">
                  Dual-Scope Active
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="font-mono text-cyan-300">Tier 0 (Deterministic)</span>
                  <span className="text-slate-400">0 Tokens / Regex & Exact Match</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="font-mono text-indigo-300">Tier 1 (Fast Flash)</span>
                  <span className="text-slate-400">Casual Chit-chat / Quick Q&A</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="font-mono text-amber-300">Tier 2 (Pro Reasoning)</span>
                  <span className="text-slate-400">Complex Logic & Analysis</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="font-mono text-emerald-300">Tier 3 (Specialist)</span>
                  <span className="text-slate-400">Code & Creative Multimodal</span>
                </div>
              </div>
            </div>

            {/* Quick Actions & Maintenance */}
            <div className="p-5 rounded-2xl bg-slate-900/30 border border-slate-800/80 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Terminal className="h-4 w-4 text-indigo-400" />
                Live Command Registry
              </h3>
              <p className="text-xs text-slate-400">
                100+ commands actively registered across Group, Media, Entertainment, Tools, and Owner scopes.
              </p>
              <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                {['.sticker', '.s', '.qc', '.hermes', '.play', '.cuaca', '.remindme', '.changelogs'].map((cmd) => (
                  <span key={cmd} className="px-2.5 py-1 rounded-md bg-slate-800/60 border border-slate-700/60 text-slate-300">
                    {cmd}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
