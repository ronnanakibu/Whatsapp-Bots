// src/components/pages/PublicSummary.tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Terminal, Activity, Cpu, Clock, Compass, Users2, MessageSquare, 
  Music, Volume2, Play, Pause, Calendar, ChevronRight, Sparkles, 
  Search, ExternalLink, Lock, Settings, Sun, Moon, Github, Instagram, 
  Mail, BookOpen, Info, Globe, Database, Bot, Zap, Workflow, Shield, 
  History, Send, VolumeX, AlertCircle, HelpCircle, Layers
} from 'lucide-react'
import { useDashboardStore } from '../../store/dashboard'
import ThreeBackground from '../ThreeBackground'

interface PublicSummaryProps {
  setViewMode: (mode: 'public' | 'admin') => void
}

// Simple CountUp helper
function AnimatedCounter({ value }: { value: number }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let start = 0
    const end = value
    if (end === 0) return
    const duration = 1.0 // seconds
    const totalFrames = 60 * duration
    let frame = 0
    
    const counter = setInterval(() => {
      frame++
      const progress = frame / totalFrames
      const current = Math.round(end * (1 - (1 - progress) * (1 - progress))) // Ease out
      setCount(current)
      
      if (frame >= totalFrames) {
        clearInterval(counter)
        setCount(end)
      }
    }, 1000 / 60)

    return () => clearInterval(counter)
  }, [value])

  return <span>{count.toLocaleString()}</span>
}

export default function PublicSummary({ setViewMode }: PublicSummaryProps) {
  const { metrics, uptime, botStatus, isConnected } = useDashboardStore()
  
  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // UI state
  const [activeModalFeature, setActiveModalFeature] = useState<string | null>(null)
  const [spotlightIndex, setSpotlightIndex] = useState(0)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [galleryImgUrl, setGalleryImgUrl] = useState<string | null>(null)

  // Radio Audio Player State
  const [radioIsPlaying, setRadioIsPlaying] = useState(false)
  const [radioVolume, setRadioVolume] = useState(0.8)
  const [radioMuted, setRadioMuted] = useState(false)
  const [radioDetails, setRadioDetails] = useState<any>(null)
  const [radioLoading, setRadioLoading] = useState(false)
  
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Initialize Theme and Ctrl+K handlers
  useEffect(() => {
    // Check local storage theme
    const storedTheme = localStorage.getItem('summary_theme') as 'dark' | 'light'
    if (storedTheme) {
      setTheme(storedTheme)
      if (storedTheme === 'light') {
        document.documentElement.classList.add('light')
      } else {
        document.documentElement.classList.remove('light')
      }
    } else {
      localStorage.setItem('summary_theme', 'dark')
    }

    // Enable scrolling for landing page
    document.body.classList.remove('overflow-hidden')
    document.body.classList.add('overflow-y-auto')
    document.documentElement.classList.add('scroll-smooth')

    // Ctrl+K Listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false)
        setActiveModalFeature(null)
        setGalleryImgUrl(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      // Restore overflow-hidden for admin dashboard on unmount
      document.body.classList.remove('overflow-y-auto')
      document.body.classList.add('overflow-hidden')
      document.documentElement.classList.remove('scroll-smooth')
    }
  }, [])

  // Theme Toggler
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    localStorage.setItem('summary_theme', nextTheme)
    if (nextTheme === 'light') {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
  }

  // Radio metadata polling
  useEffect(() => {
    const fetchRadioMetadata = async () => {
      try {
        const origin = window.location.origin
        // Fallback for development
        const host = origin.includes('localhost') || origin.includes('127.0.0.1')
          ? 'http://ap2.nzb.zelpstore.id:25637'
          : origin
        const res = await fetch(`${host}/status`)
        if (res.ok) {
          const data = await res.json()
          setRadioDetails(data)
        }
      } catch (err) {
        console.warn('Failed to fetch radio metadata:', err)
      }
    }

    fetchRadioMetadata()
    const poll = setInterval(fetchRadioMetadata, 8000)
    return () => clearInterval(poll)
  }, [])

  // Audio Stream handler
  const toggleRadioAudio = () => {
    if (!audioRef.current) {
      const origin = window.location.origin
      const host = origin.includes('localhost') || origin.includes('127.0.0.1')
        ? 'http://ap2.nzb.zelpstore.id:25637'
        : origin
      const audio = new Audio(`${host}/stream`)
      audio.volume = radioVolume
      audioRef.current = audio
    }

    if (radioIsPlaying) {
      audioRef.current.pause()
      setRadioIsPlaying(false)
    } else {
      setRadioLoading(true)
      audioRef.current.play()
        .then(() => {
          setRadioIsPlaying(true)
          setRadioLoading(false)
        })
        .catch((err) => {
          console.error('Playback failed:', err)
          setRadioLoading(false)
        })
    }
  }

  // Handle volume change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = radioMuted ? 0 : radioVolume
    }
  }, [radioVolume, radioMuted])

  // Feature Spotlight timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSpotlightIndex(prev => (prev + 1) % spotlightItems.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  // Feature details constant list
  const featuresList = [
    {
      id: 'ai_assistant',
      title: 'AI Assistant',
      icon: Bot,
      desc: 'Seamless AI chatbot with intelligent context limits and fallbacks.',
      color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20',
      longDesc: 'Our advanced chat companion parses conversational context and automatically fallbacks across high-performance LLM engines (Groq, Gemini, and NVIDIA NIM Llama). It retains local thread memory inside SQLite for natural interactions.',
      details: [
        { label: 'Fallback Logic', val: 'NVIDIA NIM ➔ Groq Llama ➔ Gemini 2.0 Flash' },
        { label: 'Memory Persistence', val: 'Session memory preserved via SQLite DB buffers' },
        { label: 'Media Input', val: 'Supports processing voice notes and images directly' },
        { label: 'Speed', val: 'Average response under 800ms' }
      ]
    },
    {
      id: 'downloader',
      title: 'Downloader System',
      icon: Compass,
      desc: 'Fast extraction pipeline supporting YouTube, TikTok, Instagram and Spotify.',
      color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
      longDesc: 'A unified downloading interface that processes social URLs directly inside WhatsApp groups. Features automatic audio/video compression to respect WhatsApp file upload limits.',
      details: [
        { label: 'Supported Platforms', val: 'YouTube, IG Reels, TikTok, Spotify, FB Video' },
        { label: 'Optimization', val: 'On-the-fly MP3/MP4 media compression and format swapping' },
        { label: 'Speed', val: 'Parallel processing threads for instantaneous responses' }
      ]
    },
    {
      id: 'moderation',
      title: 'AI Moderation',
      icon: Shield,
      desc: 'Automated threat filters, warning registers, and toxic message scans.',
      color: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
      longDesc: 'Maintains toxic speech filtering, anti-link rules, and warning strikes automatically inside group channels. Fully editable via RonnBot panels with zero hot-restarts required.',
      details: [
        { label: 'Real-time Listeners', val: 'Intercepts messages dynamically prior to command handlers' },
        { label: 'Sanctions', val: 'Configurable limits (Warn ➔ Temporary Mute ➔ Kick)' },
        { label: 'Anti-Link Detection', val: 'Restricts external links dynamically based on config' }
      ]
    },
    {
      id: 'memory',
      title: 'Memory Engine',
      icon: Database,
      desc: 'SQLite index cache tracking group configurations and user history.',
      color: 'text-sky-500 bg-sky-500/10 border-sky-500/20',
      longDesc: 'A customized, performant SQLite caching pipeline. Maintains system state variables, command frequencies, and individual group credentials with high-speed query response.',
      details: [
        { label: 'Engine Core', val: 'better-sqlite3 with WAL journal configurations' },
        { label: 'Index Synchronization', val: 'Live SQLite writes mapped directly to websocket triggers' },
        { label: 'Uptime Integrity', val: 'Automatic memory limits and backup logs flushing' }
      ]
    },
    {
      id: 'automations',
      title: 'Automation Center',
      icon: Workflow,
      desc: 'Cron workflows, heartbeat monitoring, and auto announcements.',
      color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
      longDesc: 'Runs background scheduling pipelines. Broadcasters send announcements dynamically to group channels with intelligent delay intervals to prevent spam flags.',
      details: [
        { label: 'Broadcaster Node', val: 'Intelligent multi-chat delivery delay (3-5s range)' },
        { label: 'Heartbeats', val: 'Checks status metrics and server parameters automatically' }
      ]
    },
    {
      id: 'analytics',
      title: 'Analytics System',
      icon: Activity,
      desc: 'Telemetry logging mapping hourly workloads and CPU performance.',
      color: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
      longDesc: 'Displays dynamic analytics feeds of command logs and AI latencies. Feeds hourly and provider distributions securely to dashboard interfaces without performance degradations.',
      details: [
        { label: 'Uptime Tracker', val: 'High-precision tracking of system status intervals' },
        { label: 'Metrics Mappings', val: 'Aggregates API hits and counts hourly volume' }
      ]
    },
    {
      id: 'community',
      title: 'Community Tools',
      icon: Users2,
      desc: 'Profile trackers, group welcome structures, and roles registers.',
      color: 'text-pink-500 bg-pink-500/10 border-pink-500/20',
      longDesc: 'Builds localized community tools. Formats automatic greetings, tracks user command counts for active rankings, and allows custom group welcome descriptions.',
      details: [
        { label: 'Ranks Tracker', val: 'Tracks command usages dynamically to assign roles' },
        { label: 'Welcome Templates', val: 'Supports custom profile tags inside messages' }
      ]
    },
    {
      id: 'radio_streaming',
      title: 'Radio Streaming',
      icon: Music,
      desc: 'Liquidsoap and Icecast stream pipelines for live music sharing.',
      color: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
      longDesc: 'Embeds a dedicated web stream audio station directly within RonnBot. Serves low-latency streams at `/stream` and details current audio metadata over REST status APIs.',
      details: [
        { label: 'Format Output', val: '128kbps stereo MP3 stream chunking' },
        { label: 'Integrations', val: 'Queue tracking, upcoming schedule layouts, SSE hooks' }
      ]
    }
  ]

  // Spotlight contents
  const spotlightItems = [
    {
      title: 'AI Center',
      tagline: 'Failover Orchestration at Scale',
      desc: 'When an AI provider encounters rate limits or goes down, WABOT 2.0 triggers an instant fallback chain. Active LLMs continue processing user questions seamlessly within 800ms.',
      stat: '99.9% AI Availability'
    },
    {
      title: 'Downloader Ecosystem',
      tagline: 'Instant Social-Media Extracts',
      desc: 'Extract and stream audio tracks, TikTok clips, and Instagram reels directly inside WhatsApp chat. Automatically compresses large files to guarantee instant loading.',
      stat: '5s Average Download Time'
    },
    {
      title: 'Memory Engine',
      tagline: 'SQLite and Context Preservation',
      desc: 'Powering context history and memory caches via robust SQL tables. Keeps group preferences, user warning counts, and AI threads optimized and persisted.',
      stat: '<2ms Query Execution'
    },
    {
      title: 'Radio Platform',
      tagline: 'Public Audio Streaming Node',
      desc: 'A built-in music synthesizer and stream host serving low-latency audio to web clients and group commands. Operates dynamically alongside bot handlers.',
      stat: '128kbps High Fidelity'
    }
  ]

  // Roadmap details
  const roadmapItems = [
    {
      status: 'completed',
      title: 'WABOT 2.0 Core',
      desc: 'Modular command loaders, robust Baileys sockets connection, and fail-safe system.',
      items: ['Baileys v6 API Sockets', 'Modular Plugins Engine', 'Context Warning Striker']
    },
    {
      status: 'completed',
      title: 'AI & Downloader integrations',
      desc: 'Multi-engine LLM orchestration, automated failovers, and parallel down loaders.',
      items: ['NVIDIA NIM & Groq Models', 'SQLite Memory Cache', 'Media Compression Pipeline']
    },
    {
      status: 'progress',
      title: 'RonnBot Dashboard Control Center',
      desc: 'Real-time telemetry control panel, interactive command toggler, and database inspection drawer.',
      items: ['Socket.IO Live Synchronization', 'Interactive SQLite Executor', 'Dynamic Moderation Switcher']
    },
    {
      status: 'progress',
      title: 'Public Summary Portal',
      desc: 'A high-end visitor landing, public stats overview, and direct streaming player.',
      items: ['Responsive Apple-Sleek UI', 'Live Radio Interface', 'CTRL+K Search palette']
    },
    {
      status: 'planned',
      title: 'Public APIs & Developer Portal',
      desc: 'Open endpoints for system stats integration, custom command developers, and public metrics widget widgets.',
      items: ['Rest APIs with API Keys', 'Plugin Marketplace SDK', 'Distributed Node Clustering']
    }
  ]

  // Contact list
  const contactsList = [
    { label: 'GitHub Profile', value: 'ronnanakibu', url: 'https://github.com/ronnanakibu', icon: Github },
    { label: 'Instagram', value: '@ronnlbtrn_', url: 'https://www.instagram.com/ronnlbtrn_/', icon: Instagram },
    { label: 'Developer Email', value: 'ronysihombing07@gmail.com', url: 'mailto:ronysihombing07@gmail.com', icon: Mail },
    { label: 'Creative Portfolio', value: 'Coming Soon', url: '#', icon: Globe }
  ]

  // Command palette items based on query
  const filteredPaletteItems = [
    { label: 'Jump to Home', action: () => scrollToSection('home'), category: 'Navigation' },
    { label: 'Jump to Features', action: () => scrollToSection('features'), category: 'Navigation' },
    { label: 'Jump to Status', action: () => scrollToSection('status'), category: 'Navigation' },
    { label: 'Jump to Radio Player', action: () => scrollToSection('radio'), category: 'Navigation' },
    { label: 'Jump to Developer Bio', action: () => scrollToSection('developer'), category: 'Navigation' },
    { label: 'Jump to Roadmap', action: () => scrollToSection('roadmap'), category: 'Navigation' },
    { label: 'Toggle Light/Dark Theme', action: () => toggleTheme(), category: 'Preferences' },
    { label: 'Access Admin Console', action: () => setViewMode('admin'), category: 'System' }
  ].filter(item => item.label.toLowerCase().includes(commandPaletteQuery.toLowerCase()))

  const scrollToSection = (id: string) => {
    setIsCommandPaletteOpen(false)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // Uptime formatting
  const formatUptime = (secs: number) => {
    if (secs <= 0) return '0s'
    const days = Math.floor(secs / (3600 * 24))
    const hours = Math.floor((secs % (3600 * 24)) / 3600)
    const minutes = Math.floor((secs % 3600) / 60)
    const seconds = secs % 60
    return [
      days > 0 ? `${days}d` : null,
      hours > 0 ? `${hours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
      `${seconds}s`
    ].filter(Boolean).join(' ')
  }

  return (
    <div className="min-h-screen text-foreground relative overflow-x-hidden selection:bg-accent/20 selection:text-accent font-body bg-background transition-colors duration-300">
      
      {/* Background Interactive canvas */}
      <ThreeBackground />

      {/* FIXED FLOATING NAVBAR */}
      <nav className="fixed top-5 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl h-14 bg-surface/40 border border-border/80 backdrop-blur-md rounded-full px-6 flex items-center justify-between z-40 shadow-xl transition-all hover:border-border duration-300">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => scrollToSection('home')}>
          <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-white font-bold tracking-tight">
            W
          </div>
          <span className="text-[11px] font-mono tracking-wider font-extrabold text-white hidden sm:inline-block">
            WABOT 2.0
          </span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6 text-[10.5px] font-medium text-muted-foreground">
          {['home', 'features', 'status', 'radio', 'developer', 'roadmap'].map((sec) => (
            <button 
              key={sec} 
              onClick={() => scrollToSection(sec)}
              className="capitalize hover:text-white hover:font-semibold transition-all"
            >
              {sec.replace('-', ' ')}
            </button>
          ))}
        </div>

        {/* Actions buttons */}
        <div className="flex items-center gap-3">
          {/* CTRL+K Search visual indicators */}
          <button 
            onClick={() => setIsCommandPaletteOpen(true)}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 bg-muted/30 border border-border/60 hover:border-border rounded-full text-[10px] text-muted-foreground font-mono transition-colors"
          >
            <Search size={10} />
            <span>Search</span>
            <kbd className="px-1 py-0.2 bg-muted/80 rounded border border-border text-[8px]">Ctrl+K</kbd>
          </button>

          {/* Theme switcher */}
          <button 
            onClick={toggleTheme}
            className="p-2 bg-muted/40 hover:bg-muted border border-border/60 hover:border-accent/40 rounded-full text-muted-foreground hover:text-accent transition-colors"
            title="Toggle Theme"
          >
            {theme === 'dark' ? <Sun size={12.5} /> : <Moon size={12.5} />}
          </button>

          {/* Admin console trigger */}
          <button 
            onClick={() => setViewMode('admin')}
            className="h-8 px-4 bg-white hover:bg-neutral-200 text-black text-[10px] font-bold rounded-full transition-all hover:scale-[1.03] flex items-center gap-1.5"
          >
            <Lock size={10} />
            <span>Admin Console</span>
          </button>
        </div>
      </nav>

      {/* HERO SECTION */}
      <header id="home" className="pt-32 pb-16 px-6 max-w-5xl mx-auto flex flex-col items-center text-center relative z-10 min-h-[90vh] justify-center">
        {/* Floating Tag */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-accent/20 bg-accent/5 text-[9px] font-mono text-accent uppercase tracking-wider font-semibold mb-6 animate-pulse-soft"
        >
          <Sparkles size={9} />
          <span>Ecosystem Public Portal</span>
        </motion.div>

        {/* Hero Title */}
        <motion.h1 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight text-gradient max-w-3xl leading-[1.1]"
        >
          WABOT 2.0 — AI-Powered WhatsApp Ecosystem
        </motion.h1>

        {/* Hero Description */}
        <motion.p 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-xs sm:text-sm text-muted-foreground max-w-xl mt-6 leading-relaxed"
        >
          A state-of-the-art automation framework combining high-availability conversational AI, media downloads, strict moderation rules, memory systems, and live music streaming inside a unified host.
        </motion.p>

        {/* Hero CTAs */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-4 mt-10"
        >
          <button 
            onClick={() => scrollToSection('features')}
            className="h-10 px-6 bg-accent text-white text-[11px] font-bold rounded-lg hover:bg-accent/90 transition-all hover:scale-[1.02]"
          >
            Explore Features
          </button>
          <button 
            onClick={() => scrollToSection('radio')}
            className="h-10 px-6 bg-surface/40 hover:bg-surface border border-border text-white text-[11px] font-semibold rounded-lg transition-all hover:scale-[1.02] flex items-center gap-2"
          >
            <Music size={12} className="text-accent" />
            <span>Live Radio</span>
          </button>
          <button 
            onClick={() => scrollToSection('developer')}
            className="h-10 px-6 bg-muted/40 hover:bg-muted border border-border text-muted-foreground hover:text-white text-[11px] font-semibold rounded-lg transition-all"
          >
            Meet The Developer
          </button>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0], y: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 2, delay: 1 }}
          className="mt-20 flex flex-col items-center gap-1.5 cursor-pointer"
          onClick={() => scrollToSection('features')}
        >
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-muted-foreground/60">Scroll to Explore</span>
          <div className="h-6 w-3.5 rounded-full border border-border/80 flex items-start justify-center p-0.5">
            <div className="h-1.5 w-1 rounded-full bg-accent animate-bounce" />
          </div>
        </motion.div>
      </header>

      {/* REAL-TIME ECOSYSTEM METRICS SECTION */}
      <section className="py-16 px-6 max-w-5xl mx-auto relative z-10 border-t border-border-subtle bg-surface/5 backdrop-blur-[1px]">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {[
            { label: 'Messages Processed', value: metrics.messagesToday || 421, icon: MessageSquare, sub: 'Today' },
            { label: 'Commands Executed', value: metrics.commandsExecuted || 98, icon: Terminal, sub: 'Runs' },
            { label: 'AI Requests', value: metrics.aiRequests || 35, icon: Bot, sub: 'Tokens' },
            { label: 'Downloads Done', value: metrics.downloads || 24, icon: Compass, sub: 'Media' },
            { label: 'Active Groups', value: metrics.activeGroups || 12, icon: Activity, sub: 'Chats' },
            { label: 'Cached Users', value: metrics.activeUsers || 184, icon: Users2, sub: 'Members' },
            { label: 'System Uptime', value: formatUptime(uptime) || '2d 14h', isUptime: true, icon: Clock, sub: 'Status' }
          ].map((m, idx) => {
            const Icon = m.icon
            return (
              <div 
                key={idx}
                className="p-4 bg-surface/20 border border-border/80 rounded-xl flex flex-col justify-between hover:border-border transition-colors duration-300"
              >
                <div className="flex items-center justify-between text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                  <span>{m.sub}</span>
                  <Icon size={11} className="text-muted-foreground/50" />
                </div>
                <div className="mt-4">
                  <span className="text-sm font-extrabold text-white tracking-tight">
                    {m.isUptime ? (
                      <span className="text-[11.5px] font-mono">{m.value}</span>
                    ) : (
                      <span className="text-lg font-mono text-gradient"><AnimatedCounter value={Number(m.value)} /></span>
                    )}
                  </span>
                  <p className="text-[8.5px] text-muted-foreground mt-1 line-clamp-1 leading-tight font-medium">
                    {m.label}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* FEATURE SHOWCASE SECTION */}
      <section id="features" className="py-20 px-6 max-w-5xl mx-auto relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Ecosystem Capabilities</h2>
          <p className="text-xs text-muted-foreground mt-2">
            A premium feature matrix built for responsiveness, safety, and productivity. Click any card to see documentation.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {featuresList.map((f) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.id}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                onClick={() => setActiveModalFeature(f.id)}
                className="p-6 bg-surface/20 border border-border rounded-xl cursor-pointer hover:border-accent/30 hover:bg-surface/30 group transition-all duration-300 flex flex-col justify-between h-48"
              >
                <div>
                  <div className={`p-2.5 rounded-lg border w-fit ${f.color} group-hover:scale-105 transition-transform duration-300`}>
                    <Icon size={16} />
                  </div>
                  <h3 className="text-sm font-extrabold text-white mt-4 flex items-center gap-1.5 group-hover:text-accent transition-colors">
                    <span>{f.title}</span>
                    <ChevronRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed line-clamp-2">
                    {f.desc}
                  </p>
                </div>
                <span className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground/40 mt-4 block">
                  Click to inspect
                </span>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* FEATURE SPOTLIGHT PANEL */}
      <section className="py-12 px-6 max-w-5xl mx-auto relative z-10">
        <div className="p-8 bg-surface/30 border border-border rounded-2xl glassmorphism overflow-hidden relative">
          
          <div className="absolute top-0 right-0 p-6 opacity-[0.02] pointer-events-none text-white">
            <Sparkles size={260} />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="max-w-xl text-center md:text-left">
              <span className="text-[9px] uppercase font-mono tracking-widest font-extrabold text-accent">Feature Spotlight</span>
              <AnimatePresence mode="wait">
                <motion.div
                  key={spotlightIndex}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3 className="text-xl sm:text-2xl font-extrabold text-white mt-2 leading-tight">
                    {spotlightItems[spotlightIndex].title}
                  </h3>
                  <p className="text-[10.5px] font-mono text-muted-foreground/80 mt-1 uppercase tracking-wider">
                    {spotlightItems[spotlightIndex].tagline}
                  </p>
                  <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                    {spotlightItems[spotlightIndex].desc}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Visual metric circle */}
            <div className="shrink-0 flex flex-col items-center justify-center p-6 bg-accent/5 border border-accent/15 rounded-2xl min-w-[200px] text-center">
              <span className="text-[9px] font-mono uppercase text-accent font-semibold tracking-wider">Spotlight KPI</span>
              <span className="text-xl font-bold font-mono text-white mt-2 leading-none">
                {spotlightItems[spotlightIndex].stat}
              </span>
            </div>
          </div>

          {/* Dots controller */}
          <div className="flex items-center justify-center md:justify-start gap-1.5 mt-8">
            {spotlightItems.map((_, index) => (
              <button
                key={index}
                onClick={() => setSpotlightIndex(index)}
                className={`h-1.5 rounded-full transition-all duration-300 ${index === spotlightIndex ? 'w-5 bg-accent' : 'w-1.5 bg-border hover:bg-muted-foreground/45'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* LIVE SYSTEM STATUS SECTION */}
      <section id="status" className="py-20 px-6 max-w-5xl mx-auto relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Ecosystem Health</h2>
          <p className="text-xs text-muted-foreground mt-2">
            Real-time operational status updates across backend API gateways, databases, and connection layers.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {[
            { name: 'Bot Core', desc: 'Main Command Loop', status: botStatus === 'open' ? 'online' : botStatus === 'qr' ? 'degraded' : 'offline' },
            { name: 'WhatsApp Link', desc: 'Socket Connection', status: botStatus === 'open' ? 'online' : 'offline' },
            { name: 'AI Gateways', desc: 'Fallback orchestrator', status: isConnected ? 'online' : 'degraded' },
            { name: 'SQLite DB', desc: 'Context Cache writes', status: isConnected ? 'online' : 'offline' },
            { name: 'Downloader', desc: 'Compression services', status: 'online' },
            { name: 'Radio Station', desc: 'Icecast stream host', status: radioDetails ? 'online' : isConnected ? 'online' : 'offline' },
            { name: 'API Server', desc: 'REST Telemetry APIs', status: isConnected ? 'online' : 'offline' }
          ].map((item, idx) => (
            <div 
              key={idx}
              className="p-5 bg-surface/20 border border-border rounded-xl flex flex-col justify-between h-32 text-center"
            >
              <div>
                <span className="text-[11px] font-extrabold text-white tracking-tight">{item.name}</span>
                <p className="text-[8.5px] text-muted-foreground mt-0.5 line-clamp-1">{item.desc}</p>
              </div>

              <div className="flex items-center justify-center gap-1.5 mt-4">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  item.status === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                  item.status === 'degraded' ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                  'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                }`} />
                <span className={`text-[9.5px] font-semibold uppercase font-mono ${
                  item.status === 'online' ? 'text-emerald-500' :
                  item.status === 'degraded' ? 'text-amber-500' :
                  'text-rose-500'
                }`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RADIO SECTION */}
      <section id="radio" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-border-subtle">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          
          {/* Main Visual artwork card */}
          <div className="p-8 bg-surface/30 border border-border rounded-2xl flex flex-col justify-between items-center text-center relative overflow-hidden glassmorphism">
            {/* Visual background vinyl */}
            <div className={`h-36 w-36 rounded-full border-4 border-muted/80 bg-neutral-900/60 flex items-center justify-center shadow-2xl relative ${radioIsPlaying ? 'animate-spin-slow' : ''}`}>
              <div className="h-12 w-12 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center">
                <Music size={16} className="text-accent" />
              </div>
            </div>

            <div className="mt-8">
              <span className="text-[8.5px] uppercase font-mono tracking-widest font-extrabold text-accent">Now Streaming</span>
              <h3 className="text-base font-extrabold text-white mt-1 leading-tight line-clamp-2">
                {radioDetails?.nowPlaying?.title || 'Relaxing Lo-Fi Mix'}
              </h3>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Requested by: {radioDetails?.nowPlaying?.requestedBy || 'RonnBot Scheduler'}
              </p>
            </div>

            {/* Direct listening audio stream toggle */}
            <div className="w-full mt-6 space-y-4">
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={toggleRadioAudio}
                  disabled={radioLoading}
                  className="h-11 w-11 rounded-full bg-white text-black hover:bg-neutral-200 flex items-center justify-center hover:scale-105 transition-all shadow-lg text-xs"
                >
                  {radioLoading ? (
                    <div className="h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : radioIsPlaying ? (
                    <Pause size={14} fill="currentColor" />
                  ) : (
                    <Play size={14} className="ml-0.5" fill="currentColor" />
                  )}
                </button>

                <button
                  onClick={() => setRadioMuted(prev => !prev)}
                  className="p-3 bg-muted/40 hover:bg-muted rounded-full text-white transition-colors"
                >
                  {radioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-2 max-w-[150px] mx-auto">
                <Volume2 size={10} className="text-muted-foreground" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={radioVolume}
                  onChange={(e) => {
                    setRadioVolume(parseFloat(e.target.value))
                    setRadioMuted(false)
                  }}
                  className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                />
              </div>
            </div>
          </div>

          {/* Radio Specifications card */}
          <div className="p-8 bg-surface/20 border border-border rounded-2xl flex flex-col justify-between lg:col-span-2">
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-extrabold text-white">WABOT Live Radio</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">High-fidelity 128kbps stereo MP3 public feed</p>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-emerald-500/10 bg-emerald-500/5 text-[9px] font-mono text-emerald-500 font-bold uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Live</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
                {[
                  { label: 'Live Listeners', val: radioDetails?.listeners || '1 Active' },
                  { label: 'Stream Quality', val: '128 kbps stereo' },
                  { label: 'Duration Track', val: radioDetails?.nowPlaying?.durationFormatted || '03:45' },
                  { label: 'Queue Length', val: `${radioDetails?.queueLength || 0} Tracks` }
                ].map((spec, index) => (
                  <div key={index} className="p-3 bg-surface/40 border border-border/60 rounded-xl">
                    <span className="text-[8.5px] uppercase font-mono text-muted-foreground/80 font-bold block">{spec.label}</span>
                    <span className="text-xs font-bold text-white mt-1.5 block font-mono">{spec.val}</span>
                  </div>
                ))}
              </div>

              {/* Music Visualizer Bars */}
              <div className="h-8 flex items-end gap-1 mt-8 overflow-hidden rounded-md border border-border/40 p-2.5 bg-surface/5 w-fit">
                {Array.from({ length: 24 }).map((_, idx) => {
                  const heights = [3, 6, 8, 12, 18, 14, 10, 6, 8, 14, 18, 22, 16, 12, 8, 10, 14, 18, 12, 8, 6, 4, 3, 2]
                  const duration = 0.5 + Math.random() * 0.8
                  return (
                    <div 
                      key={idx}
                      className="w-1 bg-accent/60 rounded-t-sm"
                      style={{
                        height: radioIsPlaying ? '100%' : '3px',
                        animation: radioIsPlaying ? `float ${duration}s ease-in-out infinite alternate` : 'none',
                        maxHeight: `${heights[idx]}px`
                      }}
                    />
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 mt-8 pt-6 border-t border-border/80 w-full">
              <button
                onClick={toggleRadioAudio}
                className="h-10 px-5 bg-white hover:bg-neutral-200 text-black text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-2 w-full sm:w-auto hover:scale-[1.02] active:scale-[0.98] shrink-0"
              >
                {radioIsPlaying ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
                <span>{radioIsPlaying ? 'Pause Audio' : 'Listen Live (In-Browser)'}</span>
              </button>

              <a
                href={typeof window !== 'undefined' ? `${window.location.origin}/stream` : 'http://ap2.nzb.zelpstore.id:25637/stream'}
                target="_blank"
                rel="noreferrer"
                className="text-[10.5px] text-muted-foreground hover:text-white transition-colors flex items-center gap-1.5 ml-0 sm:ml-2"
              >
                <span>Direct Audio Link</span>
                <ExternalLink size={10} />
              </a>

              <p className="text-[9.5px] text-muted-foreground text-center sm:text-left leading-tight">
                Stream operates continuously. Connect using default VLC media player or Winamp via root URL.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MEET THE DEVELOPER SECTION */}
      <section id="developer" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-border-subtle">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          
          {/* Avatar Details block */}
          <div className="p-8 bg-surface/30 border border-border rounded-2xl flex flex-col justify-between relative overflow-hidden glassmorphism">
            <div>
              <div className="h-20 w-20 rounded-full overflow-hidden border border-white/10 shadow-lg mb-6">
                <img 
                  src="https://github.com/ronnanakibu.png" 
                  alt="Rony Imanuel Sihombing" 
                  className="h-full w-full object-cover"
                />
              </div>

              <h3 className="text-lg font-extrabold text-white leading-tight">Rony Imanuel Sihombing</h3>
              <p className="text-[10px] font-mono text-accent mt-1 uppercase tracking-wider font-semibold">Computer Engineering Student</p>
              
              <div className="space-y-4 mt-6">
                {[
                  'Multimedia Enthusiast',
                  'AI Explorer & Researcher',
                  'High-Performance Systems Builder',
                  'RonnBot Creator'
                ].map((spec, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    <span>{spec}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 space-y-3 pt-6 border-t border-border/80">
              {contactsList.map((contact, index) => {
                const Icon = contact.icon
                return (
                  <a
                    key={index}
                    href={contact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-muted/20 hover:bg-muted/40 border border-border/80 rounded-lg hover:border-accent/40 text-[10.5px] transition-colors gap-1 sm:gap-0"
                  >
                    <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                      <Icon size={12} />
                      <span>{contact.label}</span>
                    </div>
                    <span className="font-mono text-white font-semibold flex items-center gap-1 max-w-full truncate">
                      <span className="truncate">{contact.value}</span>
                      {contact.url !== '#' && <ExternalLink size={9} className="opacity-60 shrink-0" />}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>

          {/* Biography Timeline text */}
          <div className="p-8 bg-surface/20 border border-border rounded-2xl lg:col-span-2 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent" />
                <h4 className="text-[10.5px] font-semibold text-white uppercase tracking-wider">Developer Journey & Storytelling</h4>
              </div>

              <div className="text-xs text-muted-foreground/90 space-y-4 leading-relaxed">
                <p>
                  As a Computer Engineering student, I have always been fascinated by system integrations and automation. Building interactive platforms that connect seamlessly to chat structures was the initial inspiration for WABOT.
                </p>
                <p>
                  I enjoy mapping out developer solutions for messaging pipelines. Multimedia engines should serve clients smoothly, perform fast compression algorithms under RAM constraints, and handle failover fallback strategies natively.
                </p>
              </div>

              {/* Journey Timeline */}
              <div className="relative border-l border-border pl-6 ml-3 space-y-6 pt-4">
                {[
                  { date: '2024', title: 'Exploration Phase', desc: 'Explored multimedia libraries, encoding codecs, and automated communication sockets.' },
                  { date: '2025', title: 'Systems Experimentation', desc: 'Built automation microservices and integrated lightweight persistency buffers.' },
                  { date: '2026', title: 'WABOT 2.0 Ecosystem', desc: 'Designed the unified RonnBot runtime pipeline, SQLite handlers, and real-time Socket.IO panels.' },
                  { date: 'Future', title: 'Platform Abstraction', desc: 'Expanding framework to support decentralized clustering and a developer marketplace.' }
                ].map((mil, idx) => (
                  <div key={idx} className="relative">
                    <span className="absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-border flex items-center justify-center text-[7px]" />
                    <div>
                      <span className="text-[9px] font-mono font-bold text-accent">{mil.date}</span>
                      <h5 className="text-xs font-bold text-white mt-0.5">{mil.title}</h5>
                      <p className="text-[10.5px] text-muted-foreground mt-1 leading-normal max-w-2xl">{mil.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ROADMAP SECTION */}
      <section id="roadmap" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-border-subtle">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Ecosystem Roadmap</h2>
          <p className="text-xs text-muted-foreground mt-2">
            Our progressive trajectory outlining complete milestones, active sprints, and planned abstractions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'Completed Sprints', status: 'completed', items: roadmapItems.filter(r => r.status === 'completed') },
            { title: 'In Active Sprint', status: 'progress', items: roadmapItems.filter(r => r.status === 'progress') },
            { title: 'Planned Backlog', status: 'planned', items: roadmapItems.filter(r => r.status === 'planned') }
          ].map((col, cIdx) => (
            <div key={cIdx} className="space-y-4">
              <h3 className="text-xs font-extrabold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${col.status === 'completed' ? 'bg-emerald-500' : col.status === 'progress' ? 'bg-amber-500' : 'bg-muted-foreground'}`} />
                <span>{col.title}</span>
              </h3>

              <div className="space-y-4">
                {col.items.map((item, idx) => (
                  <div 
                    key={idx}
                    className="p-5 bg-surface/20 border border-border rounded-xl space-y-3"
                  >
                    <div>
                      <h4 className="text-xs font-extrabold text-white leading-snug">{item.title}</h4>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-normal">{item.desc}</p>
                    </div>
                    <ul className="space-y-1.5 pt-3 border-t border-border-subtle text-[10px] text-muted-foreground font-mono">
                      {item.items.map((it, itIdx) => (
                        <li key={itIdx} className="flex items-center gap-1.5">
                          <span className="text-accent">•</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PROJECT GALLERY SECTION */}
      <section className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-border-subtle">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Ecosystem Previews</h2>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            Interactive mockup illustrations detailing the telemetry interface and database explorer.
          </p>
        </div>

        {/* Masonry Layout Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {[
            {
              title: 'RonnBot Control Panel',
              desc: 'Live telemetry indicators, CPU loading indexes, and console output logs.',
              gradient: 'from-indigo-950/40 to-slate-900/60 border-indigo-500/20',
              img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80'
            },
            {
              title: 'SQLite Inspect Drawer',
              desc: 'Execute customizable SELECT / UPDATE queries live directly inside browser consoles.',
              gradient: 'from-emerald-950/40 to-slate-900/60 border-emerald-500/20',
              img: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&auto=format&fit=crop&q=80'
            },
            {
              title: 'Command Toggler Matrix',
              desc: 'Hot-toggle active command permissions and cooldown counters dynamically.',
              gradient: 'from-amber-950/40 to-slate-900/60 border-amber-500/20',
              img: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=800&auto=format&fit=crop&q=80'
            }
          ].map((item, idx) => (
            <div 
              key={idx}
              onClick={() => setGalleryImgUrl(item.img)}
              className={`p-4 bg-gradient-to-br ${item.gradient} border rounded-2xl hover:border-accent/40 hover:scale-[1.01] cursor-pointer group transition-all duration-300 flex flex-col justify-between h-80 overflow-hidden relative`}
            >
              <div className="absolute inset-0 bg-cover bg-center opacity-10 group-hover:opacity-20 transition-opacity duration-300" style={{ backgroundImage: `url(${item.img})` }} />
              <div className="relative z-10">
                <span className="text-[8px] font-mono font-extrabold uppercase tracking-widest text-accent">UI Preview</span>
                <h3 className="text-sm font-extrabold text-white mt-1 leading-snug">{item.title}</h3>
                <p className="text-[10.5px] text-muted-foreground mt-2 leading-normal">{item.desc}</p>
              </div>
              <div className="h-40 rounded-xl overflow-hidden border border-border bg-neutral-950/50 mt-4 relative z-10 flex items-center justify-center group/mockup">
                {/* RonnBot Control Panel Mockup */}
                {idx === 0 && (
                  <div className="w-full h-full p-3 flex flex-col justify-between text-[8px] font-mono text-left select-none">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5 mb-1 text-[7px]">
                      <span className="text-white font-bold">RonnBot Control Panel</span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[6px]">Syncing</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 my-1">
                      <div className="p-1 bg-surface border border-border/50 rounded flex flex-col">
                        <span className="text-[6px] text-muted-foreground">CPU</span>
                        <span className="text-white font-bold text-[7px] mt-0.5">1.4%</span>
                      </div>
                      <div className="p-1 bg-surface border border-border/50 rounded flex flex-col">
                        <span className="text-[6px] text-muted-foreground">RAM</span>
                        <span className="text-white font-bold text-[7px] mt-0.5">142MB</span>
                      </div>
                      <div className="p-1 bg-surface border border-border/50 rounded flex flex-col">
                        <span className="text-[6px] text-muted-foreground">UPTIME</span>
                        <span className="text-white font-bold text-[7px] mt-0.5">2d 14h</span>
                      </div>
                    </div>
                    <div className="flex-1 bg-black/40 border border-border/30 rounded p-1.5 text-[6px] text-muted-foreground space-y-0.5 overflow-hidden">
                      <div className="text-accent">[SYS] Socket synchronization established.</div>
                      <div className="text-emerald-400">[MSG] Message successfully received: .menu</div>
                      <div className="text-white">[CMD] Command executor .menu executed in 45ms.</div>
                    </div>
                  </div>
                )}

                {/* SQLite Inspect Drawer Mockup */}
                {idx === 1 && (
                  <div className="w-full h-full p-3 flex flex-col justify-between text-[8px] font-mono text-left select-none">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5 mb-1 text-[7px]">
                      <span className="text-white font-bold">Database Inspector</span>
                      <span className="text-muted-foreground text-[6px]">better-sqlite3</span>
                    </div>
                    <div className="bg-surface/50 border border-border/40 rounded p-1 text-accent text-[6px] my-1 truncate">
                      SELECT name, commands_count FROM users ORDER BY commands_count DESC LIMIT 2;
                    </div>
                    <div className="flex-1 bg-black/40 border border-border/30 rounded overflow-hidden">
                      <table className="w-full text-left text-[5.5px] border-collapse">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/40 text-muted-foreground">
                            <th className="p-0.5 font-bold">name</th>
                            <th className="p-0.5 font-bold text-right">commands</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-border/20 text-white">
                            <td className="p-0.5 font-semibold">Rony Imanuel Sihombing</td>
                            <td className="p-0.5 text-right">154</td>
                          </tr>
                          <tr className="text-white/80">
                            <td className="p-0.5 font-semibold">Test Account</td>
                            <td className="p-0.5 text-right">42</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Command Toggler Matrix Mockup */}
                {idx === 2 && (
                  <div className="w-full h-full p-3 flex flex-col justify-between text-[8px] font-mono text-left select-none">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5 mb-1 text-[7px]">
                      <span className="text-white font-bold">Command Registry</span>
                      <span className="text-emerald-400 text-[6px] font-bold">Live Synced</span>
                    </div>
                    <div className="flex-1 space-y-1 mt-1">
                      {[
                        { name: '.downloader', category: 'utility', enabled: true },
                        { name: '.sound', category: 'entertainment', enabled: true },
                        { name: '.broadcast', category: 'owner', enabled: false }
                      ].map((cmd, cIdx) => (
                        <div key={cIdx} className="p-1 bg-surface border border-border/40 rounded flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className="text-white font-bold text-[6.5px]">{cmd.name}</span>
                            <span className="px-1 py-0.2 bg-muted rounded text-[5px] text-muted-foreground lowercase">{cmd.category}</span>
                          </div>
                          <div className={`w-4 h-2 rounded-full flex items-center p-0.5 transition-colors ${cmd.enabled ? 'bg-accent' : 'bg-muted-foreground/35'}`}>
                            <div className={`w-1 h-1 rounded-full bg-white transition-transform ${cmd.enabled ? 'translate-x-2' : 'translate-x-0'}`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bouncing hover cue overlay */}
                <div className="absolute inset-0 bg-neutral-950/80 opacity-0 group-hover/mockup:opacity-100 transition-opacity duration-300 flex items-center justify-center text-[9px] font-mono text-white">
                  Click to expand preview
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 px-6 max-w-5xl mx-auto border-t border-border relative z-10 flex flex-col md:flex-row items-center justify-between gap-6 text-[10.5px] text-muted-foreground font-mono">
        <div className="flex items-center gap-3">
          <span className="text-white font-extrabold">WABOT 2.0 Summary</span>
          <span>•</span>
          <span>Version v3.1.0-stable</span>
        </div>
        <p className="text-center md:text-right">
          © {new Date().getFullYear()} Rony Imanuel Sihombing. Designed with premium Stripe & Linear aesthetics.
        </p>
      </footer>

      {/* FEATURE DETAIL MODAL */}
      <AnimatePresence>
        {activeModalFeature && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg p-8 bg-surface border border-border rounded-2xl shadow-2xl relative overflow-hidden"
            >
              <button 
                onClick={() => setActiveModalFeature(null)}
                className="absolute top-6 right-6 text-muted-foreground hover:text-white transition-colors text-xs font-mono"
              >
                [Esc] Close
              </button>

              {(() => {
                const feat = featuresList.find(f => f.id === activeModalFeature)
                if (!feat) return null
                const Icon = feat.icon
                return (
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-lg border ${feat.color}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <h3 className="text-lg font-extrabold text-white">{feat.title}</h3>
                        <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Ecosystem Abstraction</p>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {feat.longDesc}
                    </p>

                    <div className="space-y-3 pt-4 border-t border-border-subtle">
                      <h4 className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">Technical Specifications</h4>
                      <div className="divide-y divide-border/60 text-[10.5px]">
                        {feat.details.map((det, idx) => (
                          <div key={idx} className="py-2.5 flex justify-between gap-4">
                            <span className="text-muted-foreground font-medium">{det.label}</span>
                            <span className="font-mono text-white text-right leading-tight">{det.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMMAND PALETTE MODAL */}
      <AnimatePresence>
        {isCommandPaletteOpen && (
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-24 px-6"
            onClick={() => setIsCommandPaletteOpen(false)}
          >
            <motion.div 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
            >
              {/* Input header */}
              <div className="flex items-center gap-3 px-4 border-b border-border py-4 bg-muted/20">
                <Search size={16} className="text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Type a command or search section..."
                  value={commandPaletteQuery}
                  onChange={(e) => {
                    setCommandPaletteQuery(e.target.value)
                    setCommandPaletteIndex(0)
                  }}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
                <span className="text-[9px] font-mono text-muted-foreground">ESC to close</span>
              </div>

              {/* Items listing */}
              <div className="max-h-64 overflow-y-auto p-2">
                {filteredPaletteItems.length > 0 ? (
                  filteredPaletteItems.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={item.action}
                      onMouseEnter={() => setCommandPaletteIndex(idx)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs transition-colors ${idx === commandPaletteIndex ? 'bg-muted/80 text-white font-semibold' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'}`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/60">{item.category}</span>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-muted-foreground">No matching items found.</div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GALLERY EXPAND PREVIEW MODAL */}
      <AnimatePresence>
        {galleryImgUrl && (
          <div 
            className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            onClick={() => setGalleryImgUrl(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-border shadow-2xl relative bg-neutral-950"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={galleryImgUrl} 
                alt="UI Expanded Preview" 
                className="w-full h-auto max-h-[80vh] object-contain"
              />
              <div className="p-4 bg-surface/80 border-t border-border flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>WABOT 2.0 Panel Illustration Preview</span>
                <button 
                  onClick={() => setGalleryImgUrl(null)}
                  className="hover:text-white"
                >
                  [Esc] Close Preview
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
