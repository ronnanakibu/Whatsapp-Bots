// src/app/page.tsx
'use client'
import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, AlertCircle, RefreshCw, Menu } from 'lucide-react'
import toast from 'react-hot-toast'

import Sidebar from '../components/Sidebar'
import ThreeBackground from '../components/ThreeBackground'
import CommandPalette from '../components/CommandPalette'
import { useSocket } from '../hooks/useSocket'
import { useDashboardStore } from '../store/dashboard'
import { cn } from '../utils/cn'

// Import all pages lazily or directly since it is client-only
import Overview from '../components/pages/Overview'
import MessageObservatory from '../components/pages/MessageObservatory'
import Analytics from '../components/pages/Analytics'
import AICenter from '../components/pages/AICenter'
import Groups from '../components/pages/Groups'
import Users from '../components/pages/Users'
import Commands from '../components/pages/Commands'
import Downloader from '../components/pages/Downloader'
import Moderation from '../components/pages/Moderation'
import Memory from '../components/pages/Memory'
import Automations from '../components/pages/Automations'
import LogsCenter from '../components/pages/LogsCenter'
import Deployments from '../components/pages/Deployments'
import Developer from '../components/pages/Developer'
import Settings from '../components/pages/Settings'
import PublicSummary from '../components/pages/PublicSummary'

export default function DashboardPage() {
  const [viewMode, setViewMode] = useState<'public' | 'admin'>('public')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState(false)
  const [isLoadingAuth, setIsLoadingAuth] = useState(true)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const { activeTab, isConnected } = useDashboardStore()
  
  // Hubungkan ke Socket.IO
  const { emit } = useSocket()

  useEffect(() => {
    // Check localStorage token
    const token = localStorage.getItem('bot_auth_token')
    if (token === '6285172013920_2007') {
      setIsAuthenticated(true)
    }
    setIsLoadingAuth(false)
  }, [])

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (phoneNumber.trim() === '6285172013920' && password.trim() === '2007') {
      localStorage.setItem('bot_auth_token', '6285172013920_2007')
      setIsAuthenticated(true)
      setAuthError(false)
      toast.success('Successfully Authenticated')
    } else {
      setAuthError(true)
      toast.error('Invalid phone number or password')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('bot_auth_token')
    setIsAuthenticated(false)
    setPhoneNumber('')
    setPassword('')
    setViewMode('public')
    toast.success('Logged Out')
  }

  // Menangani aksi dari Command Palette
  const handleCommandPaletteAction = (action: string, data?: any) => {
    if (action === 'restart_bot') {
      toast.loading('Restarting Bot Engine...', { duration: 3000 })
      emit('bot:restart')
    } else if (action === 'clear_logs') {
      useDashboardStore.setState({ logs: [] })
      toast.success('Console logs cleared')
    }
  }

  const renderActivePage = () => {
    switch (activeTab) {
      case 'overview': return <Overview />
      case 'messages': return <MessageObservatory />
      case 'analytics': return <Analytics />
      case 'ai': return <AICenter />
      case 'groups': return <Groups emit={emit} />
      case 'users': return <Users emit={emit} />
      case 'commands': return <Commands emit={emit} />
      case 'downloader': return <Downloader />
      case 'moderation': return <Moderation emit={emit} />
      case 'memory': return <Memory emit={emit} />
      case 'automations': return <Automations />
      case 'logs': return <LogsCenter />
      case 'deployments': return <Deployments />
      case 'developer': return <Developer />
      case 'settings': return <Settings />
      default: return <Overview />
    }
  }

  if (isLoadingAuth) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <RefreshCw size={24} className="text-accent animate-spin" />
      </div>
    )
  }

  if (viewMode === 'public') {
    return <PublicSummary setViewMode={setViewMode} />
  }

  if (!isAuthenticated) {
    return (
      <main className="h-screen w-screen flex items-center justify-center relative overflow-hidden bg-background">
        <ThreeBackground />
        
        <div className="w-full max-w-sm p-8 bg-surface/40 border border-border rounded-2xl shadow-2xl glassmorphism z-10 animate-fade-up">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="p-3 bg-accent/10 border border-accent/20 rounded-xl text-accent mb-4">
              <Lock size={20} className="animate-pulse-soft" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">Authenticate RonnBot</h1>
            <p className="text-xs text-muted-foreground mt-1.5">
              Enter your credentials to view the real-time panel
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Phone Number"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                required
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full h-11 px-4 bg-muted/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                required
              />
            </div>
            {authError && (
              <div className="flex items-center gap-2 text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 p-3 rounded-lg">
                <AlertCircle size={14} />
                <span>Incorrect credentials, please try again.</span>
              </div>
            )}
            <button
              type="submit"
              className="w-full h-11 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors flex items-center justify-center"
            >
              Sign In
            </button>
          </form>
          
          <div className="mt-4 text-center">
            <button
              onClick={() => setViewMode('public')}
              className="text-xs text-muted-foreground hover:text-white transition-colors"
            >
              ← Back to Public Summary
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="h-screen w-screen flex flex-col overflow-hidden bg-background relative animate-fade-in font-display">
      <ThreeBackground />
      <CommandPalette onAction={handleCommandPaletteAction} />
      
      {/* Top Navigation Bar (cPanel Style) */}
      <header className="h-16 border-b border-border bg-surface/80 backdrop-blur-md px-6 flex items-center justify-between z-20 shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => useDashboardStore.setState({ activeTab: 'overview' })}>
            <div className="p-2 bg-accent/20 rounded-lg border border-accent/30 text-accent">
              <Bot size={22} />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">BotOS Admin</h1>
              <p className="text-[10px] text-muted-foreground font-mono">v2.0 Console</p>
            </div>
          </div>
          {activeTab !== 'overview' && (
            <>
              <div className="h-6 w-[1px] bg-border mx-2"></div>
              <button 
                onClick={() => useDashboardStore.setState({ activeTab: 'overview' })}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-surface border border-border hover:bg-surface-elevated hover:border-border-subtle transition-all text-white"
              >
                ← Back to Grid
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-surface-elevated text-[10px] text-muted-foreground font-mono">
            CTRL + K
          </kbd>
          <div className="h-6 w-[1px] bg-border hidden sm:block"></div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface rounded-lg border border-border">
            <span className={cn("relative flex h-2.5 w-2.5")}>
              {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>}
              <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", isConnected ? "bg-success" : "bg-danger")}></span>
            </span>
            <span className="text-[11px] font-bold tracking-wide uppercase text-white font-mono">
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-danger/10 text-muted-foreground hover:text-danger rounded-lg transition-colors"
            title="Logout"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 z-10 relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="h-full w-full max-w-7xl mx-auto"
          >
            {renderActivePage()}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}
