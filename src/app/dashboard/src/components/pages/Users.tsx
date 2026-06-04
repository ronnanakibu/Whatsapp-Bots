// src/components/pages/Users.tsx
'use client'
import React, { useState } from 'react'
import { Search, ShieldAlert, Award, Star, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDashboardStore } from '../../store/dashboard'

interface UsersProps {
  emit: (event: string, data?: any) => void
}

export default function Users({ emit }: UsersProps) {
  const { usersList } = useDashboardStore()
  const [search, setSearch] = useState('')

  // Mock list if empty
  const users = usersList.length > 0 ? usersList : [
    { jid: '6285172013920@s.whatsapp.net', name: 'Ronn Anakibu', commandsCount: 154, warnings: 0, lastSeen: 'Just now' },
    { jid: '628222222222@s.whatsapp.net', name: 'Testing Account', commandsCount: 42, warnings: 2, lastSeen: '30 mins ago' },
    { jid: '628333333333@s.whatsapp.net', name: 'Spammy User', commandsCount: 12, warnings: 1, lastSeen: '2 hours ago' }
  ]

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.jid.toLowerCase().includes(search.toLowerCase())
  )

  // Sort by commandsCount from highest to lowest
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aCount = a.commandsCount ?? a.xp ?? 0
    const bCount = b.commandsCount ?? b.xp ?? 0
    return bCount - aCount
  })

  const handleResetWarnings = (jid: string) => {
    emit('user:reset_warnings', { jid })
    toast.success(`Warnings reset for: ${users.find(u => u.jid === jid)?.name}`)
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono">User Directory</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">View active users, command execution counts, and warning limits</p>
        </div>

        {/* Search Input bar */}
        <div className="flex items-center gap-3 w-full sm:max-w-xs bg-muted/40 border border-border/80 rounded-lg px-3 py-2">
          <Search size={14} className="text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="border border-border/80 bg-surface/10 rounded-xl glassmorphism overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border/60 text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 font-mono">
          <div className="col-span-3">User Profile</div>
          <div className="col-span-4">JID Identifier</div>
          <div className="col-span-2">Used Commands</div>
          <div className="col-span-2">Warnings</div>
          <div className="col-span-1 text-right">Action</div>
        </div>

        {/* List Content */}
        <div className="divide-y divide-border/30 font-mono text-xs">
          {sortedUsers.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground/80 font-sans">
              No users matching search.
            </div>
          ) : (
            sortedUsers.map((user) => (
              <div 
                key={user.jid}
                className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/10 transition-colors"
              >
                {/* User Profile name */}
                <div className="col-span-3 font-sans text-white font-semibold truncate">
                  {user.name}
                </div>

                {/* JID Identifier */}
                <div className="col-span-4 text-muted-foreground truncate">
                  {user.jid}
                </div>

                {/* Used Commands */}
                <div className="col-span-2 flex items-center gap-1.5 font-sans">
                  <Award size={13} className="text-amber-500" />
                  <span className="text-white font-bold">{user.commandsCount ?? user.xp ?? 0} runs</span>
                </div>

                {/* Warnings count badge */}
                <div className="col-span-2 flex items-center gap-2">
                  <ShieldAlert size={13} className={user.warnings > 0 ? "text-rose-500 animate-pulse-soft" : "text-muted-foreground/50"} />
                  <span className={user.warnings > 0 ? "text-rose-500 font-bold" : "text-muted-foreground"}>
                    {user.warnings}
                  </span>
                </div>

                {/* Action button */}
                <div className="col-span-1 text-right">
                  {user.warnings > 0 && (
                    <button
                      onClick={() => handleResetWarnings(user.jid)}
                      className="p-1.5 hover:bg-muted border border-border/80 hover:border-border text-muted-foreground hover:text-white rounded-lg transition-colors inline-flex"
                      title="Reset Warnings"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
