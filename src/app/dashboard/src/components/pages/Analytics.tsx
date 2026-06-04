// src/components/pages/Analytics.tsx
'use client'
import React from 'react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, Cell, PieChart, Pie, Legend } from 'recharts'
import { useDashboardStore } from '../../store/dashboard'

export default function Analytics() {
  const { analytics } = useDashboardStore()

  // Chart 1: Messages density
  const hourlyData = analytics.hourlyMessageVolume.map((vol, index) => ({
    hour: `${index}:00`,
    Messages: vol
  }))

  // Chart 2: Command usage
  const commandData = analytics.commandUsage.length > 0 ? analytics.commandUsage : [
    { name: 'help', count: 12 },
    { name: 'cuaca', count: 8 },
    { name: 'sticker', count: 6 },
    { name: 'ai', count: 5 }
  ]

  // Chart 3: AI Calls
  const aiData = analytics.aiCalls.length > 0 ? analytics.aiCalls : [
    { provider: 'Nvidia', count: 18 },
    { provider: 'Groq', count: 12 },
    { provider: 'Gemini', count: 5 }
  ]

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899']

  return (
    <div className="space-y-8 pb-10">
      {/* Messages per hour distribution */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white">Hourly Message Density</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Average incoming messages throughout the day</p>
        </div>
        <div className="h-60 w-full mt-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorHourly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(99, 102, 241)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="rgb(99, 102, 241)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <YAxis stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
              <Tooltip 
                contentStyle={{ background: 'hsl(var(--surface-elevated))', border: '1px solid hsl(var(--border))' }}
                labelStyle={{ fontSize: '10px', color: 'hsl(var(--foreground))', fontFamily: 'JetBrains Mono' }}
              />
              <Area type="monotone" dataKey="Messages" stroke="rgb(99, 102, 241)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorHourly)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Grid for command usage & AI calls distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Commands usage chart */}
        <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
          <div>
            <h3 className="text-sm font-semibold text-white">Most Executed Commands</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Top command names by hit counts</p>
          </div>
          <div className="h-56 w-full mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commandData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
                <YAxis stroke="hsl(var(--muted-foreground)/0.4)" fontSize={9} fontFamily="JetBrains Mono" />
                <Tooltip 
                  contentStyle={{ background: 'hsl(var(--surface-elevated))', border: '1px solid hsl(var(--border))' }}
                  labelStyle={{ fontSize: '10px', color: 'hsl(var(--foreground))', fontFamily: 'JetBrains Mono' }}
                />
                <Bar dataKey="count" fill="rgb(99, 102, 241)" radius={[4, 4, 0, 0]}>
                  {commandData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Provider calls chart */}
        <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
          <div>
            <h3 className="text-sm font-semibold text-white">AI Provider Share</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">Calls split between AI providers</p>
          </div>
          <div className="h-56 w-full mt-6 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={aiData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey="provider"
                >
                  {aiData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: 'hsl(var(--surface-elevated))', border: '1px solid hsl(var(--border))' }}
                  itemStyle={{ fontSize: '11px', fontFamily: 'JetBrains Mono' }}
                />
                <Legend 
                  verticalAlign="bottom" 
                  height={36} 
                  iconType="circle" 
                  formatter={(value) => <span className="text-[11px] text-muted-foreground">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
