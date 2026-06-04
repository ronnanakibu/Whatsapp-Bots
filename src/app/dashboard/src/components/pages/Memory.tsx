// src/components/pages/Memory.tsx
'use client'
import React, { useState } from 'react'
import { HardDrive, Trash2, ShieldAlert, Sparkles, Database } from 'lucide-react'
import toast from 'react-hot-toast'

interface MemoryProps {
  emit: (event: string, data?: any) => void
}

export default function Memory({ emit }: MemoryProps) {
  // Mock active topics
  const [contexts, setContexts] = useState([
    { chatId: '120363212345678@g.us', topic: 'general', messages: 12, size: '2.4 KB' },
    { chatId: '120363212345678@g.us', topic: 'coding', messages: 6, size: '1.2 KB' },
    { chatId: '628111111111@s.whatsapp.net', topic: 'general', messages: 20, size: '4.8 KB' },
    { chatId: '628222222222@s.whatsapp.net', topic: 'translation', messages: 4, size: '0.8 KB' }
  ])

  const handleClearContext = (chatId: string, topic: string) => {
    emit('memory:clear', { chatId, topic })
    setContexts(prev => prev.filter(c => !(c.chatId === chatId && c.topic === topic)))
    toast.success(`Context memory cleared for topic: ${topic}`)
  }

  const handleClearAll = () => {
    emit('memory:clear_all')
    setContexts([])
    toast.success('All SQLite chat memories purged')
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">SQLite Memory Inspector</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Monitor active AI conversation context sizes and manage topic indexes</p>
        </div>
        
        {contexts.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 text-rose-500 text-xs font-semibold rounded-lg transition-colors"
          >
            <ShieldAlert size={13} />
            <span>Purge Memory</span>
          </button>
        )}
      </div>

      <div className="border border-border/80 bg-surface/10 rounded-xl glassmorphism overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/60 text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 font-mono">
          <div className="col-span-4">WhatsApp JID</div>
          <div className="col-span-2">Active Topic</div>
          <div className="col-span-2 text-right">Messages Count</div>
          <div className="col-span-2 text-right">Estimated Size</div>
          <div className="col-span-2 text-right">Action</div>
        </div>

        {/* List Content */}
        <div className="divide-y divide-border/30 font-mono text-xs">
          {contexts.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground/80 font-sans flex flex-col items-center justify-center gap-3">
              <Database size={36} className="text-muted-foreground/45" />
              <p>No active memory records in SQLite database.</p>
            </div>
          ) : (
            contexts.map((c, i) => (
              <div 
                key={i}
                className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/10 transition-colors"
              >
                {/* JID */}
                <div className="col-span-4 truncate text-white">
                  {c.chatId}
                </div>

                {/* Topic badge */}
                <div className="col-span-2">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 text-[9px] font-semibold text-accent uppercase">
                    <Sparkles size={8} />
                    <span>{c.topic}</span>
                  </span>
                </div>

                {/* Messages count */}
                <div className="col-span-2 text-right text-white font-semibold">
                  {c.messages} msgs
                </div>

                {/* Size */}
                <div className="col-span-2 text-right text-muted-foreground">
                  {c.size}
                </div>

                {/* Action button */}
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => handleClearContext(c.chatId, c.topic)}
                    className="p-1.5 hover:bg-muted border border-border/80 hover:border-border text-muted-foreground hover:text-white rounded-lg transition-colors inline-flex"
                    title="Clear Topic Context"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
