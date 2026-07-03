// src/components/pages/Automations.tsx
'use client'
import React, { useState } from 'react'
import { Play, Zap, ArrowRight, Plus, Trash2, ToggleLeft, ToggleRight, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Automations() {
  const [workflows, setWorkflows] = useState([
    { id: '1', name: 'Auto-Welcome Message', trigger: 'User Joined', action: 'Send Welcome Banner', active: true },
    { id: '2', name: 'Notify Admin on Error', trigger: 'Log Error Generated', action: 'Notify Admin via WhatsApp', active: true },
    { id: '3', name: 'Toxic Auto-Warn Counter', trigger: 'Message Contains Toxicity', action: 'Increment Warnings', active: true },
    { id: '4', name: 'Suno Music Video Generator', trigger: 'WhatsApp Command / Dashboard Input', action: 'Loop Video & Upload to YouTube', active: true, route: '/sunoautomation' }
  ])

  const handleToggle = (id: string, current: boolean) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, active: !current } : w))
    toast.success(`Workflow state updated`)
  }

  const handleDelete = (id: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== id))
    toast.success('Workflow deleted')
  }

  const handleAdd = () => {
    toast.error('Automation Node-Builder editing is available in premium enterprise tier.')
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">Workflows & Automations</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Set triggers and configure automated bot operations</p>
        </div>
        
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors"
        >
          <Plus size={13} />
          <span>New Workflow</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {workflows.map((flow) => (
          <div key={flow.id} className="p-5 bg-surface/20 border border-border rounded-xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start gap-4">
                <h4 className="text-xs font-bold text-white font-mono">{flow.name}</h4>
                <button
                  onClick={() => handleToggle(flow.id, flow.active)}
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  {flow.active ? (
                    <ToggleRight className="text-emerald-500" size={20} />
                  ) : (
                    <ToggleLeft size={20} />
                  )}
                </button>
              </div>

              {/* Node-Builder style visualization */}
              <div className="flex flex-wrap items-center gap-3 mt-6 bg-muted/20 border border-border/60 p-3 rounded-lg text-[10px] font-mono text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-muted border border-border/40 px-2 py-1 rounded text-white max-w-full truncate">
                  <Zap size={10} className="text-amber-500 animate-pulse-soft shrink-0" />
                  <span className="truncate">{flow.trigger}</span>
                </div>
                <ArrowRight size={12} className="text-muted-foreground/45 shrink-0" />
                <div className="flex items-center gap-1.5 bg-muted border border-border/40 px-2 py-1 rounded text-white max-w-full truncate">
                  <Play size={10} className="text-accent shrink-0" />
                  <span className="truncate">{flow.action}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 border-t border-border/40 pt-4">
              {'route' in flow && flow.route && (
                <a
                  href={flow.route}
                  className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[10px] font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer ml-auto"
                >
                  <ExternalLink size={10} />
                  <span>Configure Pipeline</span>
                </a>
              )}
              <button
                onClick={() => handleDelete(flow.id)}
                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 text-rose-500 rounded-lg transition-colors inline-flex"
                title="Delete Workflow"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
