// src/components/pages/Downloader.tsx
'use client'
import React from 'react'
import { Download, Youtube, Music, Film, Layers, HardDrive } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import { useDashboardStore } from '../../store/dashboard'

export default function Downloader() {
  const { metrics } = useDashboardStore()

  const platformData = [
    { name: 'TikTok', count: 18, color: '#ec4899' },
    { name: 'YouTube', count: 14, color: '#ef4444' },
    { name: 'Instagram', count: 10, color: '#d946ef' },
    { name: 'Spotify', count: 8, color: '#10b981' },
    { name: 'Facebook', count: 4, color: '#3b82f6' }
  ]

  const stats = [
    { label: 'Downloads Today', value: metrics.downloads, icon: Download },
    { label: 'Est. Bandwidth', value: '1.2 GB', icon: HardDrive },
    { label: 'Success Rate', value: '98%', icon: Layers }
  ]

  return (
    <div className="space-y-8 pb-10">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white font-mono">Downloader Ecosystem</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Track media downloader hit distributions and estimated bandwidth usage</p>
      </div>

      {/* Stats indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="p-6 bg-surface/20 border border-border rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg text-accent">
                  <Icon size={20} />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">{stat.label}</p>
                  <h2 className="text-sm font-bold text-white font-mono mt-0.5">{stat.value}</h2>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Downloader Chart */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <h3 className="text-sm font-semibold text-white">Platform Usage Share</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Visual representation of download operations per site</p>

        <div className="h-60 w-full mt-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={platformData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <YAxis stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <Tooltip 
                contentStyle={{ background: 'hsl(var(--surface-elevated))', border: '1px solid hsl(var(--border))' }}
                labelStyle={{ fontSize: '10px', color: 'hsl(var(--foreground))', fontFamily: 'JetBrains Mono' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {platformData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
