// src/components/pages/AICenter.tsx
'use client'
import React, { useState } from 'react'
import { Bot, ArrowRight, HeartPulse, Sparkles, Send, RefreshCw } from 'lucide-react'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

export default function AICenter() {
  const { aiConfig } = useDashboardStore()
  const [testPrompt, setTestPrompt] = useState('')
  const [testResult, setTestResult] = useState('')
  const [isTesting, setIsTesting] = useState(false)

  // Fallback providers mockup if none set
  const providers = aiConfig.providers.length > 0 ? aiConfig.providers : [
    { name: 'Nvidia', model: 'meta/llama-3.1-70b-instruct', status: 'healthy', speed: '240ms', active: true },
    { name: 'Groq', model: 'llama-3.3-70b-versatile', status: 'healthy', speed: '120ms', active: false },
    { name: 'Gemini', model: 'gemini-2.0-flash', status: 'healthy', speed: '480ms', active: false }
  ]

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

  return (
    <div className="space-y-8 pb-10">
      {/* Fallback chain visualizer */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <h3 className="text-sm font-semibold text-white">AI Fallback Chain Topology</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Real-time failover model routing chain when rate-limited</p>

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
                  <div className={cn("p-2 rounded-lg border", isActive ? "bg-accent/10 border-accent/20 text-accent animate-pulse-soft" : "bg-muted border-border text-muted-foreground")}>
                    <Bot size={16} />
                  </div>
                  <div>
                    <h4 className={cn("text-xs font-bold capitalize", isActive ? "text-white" : "text-muted-foreground")}>{prov}</h4>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {providers.map((p) => (
          <div key={p.name} className="p-5 bg-surface/20 border border-border rounded-xl flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-xs font-bold text-white">{p.name} Engine</h4>
                <p className="text-[9px] text-muted-foreground mt-0.5 font-mono truncate max-w-[150px]">{p.model}</p>
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-semibold border flex items-center gap-1",
                p.status === 'healthy' 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" 
                  : "bg-rose-500/10 border-rose-500/20 text-rose-500"
              )}>
                <HeartPulse size={8} />
                <span>{p.status}</span>
              </span>
            </div>

            <div className="flex items-center justify-between mt-6 text-[10px] text-muted-foreground font-mono">
              <span>Avg Speed:</span>
              <span className="text-white font-bold">{p.speed}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Interactive prompt console */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <h3 className="text-sm font-semibold text-white">AI Testing Sandbox</h3>
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
