// src/components/pages/Moderation.tsx
'use client'
import React, { useState } from 'react'
import { ShieldAlert, Trash2, ShieldCheck, UserMinus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '../../utils/cn'

interface ModerationProps {
  emit: (event: string, data?: any) => void
}

export default function Moderation({ emit }: ModerationProps) {
  // Mock audit logs
  const [logs, setLogs] = useState([
    { id: '1', timestamp: Date.now() - 300000, JID: '628222222222@s.whatsapp.net', name: 'Testing Account', reason: 'Makian kasar/vulgar ("anjing bajingan")', action: 'WARN (1/3)' },
    { id: '2', timestamp: Date.now() - 1200000, JID: '628333333333@s.whatsapp.net', name: 'Spammy User', reason: 'Promosi link judi online (slot-gacor...)', action: 'WARN (2/3)' },
    { id: '3', timestamp: Date.now() - 3600000, JID: '628999999999@s.whatsapp.net', name: 'Scammer Bot', reason: 'Spam Phishing Link massal', action: 'AUTO-KICKED' }
  ])

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  const handleClearLogs = () => {
    setLogs([])
    toast.success('Moderation audit log cleared')
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">AI Moderation Audit Trail</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Review blocked toxic messages, suspicious JIDs, and auto-moderation warnings</p>
        </div>
        
        {logs.length > 0 && (
          <button
            onClick={handleClearLogs}
            className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 text-rose-500 text-xs font-semibold rounded-lg transition-colors"
          >
            <Trash2 size={13} />
            <span>Clear Logs</span>
          </button>
        )}
      </div>

      <div className="border border-border/80 bg-surface/10 rounded-xl glassmorphism overflow-hidden">
        {/* Table Header */}
        <div className="hidden sm:grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/60 text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 font-mono">
          <div className="col-span-1">Time</div>
          <div className="col-span-3">User Profile</div>
          <div className="col-span-4">Violation Detected</div>
          <div className="col-span-2">Enforcement Action</div>
          <div className="col-span-2 text-right">Details</div>
        </div>

        {/* List Content */}
        <div className="divide-y divide-border/30 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="p-12 text-center text-xs text-muted-foreground/80 font-sans flex flex-col items-center justify-center gap-3">
              <ShieldCheck size={36} className="text-emerald-500/60" />
              <p>All clean. No moderation violations logged recently.</p>
            </div>
          ) : (
            logs.map((log) => (
              <div 
                key={log.id}
                className="flex flex-col sm:grid sm:grid-cols-12 gap-3 sm:gap-4 px-6 py-4 items-start sm:items-center hover:bg-muted/10 transition-colors"
              >
                {/* Time & Details grouping row for mobile */}
                <div className="flex sm:contents items-center justify-between w-full">
                  {/* Time */}
                  <div className="sm:col-span-1 text-[10px] text-muted-foreground">
                    <span className="sm:hidden text-[9px] uppercase font-mono text-muted-foreground/50 block mb-0.5">Time</span>
                    {formatTime(log.timestamp)}
                  </div>

                  {/* Info details */}
                  <div className="sm:col-span-2 sm:text-right text-[10px] text-muted-foreground">
                    <span className="sm:hidden text-[9px] uppercase font-mono text-muted-foreground/50 block mb-0.5 text-right">Violation ID</span>
                    ID: #{log.id}
                  </div>
                </div>

                {/* User */}
                <div className="sm:col-span-3 truncate text-white w-full">
                  <span className="sm:hidden text-[9px] uppercase font-mono text-muted-foreground/50 block mb-0.5">User Profile</span>
                  <span className="font-semibold font-sans">{log.name}</span>
                  <span className="block text-[9px] text-muted-foreground/80 truncate mt-0.5">{log.JID}</span>
                </div>

                {/* Violation */}
                <div className="sm:col-span-4 font-sans text-white/90 w-full">
                  <span className="sm:hidden text-[9px] uppercase font-mono text-muted-foreground/50 block mb-0.5">Violation Detected</span>
                  {log.reason}
                </div>

                {/* Action Badge */}
                <div className="sm:col-span-2 w-full">
                  <span className="sm:hidden text-[9px] uppercase font-mono text-muted-foreground/50 block mb-0.5">Enforcement Action</span>
                  <span className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border",
                    log.action.includes('KICK') 
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-500" 
                      : "bg-amber-500/10 border-amber-500/20 text-amber-500"
                  )}>
                    {log.action.includes('KICK') ? <UserMinus size={9} /> : <AlertTriangle size={9} />}
                    <span>{log.action}</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
