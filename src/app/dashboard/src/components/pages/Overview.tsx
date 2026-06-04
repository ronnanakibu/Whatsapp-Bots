// src/components/pages/Overview.tsx
'use client'
import React from 'react'
import { motion } from 'framer-motion'
import { 
  MessageSquare, Terminal, Bot, Users2, Activity, Cpu, Database, 
  Clock, ShieldAlert, Compass 
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useDashboardStore } from '../../store/dashboard'

export default function Overview() {
  const { metrics, uptime, analytics, botStatus } = useDashboardStore()

  // Format uptime (seconds -> days h m s)
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

  // Convert array of message volume to chart data
  const chartData = analytics.hourlyMessageVolume.map((vol, index) => ({
    hour: `${index}:00`,
    Messages: vol
  }))

  const statCards = [
    { label: 'Messages Today', value: metrics.messagesToday, icon: MessageSquare, desc: 'Incoming message count' },
    { label: 'Commands Run', value: metrics.commandsExecuted, icon: Terminal, desc: 'Successful command executions' },
    { label: 'AI Requests', value: metrics.aiRequests, icon: Bot, desc: 'AI chats processed' },
    { label: 'Downloads today', value: metrics.downloads, icon: Compass, desc: 'Media downloads completed' },
    { label: 'Active Users', value: metrics.activeUsers, icon: Users2, desc: 'Cached WhatsApp user counts' },
    { label: 'Active Groups', value: metrics.activeGroups, icon: Activity, desc: 'WhatsApp groups cached' },
  ]

  return (
    <div className="space-y-8 pb-10">
      {/* Upper Status row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Connection status card */}
        <div className="p-6 bg-surface/30 border border-border rounded-xl glassmorphism flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg text-accent">
              <Activity size={20} className="animate-pulse-soft" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Bot Engine Status</p>
              <h2 className="text-lg font-bold text-white mt-0.5 capitalize">{botStatus === 'open' ? '🟢 Online' : botStatus === 'qr' ? 'Pairing Required' : '🔴 Offline'}</h2>
            </div>
          </div>
        </div>

        {/* Uptime card */}
        <div className="p-6 bg-surface/30 border border-border rounded-xl glassmorphism flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-500">
              <Clock size={20} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">System Uptime</p>
              <h2 className="text-sm font-bold text-white font-mono mt-0.5">{formatUptime(uptime)}</h2>
            </div>
          </div>
        </div>

        {/* Server load card */}
        <div className="p-6 bg-surface/30 border border-border rounded-xl glassmorphism flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500">
              <Cpu size={20} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Server CPU / RAM</p>
              <h2 className="text-sm font-bold text-white font-mono mt-0.5">
                {metrics.cpuUsage.toFixed(1)}% / {((metrics.memoryUsage / 1024 / 1024)).toFixed(0)} MB
              </h2>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of counter statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-6">
        {statCards.map((stat, i) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 bg-surface/20 border border-border/80 rounded-xl hover:border-border/100 hover:bg-surface/30 transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground/80">{stat.label}</span>
                <Icon size={14} className="text-muted-foreground/60" />
              </div>
              <div className="mt-4">
                <span className="text-xl font-bold font-mono text-white text-gradient">{stat.value}</span>
                <p className="text-[9px] text-muted-foreground/75 mt-0.5">{stat.desc}</p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Real-time Message Volume Area Chart */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Message Volume (24h)</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Real-time incoming message traffic distribution density</p>
          </div>
        </div>
        
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMessages" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(99, 102, 241)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="rgb(99, 102, 241)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <YAxis stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <Tooltip 
                contentStyle={{ background: 'hsl(var(--surface-elevated))', border: '1px solid hsl(var(--border))' }}
                labelStyle={{ fontSize: '10px', color: 'hsl(var(--foreground))', fontFamily: 'JetBrains Mono' }}
                itemStyle={{ fontSize: '11px', color: 'rgb(99, 102, 241)', fontFamily: 'JetBrains Mono' }}
              />
              <Area type="monotone" dataKey="Messages" stroke="rgb(99, 102, 241)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorMessages)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
