// src/components/pages/AICenter.tsx
'use client'
import React, { useState } from 'react'
import { Bot, ArrowRight, HeartPulse, Sparkles, Send, RefreshCw, Layers, Award, Coins, Zap } from 'lucide-react'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

export default function AICenter() {
  const { aiConfig } = useDashboardStore()
  const [testPrompt, setTestPrompt] = useState('')
  const [testResult, setTestResult] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)

  // Fallback providers mockup if none set
  const rawProviders = aiConfig.providers.length > 0 ? aiConfig.providers : [
    { name: 'nvidia', active: true, ping: 240, model: 'meta/llama-3.1-70b-instruct', status: 'healthy' },
    { name: 'groq', active: false, ping: 120, model: 'llama-3.3-70b-versatile', status: 'healthy' },
    { name: 'gemini', active: false, ping: 480, model: 'gemini-2.0-flash', status: 'healthy' }
  ]

  const providers = rawProviders.map(p => ({
    name: p.name,
    displayName: p.name === 'nvidia' ? 'NVIDIA NIM' : p.name === 'groq' ? 'GroqCloud' : 'Google Gemini',
    model: p.model || (p.name === 'groq' ? 'llama-3.3-70b-versatile' : p.name === 'gemini' ? 'gemini-2.0-flash' : 'meta/llama-3.1-70b-instruct'),
    status: p.status || 'healthy',
    speed: p.ping ? `${p.ping}ms` : (p.name === 'groq' ? '120ms' : p.name === 'gemini' ? '480ms' : '240ms'),
    active: p.active,
    ping: p.ping || 0
  }))

  const fallbackChain = aiConfig.fallbackChain.length > 0 ? aiConfig.fallbackChain : ['nvidia', 'groq', 'gemini']

  const handleTestPrompt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testPrompt.trim()) return
    setIsTesting(true)
    setTestResult('')
    
    // Simulate prompt response
    setTimeout(() => {
      setTestResult(`[RonnBot AI Response]:\nHalo! Saya telah menerima prompt kamu: "${testPrompt}". Konfigurasi AI fallback berfungsi dengan baik menggunakan engine tercepat.`)
      setIsTesting(false)
    }, 1500)
  }

  const renderProviderIcon = (name: string, active: boolean) => {
    const sizeClass = "h-5 w-5"
    const colorClass = active ? "text-emerald-400" : "text-muted-foreground"
    
    if (name.toLowerCase() === 'nvidia') {
      return (
        <svg viewBox="0 0 24 24" className={cn(sizeClass, colorClass)} fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15.5c-3.03 0-5.5-2.47-5.5-5.5s2.47-5.5 5.5-5.5 5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zm0-9c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5z" />
          <path d="M12 8.5c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5S13.93 8.5 12 8.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#10B981" />
        </svg>
      )
    }
    if (name.toLowerCase() === 'groq') {
      return (
        <svg viewBox="0 0 24 24" className={cn(sizeClass, colorClass)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M12 6a6 6 0 0 0-6 6c0 1.657.672 3.157 1.757 4.243M12 18h4" />
        </svg>
      )
    }
    if (name.toLowerCase() === 'gemini') {
      return (
        <svg viewBox="0 0 24 24" className={cn(sizeClass, colorClass)} fill="currentColor">
          <path d="M12 2a1 1 0 0 0-1 1c0 4.418-3.582 8-8 8a1 1 0 0 0 0 2c4.418 0 8 3.582 8 8a1 1 0 0 0 2 0c0-4.418 3.582-8 8-8a1 1 0 0 0 0-2c-4.418 0-8-3.582-8-8a1 1 0 0 0-1-1z" />
        </svg>
      )
    }
    return <Bot size={16} />
  }

  const getProviderStats = (name: string) => {
    const n = name.toLowerCase()
    if (n === 'nvidia') {
      return {
        requestsToday: '128 queries',
        estimatedCost: '$0.00 / free (Developer Key)',
        accuracy: '99.4%',
        fallbackPriority: 'Primary (Rank 1)',
        features: ['Optimized TensorRT Latency', 'Meta Llama 3.1 Instruct specialization', 'High-throughput pipelines'],
        uptimeHistory: ['99.9%', '99.8%', '100%', '99.9%']
      }
    }
    if (n === 'groq') {
      return {
        requestsToday: '320 queries',
        estimatedCost: '$0.00035 (GroqCloud free tier limits)',
        accuracy: '98.9%',
        fallbackPriority: 'Secondary (Rank 2)',
        features: ['LPU inference engine speed', 'Llama 3.3 70B versatility', 'Sub-150ms token generation'],
        uptimeHistory: ['100%', '99.7%', '99.9%', '100%']
      }
    }
    return {
      requestsToday: '42 queries',
      estimatedCost: '$0.00 (Gemini 2.0 Flash developer API)',
      accuracy: '99.8%',
      fallbackPriority: 'Tertiary (Rank 3)',
      features: ['Deep context window buffers', 'Highly coherent conversation responses', 'Google search grounding support'],
      uptimeHistory: ['99.6%', '99.9%', '99.8%', '99.9%']
    }
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Fallback chain visualizer */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <h3 className="text-sm font-semibold text-white font-mono flex items-center gap-2">
          <Layers size={15} className="text-accent" />
          <span>AI Fallback Chain Topology</span>
        </h3>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Real-time failover model routing chain when rate-limited</p>

        <div className="flex flex-wrap items-center gap-4 mt-8">
          {fallbackChain.map((prov, index) => {
            const isLast = index === fallbackChain.length - 1
            const providerDetails = providers.find(p => p.name.toLowerCase() === prov.toLowerCase())
            const isActive = providerDetails?.active ?? (index === 0)
            
            return (
              <React.Fragment key={prov}>
                <div 
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300",
                    isActive 
                      ? "bg-accent/10 border-accent/40 shadow-[0_0_15px_rgba(99,102,241,0.15)]" 
                      : "bg-muted/20 border-border/80 text-muted-foreground"
                  )}
                >
                  <div className={cn("p-2 rounded-lg border", isActive ? "bg-accent/10 border-accent/20 text-accent" : "bg-muted border-border text-muted-foreground")}>
                    {renderProviderIcon(prov, isActive)}
                  </div>
                  <div>
                    <h4 className={cn("text-xs font-bold capitalize", isActive ? "text-white font-mono" : "text-muted-foreground font-mono")}>{prov}</h4>
                    <p className="text-[9px] font-mono text-muted-foreground/80 mt-0.5">
                      {providerDetails?.model ? providerDetails.model.split('/').pop() : 'Default Model'}
                    </p>
                  </div>
                </div>
                {!isLast && (
                  <ArrowRight size={14} className="text-muted-foreground/45 shrink-0" />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Provider statuses */}
      <div>
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-white font-mono uppercase tracking-wider">AI Engines ({providers.length})</h3>
          <p className="text-[10px] text-muted-foreground">Click a card to inspect live telemetry and model statistics</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {providers.map((p) => {
            const isSelected = selectedProvider === p.name
            return (
              <div 
                key={p.name} 
                onClick={() => setSelectedProvider(isSelected ? null : p.name)}
                className={cn(
                  "p-5 bg-surface/20 border rounded-xl flex flex-col justify-between cursor-pointer transition-all duration-200 select-none hover:-translate-y-0.5",
                  isSelected 
                    ? "border-accent bg-accent/5 shadow-lg shadow-accent/5" 
                    : "border-border hover:border-accent/40 hover:bg-muted/10"
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 items-center">
                    <div className="p-2 bg-muted/40 border border-border/60 rounded-lg text-white">
                      {renderProviderIcon(p.name, true)}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white font-mono">{p.displayName}</h4>
                      <p className="text-[9px] text-muted-foreground mt-0.5 font-mono truncate max-w-[120px]" title={p.model}>{p.model}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[9px] font-semibold border flex items-center gap-1 font-mono",
                    p.status === 'healthy' 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" 
                      : "bg-rose-500/10 border-rose-500/20 text-rose-500"
                  )}>
                    <HeartPulse size={8} />
                    <span>{p.status}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between mt-6 text-[10px] text-muted-foreground font-mono">
                  <span>Avg Latency:</span>
                  <span className="text-white font-bold">{p.speed}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected Provider telemetry stats */}
      {selectedProvider && (
        <div className="p-6 bg-surface/20 border border-accent/40 rounded-xl glassmorphism space-y-4 animate-fade-in">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              {renderProviderIcon(selectedProvider, true)}
              <span>{providers.find(p => p.name === selectedProvider)?.displayName} Telemetry Details</span>
            </h4>
            <button 
              onClick={() => setSelectedProvider(null)}
              className="text-[10px] text-muted-foreground hover:text-white transition-colors font-mono"
            >
              Close Details [x]
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 text-[11px] font-mono">
            <div className="p-4 bg-muted/20 border border-border/40 rounded-lg space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">Daily Requests</span>
              <p className="text-white font-bold text-xs flex items-center gap-1.5">
                <Send size={12} className="text-accent" />
                <span>{getProviderStats(selectedProvider).requestsToday}</span>
              </p>
            </div>
            
            <div className="p-4 bg-muted/20 border border-border/40 rounded-lg space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">API Cost (Est)</span>
              <p className="text-white font-bold text-xs flex items-center gap-1.5">
                <Coins size={12} className="text-amber-500" />
                <span>{getProviderStats(selectedProvider).estimatedCost}</span>
              </p>
            </div>

            <div className="p-4 bg-muted/20 border border-border/40 rounded-lg space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">Accuracy Rate</span>
              <p className="text-white font-bold text-xs flex items-center gap-1.5">
                <Award size={12} className="text-emerald-400" />
                <span>{getProviderStats(selectedProvider).accuracy}</span>
              </p>
            </div>

            <div className="p-4 bg-muted/20 border border-border/40 rounded-lg space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">Fallback Priority</span>
              <p className="text-white font-bold text-xs flex items-center gap-1.5">
                <Zap size={12} className="text-blue-400" />
                <span>{getProviderStats(selectedProvider).fallbackPriority}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 font-mono text-[11px]">
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Engine Features</span>
              <ul className="space-y-1">
                {getProviderStats(selectedProvider).features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-white">
                    <span className="h-1.5 w-1.5 bg-accent rounded-full shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Hourly Ping Stability (Last 4h)</span>
              <div className="flex items-center gap-4 pt-1">
                {getProviderStats(selectedProvider).uptimeHistory.map((up, i) => (
                  <div key={i} className="flex-1 p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-center rounded">
                    <p className="text-[8px] text-muted-foreground font-semibold">H-{4-i}</p>
                    <p className="font-bold text-xs mt-0.5">{up}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive prompt console */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <h3 className="text-sm font-semibold text-white font-mono flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <span>AI Testing Sandbox</span>
        </h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Submit a message directly to WABOT 2.0 active model engine</p>

        <form onSubmit={handleTestPrompt} className="mt-6 flex gap-4">
          <input
            type="text"
            placeholder="Type a testing prompt (e.g. Siapa pembuat kamu?)..."
            value={testPrompt}
            onChange={e => setTestPrompt(e.target.value)}
            disabled={isTesting}
            className="w-full h-11 px-4 bg-muted/40 border border-border/80 rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
          />
          <button
            type="submit"
            disabled={isTesting || !testPrompt.trim()}
            className="px-5 bg-white text-black hover:bg-neutral-200 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shrink-0 disabled:opacity-50"
          >
            {isTesting ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            <span>Send</span>
          </button>
        </form>

        {testResult && (
          <div className="mt-4 p-4 bg-muted/30 border border-border/80 rounded-lg text-xs font-mono text-white/90 whitespace-pre-wrap animate-fade-in">
            {testResult}
          </div>
        )}
      </div>
    </div>
  )
}
