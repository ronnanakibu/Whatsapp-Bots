// src/components/pages/Groups.tsx
'use client'
import React, { useState } from 'react'
import { Megaphone, Users, Shield, Bot, Send, LogOut, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

interface GroupsProps {
  emit: (event: string, data?: any) => void
}

export default function Groups({ emit }: GroupsProps) {
  const { groupsList, setGroupsList } = useDashboardStore()
  const [broadcastTarget, setBroadcastTarget] = useState<string | null>(null)
  const [broadcastText, setBroadcastText] = useState('')
  const [leaveTarget, setLeaveTarget] = useState<{ chatId: string; name: string } | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)

  // Mock list if empty
  const groups = groupsList.length > 0 ? groupsList : [
    { chatId: '120363212345678@g.us', name: 'Developer Community', desc: 'Official group for backend development and bot OS updates.', members: 45, aiEnabled: true, moderationEnabled: true, avatarUrl: '' },
    { chatId: '120363298765432@g.us', name: 'Internal BOTS Testing', desc: 'Testing channel for new Baileys plugins and APIs.', members: 12, aiEnabled: true, moderationEnabled: false, avatarUrl: '' },
    { chatId: '120363255443322@g.us', name: 'Random Chat Area', desc: 'General lounge for group discussions and community announcements.', members: 120, aiEnabled: false, moderationEnabled: true, avatarUrl: '' }
  ]

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastTarget || !broadcastText.trim()) return

    emit('group:broadcast', { chatId: broadcastTarget, text: broadcastText })
    toast.success(`Broadcast message sent to: ${groups.find(g => g.chatId === broadcastTarget)?.name}`)
    setBroadcastTarget(null)
    setBroadcastText('')
  }

  const handleToggleAi = (chatId: string, current: boolean) => {
    emit('group:toggle_ai', { chatId, enabled: !current })
    toast.success(`AI configuration updated`)
  }

  const handleToggleMod = (chatId: string, current: boolean) => {
    emit('group:toggle_moderation', { chatId, enabled: !current })
    toast.success(`Moderation configuration updated`)
  }

  const handleLeaveGroup = () => {
    if (!leaveTarget) return
    setIsLeaving(true)

    emit('group:leave', { chatId: leaveTarget.chatId })
    toast.success(`Bot berhasil keluar dari grup "${leaveTarget.name}"`)

    // Optimistic UI update: hapus grup dari tampilan lokal dashboard
    if (groupsList.length > 0) {
      setGroupsList(groupsList.filter(g => g.chatId !== leaveTarget.chatId))
    }

    setLeaveTarget(null)
    setIsLeaving(false)
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white font-mono">Groups Management</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Control bot capabilities, broadcast messages, or leave active groups</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map((group) => (
          <div key={group.chatId} className="p-5 bg-surface/20 border border-border rounded-xl flex flex-col justify-between min-h-[190px]">
            <div className="flex gap-3 items-start overflow-hidden">
              {/* Group Avatar / Icon */}
              <div className="h-10 w-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0 font-bold text-xs">
                {group.avatarUrl ? (
                  <img src={group.avatarUrl} alt={group.name} className="h-full w-full object-cover rounded-lg" />
                ) : (
                  group.name.slice(0, 2).toUpperCase()
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2">
                  <h4 className="text-xs font-bold text-white truncate" title={group.name}>{group.name}</h4>
                  <span className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/80 bg-muted/40 border border-border/30 px-1.5 py-0.5 rounded shrink-0">
                    <Users size={10} />
                    <span>{group.members}</span>
                  </span>
                </div>
                {/* Description - line clamp to prevent leakage */}
                <p className="text-[10px] text-muted-foreground/60 mt-1.5 line-clamp-2 break-words leading-relaxed" title={group.desc}>
                  {group.desc || 'No group description available.'}
                </p>
                <p className="text-[9px] text-muted-foreground/30 font-mono mt-1 truncate">{group.chatId}</p>
              </div>
            </div>

            {/* Actions & Toggles Toolbar */}
            <div className="flex items-center justify-between mt-4 border-t border-border/40 pt-3 gap-2">
              <div className="flex items-center gap-2">
                {/* AI Toggle */}
                <button 
                  onClick={() => handleToggleAi(group.chatId, group.aiEnabled)}
                  className={cn(
                    "p-2 rounded-lg border flex items-center justify-center transition-colors",
                    group.aiEnabled ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted border-border text-muted-foreground"
                  )}
                  title={group.aiEnabled ? "Disable AI Chat" : "Enable AI Chat"}
                >
                  <Bot size={14} />
                </button>

                {/* Moderation Toggle */}
                <button 
                  onClick={() => handleToggleMod(group.chatId, group.moderationEnabled)}
                  className={cn(
                    "p-2 rounded-lg border flex items-center justify-center transition-colors",
                    group.moderationEnabled ? "bg-blue-500/10 border-blue-500/20 text-blue-500" : "bg-muted border-border text-muted-foreground"
                  )}
                  title={group.moderationEnabled ? "Disable AI Moderator" : "Enable AI Moderator"}
                >
                  <Shield size={14} />
                </button>
              </div>

              {/* Action Buttons: Broadcast & Leave */}
              <div className="flex items-center gap-1.5">
                {/* Broadcast button */}
                <button 
                  onClick={() => setBroadcastTarget(group.chatId)}
                  className="px-2.5 py-1.5 bg-muted/50 border border-border hover:bg-muted text-[10px] font-semibold text-white rounded-lg transition-colors flex items-center gap-1.5"
                  title="Broadcast pesan ke grup ini"
                >
                  <Megaphone size={11} />
                  <span>Broadcast</span>
                </button>

                {/* Leave Group Button */}
                <button 
                  onClick={() => setLeaveTarget({ chatId: group.chatId, name: group.name })}
                  className="px-2.5 py-1.5 bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 text-[10px] font-semibold rounded-lg transition-all flex items-center gap-1.5 group/leave"
                  title="Keluarkan bot dari grup ini"
                >
                  <LogOut size={11} className="group-hover/leave:-translate-x-0.5 transition-transform" />
                  <span>Keluar</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Broadcast Modal Form Overlay */}
      {broadcastTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-surface border border-border rounded-xl shadow-2xl overflow-hidden glassmorphism p-6 animate-scale-in">
            <h4 className="text-xs font-bold text-white mb-2">Broadcast Message</h4>
            <p className="text-[10px] text-muted-foreground mb-4">
              Sending to: *{groups.find(g => g.chatId === broadcastTarget)?.name}*
            </p>

            <form onSubmit={handleBroadcast} className="space-y-4">
              <textarea
                placeholder="Type your message..."
                value={broadcastText}
                onChange={e => setBroadcastText(e.target.value)}
                className="w-full h-24 p-3 bg-muted/40 border border-border/80 rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors resize-none"
                required
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setBroadcastTarget(null)}
                  className="px-4 py-2 bg-muted/40 border border-border hover:bg-muted text-xs font-semibold rounded-lg text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-2"
                >
                  <Send size={11} />
                  <span>Send</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leave Group Confirmation Modal */}
      {leaveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-surface border border-rose-500/30 rounded-xl shadow-2xl overflow-hidden glassmorphism p-6 animate-scale-in">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <LogOut size={20} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white">Keluar dari Grup?</h4>
                <p className="text-[10px] text-muted-foreground font-mono">Tindakan ini permanen</p>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/90 mb-2 leading-relaxed">
              Apakah Anda yakin ingin mengeluarkan bot dari grup <strong className="text-white font-semibold">"{leaveTarget.name}"</strong>?
            </p>
            <p className="text-[10px] text-rose-400/80 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 mb-5 flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>Bot akan otomatis meninggalkan grup ini dan tidak dapat menerima atau mengirim pesan sampai diundang kembali oleh admin grup.</span>
            </p>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isLeaving}
                onClick={() => setLeaveTarget(null)}
                className="px-3.5 py-1.5 bg-muted/40 border border-border hover:bg-muted text-xs font-semibold rounded-lg text-white transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isLeaving}
                onClick={handleLeaveGroup}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-lg shadow-rose-900/30"
              >
                <LogOut size={12} />
                <span>{isLeaving ? 'Mengeluarkan Bot...' : 'Ya, Keluar Grup'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
