// src/components/pages/Commands.tsx
'use client'
import React, { useState } from 'react'
import { SlidersHorizontal, Shield, RefreshCw, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

interface CommandsProps {
  emit: (event: string, data?: any) => void
}

export default function Commands({ emit }: CommandsProps) {
  const { commandsList } = useDashboardStore()
  const [search, setSearch] = useState('')

  // Mock list if empty
  const commands = commandsList.length > 0 ? commandsList : [
    { name: 'help', category: 'general', cooldown: 3, permissions: ['user'], enabled: true },
    { name: 'kick', category: 'admin', cooldown: 3, permissions: ['admin'], enabled: true },
    { name: 'bc', category: 'owner', cooldown: 0, permissions: ['owner'], enabled: true },
    { name: 'cuaca', category: 'utility', cooldown: 5, permissions: ['user'], enabled: true },
    { name: 'sticker', category: 'media', cooldown: 5, permissions: ['user'], enabled: false }
  ]

  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(search.toLowerCase()) ||
    cmd.category.toLowerCase().includes(search.toLowerCase())
  )

  const handleToggleCommand = (name: string, current: boolean) => {
    emit('command:toggle', { name, enabled: !current })
    toast.success(`Command status toggled: ${name}`)
  }

  const handleHotReload = () => {
    emit('commands:reload')
    toast.success('Hot reloading commands...', { icon: '🔄' })
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">Commands Configuration</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Manage available commands and configure rate limits in real-time</p>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto">
          {/* Search bar */}
          <input
            type="text"
            placeholder="Search commands..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:max-w-xs h-9 px-3 bg-muted/40 border border-border/80 rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
          />

          {/* Hot Reload button */}
          <button
            onClick={handleHotReload}
            className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors shrink-0"
          >
            <RefreshCw size={13} />
            <span>Hot Reload</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCommands.map((cmd) => (
          <div 
            key={cmd.name} 
            className={cn(
              "p-5 bg-surface/20 border border-border rounded-xl flex flex-col justify-between transition-opacity duration-200",
              !cmd.enabled && "opacity-60"
            )}
          >
            <div>
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-white font-mono">!{cmd.name}</h4>
                <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/80 bg-muted/40 border border-border/30 px-1.5 py-0.5 rounded font-mono">
                  {cmd.category}
                </span>
              </div>
              
              <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground font-mono">
                <div className="flex items-center gap-1">
                  <Shield size={12} className="text-accent" />
                  <span className="capitalize">{cmd.permissions?.[0] ?? 'user'}</span>
                </div>
                <div>
                  <span>CD: </span>
                  <span className="text-white font-semibold">{cmd.cooldown}s</span>
                </div>
              </div>
            </div>

            {/* Toggle Status switch */}
            <div className="flex items-center justify-between mt-6 border-t border-border/40 pt-4">
              <span className="text-[10px] font-mono text-muted-foreground">
                Status: <span className={cmd.enabled ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>{cmd.enabled ? 'Enabled' : 'Disabled'}</span>
              </span>

              <button
                onClick={() => handleToggleCommand(cmd.name, cmd.enabled)}
                className={cn(
                  "p-2 rounded-lg border flex items-center justify-center transition-colors",
                  cmd.enabled 
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20" 
                    : "bg-rose-500/10 border-rose-500/20 text-rose-500 hover:bg-rose-500/20"
                )}
                title={cmd.enabled ? "Disable command" : "Enable command"}
              >
                {cmd.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
