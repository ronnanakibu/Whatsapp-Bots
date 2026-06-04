// src/components/Sidebar.tsx
'use client'
import React from 'react'
import { motion } from 'framer-motion'
import { 
  LayoutDashboard, MessageSquare, BarChart3, Bot, Users2, ShieldAlert,
  FolderLock, RefreshCw, Terminal, Settings, UserSquare2, SlidersHorizontal,
  Compass, Radio, Power, Cloud, Lock, HardDrive, HelpCircle
} from 'lucide-react'
import { TabType, useDashboardStore } from '../store/dashboard'
import { cn } from '../utils/cn'

interface SidebarProps {
  onLogout?: () => void
}

export default function Sidebar({ onLogout }: SidebarProps) {
  const { activeTab, setActiveTab, isConnected, botStatus } = useDashboardStore()

  const navItems = [
    { id: 'overview' as TabType, label: 'Overview', icon: LayoutDashboard },
    { id: 'messages' as TabType, label: 'Message Observatory', icon: MessageSquare },
    { id: 'analytics' as TabType, label: 'Analytics Center', icon: BarChart3 },
    { id: 'ai' as TabType, label: 'AI Center', icon: Bot },
    { id: 'groups' as TabType, label: 'Groups', icon: Users2 },
    { id: 'users' as TabType, label: 'Users', icon: UserSquare2 },
    { id: 'commands' as TabType, label: 'Commands', icon: SlidersHorizontal },
    { id: 'downloader' as TabType, label: 'Downloader', icon: Compass },
    { id: 'moderation' as TabType, label: 'Moderation', icon: ShieldAlert },
    { id: 'memory' as TabType, label: 'Memory', icon: FolderLock },
    { id: 'automations' as TabType, label: 'Automations', icon: RefreshCw },
    { id: 'logs' as TabType, label: 'Live Logs', icon: Terminal },
    { id: 'deployments' as TabType, label: 'Deployments', icon: Cloud },
    { id: 'developer' as TabType, label: 'Developer', icon: HelpCircle },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ]

  const getStatusBadge = () => {
    switch (botStatus) {
      case 'open':
        return <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse-soft" />
      case 'connecting':
        return <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
      case 'qr':
        return <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      default:
        return <span className="flex h-2 w-2 rounded-full bg-rose-500" />
    }
  }

  return (
    <aside className="w-64 h-screen border-r border-border bg-surface/50 backdrop-blur-md flex flex-col justify-between select-none z-10">
      {/* Brand Logo & Connection status */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent/10 border border-accent/25 rounded-md text-accent">
            <Radio size={18} className="animate-pulse-soft" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">BotOS</h1>
            <p className="text-[10px] text-muted-foreground font-mono">v2.5.0</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-full border border-border text-[10px] text-muted-foreground font-medium">
          {getStatusBadge()}
          <span className="capitalize">{botStatus === 'open' ? 'Active' : botStatus === 'qr' ? 'Pairing' : botStatus}</span>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          const Icon = item.icon

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-all duration-200 relative group",
                isActive 
                  ? "text-white bg-muted border border-border" 
                  : "text-muted-foreground hover:text-white hover:bg-muted/30"
              )}
            >
              {isActive && (
                <motion.div 
                  layoutId="active-indicator"
                  className="absolute left-0 w-[3px] h-4 bg-accent rounded-r-md"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <Icon size={16} className={cn("transition-colors", isActive ? "text-accent" : "text-muted-foreground group-hover:text-white")} />
              <span>{item.label}</span>
            </button>
          )
        })}

        {/* External Link to Radio Panel */}
        <div className="pt-4 border-t border-border/40 mt-4 space-y-1">
          <p className="px-3 text-[9px] uppercase font-bold text-muted-foreground/60 tracking-wider font-mono">External Panel</p>
          <a
            href="/radio"
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-white hover:bg-muted/30 transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <Radio size={16} className="text-muted-foreground group-hover:text-white" />
              <span>Radio Stream Panel</span>
            </div>
            <span className="text-[10px] text-muted-foreground/45 group-hover:text-white/80 font-mono transition-colors">↗</span>
          </a>
        </div>
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
        <div className="flex items-center gap-2">
          <div className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-emerald-500" : "bg-rose-500")} />
          <span>{isConnected ? 'Socket Connected' : 'Socket Disconnected'}</span>
        </div>
        {onLogout && (
          <button 
            onClick={onLogout}
            className="p-1.5 text-muted-foreground hover:text-white hover:bg-muted rounded transition-colors"
          >
            <Power size={13} />
          </button>
        )}
      </div>
    </aside>
  )
}
