// src/components/pages/LogsCenter.tsx
'use client'
import React, { useState } from 'react'
import { Terminal, Search, Trash2, Download } from 'lucide-react'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

export default function LogsCenter() {
  const { logs } = useDashboardStore()
  const [search, setSearch] = useState('')

  const filteredLogs = logs.filter(log =>
    log.text.toLowerCase().includes(search.toLowerCase())
  )

  const handleClear = () => {
    useDashboardStore.setState({ logs: [] })
  }

  const handleDownload = () => {
    const dataStr = filteredLogs.map(l => `[${new Date(l.timestamp).toISOString()}] ${l.text}`).join('\n')
    const dataUri = 'data:text/plain;charset=utf-8,'+ encodeURIComponent(dataStr)
    
    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', `wabot_console_logs_${Date.now()}.txt`)
    linkElement.click()
  }

  // Helper to color levels
  const formatLogText = (text: string) => {
    if (text.includes('[ERROR]') || text.includes('❌')) {
      return <span className="text-rose-400">{text}</span>
    }
    if (text.includes('[WARN]') || text.includes('⚠️')) {
      return <span className="text-amber-400">{text}</span>
    }
    if (text.includes('[AI]') || text.includes('🤖')) {
      return <span className="text-magenta-400 text-pink-400">{text}</span>
    }
    if (text.includes('[CMD]') || text.includes('🚀')) {
      return <span className="text-emerald-400">{text}</span>
    }
    return <span className="text-gray-300">{text}</span>
  }

  return (
    <div className="space-y-6 h-full flex flex-col pb-10">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div className="flex items-center gap-3">
          <Terminal size={18} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-white font-mono">Developer Console</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-sans font-mono">Real-time log capture from bot daemon</p>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto">
          {/* Search bar */}
          <input
            type="text"
            placeholder="Filter logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:max-w-xs h-9 px-3 bg-muted/40 border border-border/80 rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
          />

          <button
            onClick={handleDownload}
            disabled={filteredLogs.length === 0}
            className="p-2 bg-muted/40 hover:bg-muted border border-border/80 rounded-lg text-white disabled:opacity-50 transition-all inline-flex"
            title="Download Logs"
          >
            <Download size={13} />
          </button>

          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="p-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-rose-500 disabled:opacity-50 transition-all inline-flex"
            title="Clear Console"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Terminal Board console */}
      <div className="flex-1 bg-neutral-950/80 border border-border/80 rounded-xl p-6 font-mono text-[11px] leading-relaxed overflow-y-auto min-h-[400px] flex flex-col-reverse justify-end max-h-[600px] scrollbar-thin">
        {filteredLogs.length === 0 ? (
          <div className="text-muted-foreground/60 text-center py-12 select-none font-sans text-xs">
            Console idle. Logs will appear dynamically.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="py-1 border-b border-border/20 flex gap-4 select-text">
              <span className="text-muted-foreground/40 select-none">
                {new Date(log.timestamp).toLocaleTimeString('id-ID', { hour12: false })}
              </span>
              <div className="flex-1 break-all">
                {formatLogText(log.text)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
