// src/components/pages/Deployments.tsx
'use client'
import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  GitBranch, GitCommit, Play, CheckCircle2, XCircle, AlertCircle, 
  Clock, Server, RefreshCw, ChevronRight, Terminal, Cpu 
} from 'lucide-react'
import toast from 'react-hot-toast'

interface DeploymentItem {
  id: string
  commitHash: string
  commitMessage: string
  branch: string
  status: 'success' | 'failed' | 'building' | 'queued'
  duration: string
  timestamp: string
  environment: string
  deployedBy: string
}

export default function Deployments() {
  const [isDeploying, setIsDeploying] = useState(false)

  // Dummy list representing deployments, matches git log and sftp syncs
  const [deployments, setDeployments] = useState<DeploymentItem[]>([
    {
      id: 'dep_1',
      commitHash: '8b3c9df',
      commitMessage: 'feat: add nvidia and groq ai provider models with priority failover support',
      branch: 'main',
      status: 'success',
      duration: '42s',
      timestamp: '2 hours ago',
      environment: 'Production (Pterodactyl)',
      deployedBy: 'Ronn'
    },
    {
      id: 'dep_2',
      commitHash: 'a5d12ef',
      commitMessage: 'fix: resolve socket memory leakage in baileys event handler',
      branch: 'main',
      status: 'success',
      duration: '35s',
      timestamp: '1 day ago',
      environment: 'Production (Pterodactyl)',
      deployedBy: 'Ronn'
    },
    {
      id: 'dep_3',
      commitHash: 'fd231bc',
      commitMessage: 'refactor: integrate sqlite better-sqlite3 database context cache',
      branch: 'main',
      status: 'success',
      duration: '51s',
      timestamp: '3 days ago',
      environment: 'Production (Pterodactyl)',
      deployedBy: 'Ronn'
    },
    {
      id: 'dep_4',
      commitHash: '9c2e10a',
      commitMessage: 'ci: test dashboard static compilation setup configs',
      branch: 'main',
      status: 'failed',
      duration: '18s',
      timestamp: '4 days ago',
      environment: 'Production (Pterodactyl)',
      deployedBy: 'Ronn'
    }
  ])

  const triggerDeploy = () => {
    setIsDeploying(true)
    const toastId = toast.loading('Initiating delta deployment sync...')
    
    // Simulating deployment trigger (which runs deploy.js sftp push)
    setTimeout(() => {
      toast.success('SFTP sync finished! Restarting Pterodactyl container...', { id: toastId })
      
      const newDep: DeploymentItem = {
        id: `dep_${Date.now()}`,
        commitHash: Math.random().toString(16).substring(2, 9),
        commitMessage: 'manual deploy: triggered from BotOS web panel',
        branch: 'main',
        status: 'success',
        duration: '29s',
        timestamp: 'Just now',
        environment: 'Production (Pterodactyl)',
        deployedBy: 'Ronn (BotOS)'
      }
      setDeployments(prev => [newDep, ...prev])
      setIsDeploying(false)
    }, 4000)
  }

  const getStatusColor = (status: DeploymentItem['status']) => {
    switch (status) {
      case 'success': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      case 'failed': return 'text-rose-400 bg-rose-500/10 border-rose-500/20'
      case 'building': return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      default: return 'text-muted-foreground bg-muted/20 border-border/40'
    }
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white">Production Deployments</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Monitor SFTP delta synchronization and Pterodactyl application state
          </p>
        </div>
        <button
          onClick={triggerDeploy}
          disabled={isDeploying}
          className="h-9 px-4 bg-white hover:bg-neutral-200 text-black disabled:bg-neutral-800 disabled:text-neutral-500 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
        >
          {isDeploying ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Play size={14} fill="black" />
          )}
          Trigger Manual Sync
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Avg Build Duration', value: '39 seconds', icon: Clock, desc: 'Delta SSH/SFTP transmission time' },
          { label: 'Deployment Success', value: '94.2%', icon: CheckCircle2, desc: 'Past 30 deployment executions' },
          { label: 'Pterodactyl Status', value: 'Active', icon: Server, desc: 'Container port 25637 listening' },
          { label: 'Active Branch', value: 'main', icon: GitBranch, desc: 'Synchronized with remote origin' },
        ].map((metric, i) => {
          const Icon = metric.icon
          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-5 bg-surface/20 border border-border/80 rounded-xl hover:border-border/100 hover:bg-surface/30 transition-all flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground/85">{metric.label}</span>
                <Icon size={14} className="text-muted-foreground/50" />
              </div>
              <div className="mt-4">
                <span className="text-base font-bold font-mono text-white">{metric.value}</span>
                <p className="text-[9px] text-muted-foreground/75 mt-0.5">{metric.desc}</p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Main Deployment Log / Timeline */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism space-y-6">
        <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Deployment Pipeline History</h4>
        
        <div className="space-y-4">
          {deployments.map((dep, index) => {
            const isSuccess = dep.status === 'success'
            const isFailed = dep.status === 'failed'
            const isBuilding = dep.status === 'building'

            return (
              <motion.div
                key={dep.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="group relative flex items-start gap-4 p-4 bg-surface/10 hover:bg-surface/20 border border-border/60 hover:border-border rounded-lg transition-all"
              >
                {/* Status Indicator Badge */}
                <div className={`p-2 rounded-lg border ${getStatusColor(dep.status)} flex items-center justify-center shrink-0`}>
                  {isSuccess && <CheckCircle2 size={16} />}
                  {isFailed && <XCircle size={16} />}
                  {isBuilding && <RefreshCw size={16} className="animate-spin" />}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white font-mono">{dep.commitHash}</span>
                      <span className="text-[10px] text-muted-foreground">•</span>
                      <span className="text-xs text-white truncate max-w-lg font-medium">{dep.commitMessage}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{dep.timestamp}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch size={10} />
                      {dep.branch}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Build time: {dep.duration}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Server size={10} />
                      {dep.environment}
                    </span>
                    <span>•</span>
                    <span>Deployed by: <strong className="text-white/80">{dep.deployedBy}</strong></span>
                  </div>
                </div>

                <div className="hidden sm:flex items-center self-center pl-2">
                  <ChevronRight size={14} className="text-muted-foreground/45 group-hover:text-white transition-colors" />
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Changelog section preview */}
      <div className="p-6 bg-surface/20 border border-border rounded-xl glassmorphism">
        <div className="flex items-center gap-2 mb-4">
          <Terminal size={16} className="text-accent" />
          <h4 className="text-xs font-semibold text-white uppercase tracking-wider">Local Changelogs Logs</h4>
        </div>
        <p className="text-[10px] text-muted-foreground mb-4">
          Release tag changelogs stored in <code className="font-mono text-white/85">./changelogs/</code>.
        </p>
        <div className="bg-muted/40 border border-border/80 rounded-lg p-4 font-mono text-[11px] text-muted-foreground space-y-2 leading-relaxed">
          <p className="text-white font-semibold"># Release v2.0.0 - Premium BotOS Dashboard Integration</p>
          <p className="text-emerald-400/90">+ Added complete Next.js 15 Dark-First real-time WebSocket dashboard dashboard panels</p>
          <p className="text-emerald-400/90">+ Migrated system core HTTP radio server to unified Express & Socket.IO server</p>
          <p className="text-emerald-400/90">+ Designed dynamic provider AI priority configuration fallback engine</p>
          <p className="text-emerald-400/90">+ Integrated SQLite db context buffer memories</p>
          <p className="text-emerald-400/90">+ Implemented Ctrl+K Command Palette search bar portal</p>
        </div>
      </div>
    </div>
  )
}
