// src/components/pages/MessageObservatory.tsx
'use client'
import React, { useState } from 'react'
import { Search, Filter, Download, MessageSquareCode, Globe, User } from 'lucide-react'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

export default function MessageObservatory() {
  const { messages } = useDashboardStore()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'group' | 'dm'>('all')

  const filteredMessages = messages.filter(msg => {
    // Search filter
    const matchesSearch = 
      msg.sender.toLowerCase().includes(search.toLowerCase()) ||
      msg.chatId.toLowerCase().includes(search.toLowerCase()) ||
      msg.body.toLowerCase().includes(search.toLowerCase())

    // Category filter
    const matchesCategory = 
      filterType === 'all' ||
      (filterType === 'group' && msg.isGroup) ||
      (filterType === 'dm' && !msg.isGroup)

    return matchesSearch && matchesCategory
  })

  // Format timestamp (HH:MM:ss)
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })
  }

  // Export logs to JSON
  const handleExport = () => {
    const dataStr = JSON.stringify(filteredMessages, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr)
    const exportFileDefaultName = `wabot_messages_${Date.now()}.json`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }

  return (
    <div className="space-y-6 h-full flex flex-col pb-10">
      {/* Top Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div className="flex items-center gap-3 w-full sm:max-w-xs bg-muted/40 border border-border/60 rounded-lg px-3 py-2">
          <Search size={14} className="text-muted-foreground" />
          <input
            type="text"
            placeholder="Search JID, text body, or sender..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex bg-muted/30 border border-border/40 p-0.5 rounded-lg">
            {(['all', 'group', 'dm'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[10px] uppercase tracking-wider font-semibold transition-all duration-150",
                  filterType === type 
                    ? "bg-surface text-white border border-border/60 shadow" 
                    : "text-muted-foreground hover:text-white"
                )}
              >
                {type}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted border border-border rounded-lg text-xs font-semibold text-white transition-colors"
          >
            <Download size={13} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Message Stream */}
      <div className="flex-1 border border-border/80 bg-surface/10 rounded-xl glassmorphism flex flex-col overflow-hidden min-h-[400px]">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/60 text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 font-mono">
          <div className="col-span-1">Time</div>
          <div className="col-span-1">Context</div>
          <div className="col-span-3">Sender JID</div>
          <div className="col-span-1 font-sans">Type</div>
          <div className="col-span-6 font-sans">Message Body</div>
        </div>

        {/* Stream Content */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/30 font-mono text-xs">
          {filteredMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-12 text-muted-foreground/80 space-y-3">
              <MessageSquareCode size={36} className="text-muted-foreground/45" />
              <p className="text-xs">No messages streaming. Keep chat active on WhatsApp.</p>
            </div>
          ) : (
            filteredMessages.map((msg) => (
              <div 
                key={msg.id}
                className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-muted/10 transition-colors animate-fade-in"
              >
                {/* Time */}
                <div className="col-span-1 text-[10px] text-muted-foreground/80 font-mono">
                  {formatTime(msg.timestamp)}
                </div>

                {/* Context badge */}
                <div className="col-span-1">
                  {msg.isGroup ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-semibold text-amber-500">
                      <Globe size={8} />
                      <span>GRP</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-semibold text-emerald-500">
                      <User size={8} />
                      <span>DM</span>
                    </span>
                  )}
                </div>

                {/* Sender JID */}
                <div className="col-span-3 text-[11px] text-muted-foreground truncate hover:text-white transition-colors" title={msg.sender}>
                  {msg.sender.split('@')[0]}
                </div>

                {/* Message type */}
                <div className="col-span-1 text-[10px] text-muted-foreground/70 uppercase">
                  {msg.type.replace('Message', '')}
                </div>

                {/* Message body content */}
                <div className="col-span-6 font-sans text-white truncate pr-4" title={msg.body}>
                  {msg.body || <span className="text-[10px] text-muted-foreground/50 italic">(empty or media message)</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
