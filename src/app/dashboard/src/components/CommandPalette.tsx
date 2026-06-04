// src/components/CommandPalette.tsx
'use client'
import React, { useState, useEffect, useRef } from 'react'
import { Search, Terminal, Settings, LayoutDashboard, MessageSquare, Bot, Users2, ShieldAlert, Zap } from 'lucide-react'
import { TabType, useDashboardStore } from '../store/dashboard'
import { cn } from '../utils/cn'

interface CommandPaletteProps {
  onAction?: (actionName: string, data?: any) => void
}

export default function CommandPalette({ onAction }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  
  const { setActiveTab } = useDashboardStore()

  const items = [
    // Navigation
    { id: 'nav-overview', label: 'Go to Overview', category: 'Navigation', icon: LayoutDashboard, action: () => setActiveTab('overview') },
    { id: 'nav-messages', label: 'Go to Message Observatory', category: 'Navigation', icon: MessageSquare, action: () => setActiveTab('messages') },
    { id: 'nav-ai', label: 'Go to AI Center', category: 'Navigation', icon: Bot, action: () => setActiveTab('ai') },
    { id: 'nav-groups', label: 'Go to Groups List', category: 'Navigation', icon: Users2, action: () => setActiveTab('groups') },
    { id: 'nav-moderation', label: 'Go to Moderation Center', category: 'Navigation', icon: ShieldAlert, action: () => setActiveTab('moderation') },
    { id: 'nav-settings', label: 'Go to Settings', category: 'Navigation', icon: Settings, action: () => setActiveTab('settings') },
    
    // Actions
    { id: 'act-restart', label: 'Restart Bot Engine (Graceful)', category: 'System Actions', icon: Zap, action: () => onAction?.('restart_bot') },
    { id: 'act-clear-logs', label: 'Clear Console logs', category: 'System Actions', icon: Terminal, action: () => onAction?.('clear_logs') },
  ]

  const filteredItems = items.filter(item =>
    item.label.toLowerCase().includes(search.toLowerCase()) ||
    item.category.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
      
      if (!isOpen) return

      if (e.key === 'Escape') {
        setIsOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredItems.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action()
          setIsOpen(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selectedIndex, filteredItems])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setSearch('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden glassmorphism flex flex-col max-h-[400px] animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input bar */}
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search size={18} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search..."
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              setSelectedIndex(0)
            }}
            className="w-full h-14 bg-transparent outline-none border-none text-sm text-foreground placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/50 text-[10px] text-muted-foreground font-mono">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No results found for &ldquo;{search}&rdquo;
            </div>
          ) : (
            // Grouped results could go here, but simple lists sorted by category are clean
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex
              const Icon = item.icon
              
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.action()
                    setIsOpen(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg text-xs cursor-pointer select-none transition-all duration-150",
                    isSelected ? "bg-muted text-white" : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={16} className={isSelected ? "text-accent" : "text-muted-foreground"} />
                    <span>{item.label}</span>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/40 border border-border/30">
                    {item.category}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
