// src/components/pages/Settings.tsx
'use client'
import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Sliders, Shield, Key, Database, Cpu, 
  Sparkles, Radio, Save, RefreshCw, Moon, Eye, EyeOff, RadioTower 
} from 'lucide-react'
import toast from 'react-hot-toast'

export default function Settings() {
  const [activeSection, setActiveSection] = useState<'general' | 'ai' | 'db' | 'security' | 'tunnel'>('general')
  const [showToken, setShowToken] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Settings states
  const [botName, setBotName] = useState('RonnBot v2.0')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [geminiKey, setGeminiKey] = useState('AIzaSyD_EXAMPLE_GEMINI_KEY')
  const [groqKey, setGroqKey] = useState('gsk_EXAMPLE_GROQ_KEY')
  const [moderationThreshold, setModerationThreshold] = useState(0.85)
  const [cfTunnelToken, setCfTunnelToken] = useState('eyJhIjoiZXhhbXBsZV90dW5uZWxfdG9rZW4ifQ==')
  const [accessToken, setAccessToken] = useState('ronnbot-dashboard-secret-2026')
  const [autoCleanMemory, setAutoCleanMemory] = useState(true)

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    const toastId = toast.loading('Saving configuration...')
    
    setTimeout(() => {
      toast.success('Configuration saved successfully!', { id: toastId })
      setIsSaving(false)
    }, 1500)
  }

  const sections = [
    { id: 'general', label: 'General & Bot Engine', icon: Sliders },
    { id: 'ai', label: 'AI API Providers', icon: Sparkles },
    { id: 'db', label: 'Database & Context', icon: Database },
    { id: 'security', label: 'Security & Access', icon: Shield },
    { id: 'tunnel', label: 'Cloudflare Tunnel', icon: RadioTower }
  ] as const

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-10">
      {/* Settings Navigation Sidebar */}
      <div className="w-full lg:w-64 shrink-0 flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-3 lg:pb-0 border-b lg:border-b-0 lg:border-r border-border/60 pr-0 lg:pr-4">
        {sections.map(sec => {
          const Icon = sec.icon
          const isActive = activeSection === sec.id
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`h-10 px-4 rounded-lg flex items-center gap-3 text-xs font-medium whitespace-nowrap transition-all ${
                isActive 
                  ? 'bg-white text-black font-semibold' 
                  : 'text-muted-foreground hover:text-white hover:bg-surface/10'
              }`}
            >
              <Icon size={14} />
              {sec.label}
            </button>
          )
        })}
      </div>

      {/* Settings Form Content */}
      <div className="flex-1 min-w-0">
        <form onSubmit={handleSave} className="space-y-8 max-w-2xl">
          <AnimatePresence mode="wait">
            {activeSection === 'general' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">General & Bot Engine</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Configure core engine properties and runtime metadata.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Bot Identity Name</label>
                    <input
                      type="text"
                      value={botName}
                      onChange={e => setBotName(e.target.value)}
                      className="w-full h-10 px-3 bg-surface/30 border border-border/80 rounded-lg text-xs text-white placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Timezone Offset</label>
                    <select
                      value={timezone}
                      onChange={e => setTimezone(e.target.value)}
                      className="w-full h-10 px-3 bg-surface/30 border border-border/80 rounded-lg text-xs text-white outline-none focus:border-accent transition-colors"
                    >
                      <option value="Asia/Jakarta">Asia/Jakarta (GMT+7)</option>
                      <option value="Asia/Makassar">Asia/Makassar (GMT+8)</option>
                      <option value="Asia/Jayapura">Asia/Jayapura (GMT+9)</option>
                      <option value="UTC">UTC (GMT+0)</option>
                    </select>
                  </div>

                  <div className="p-4 bg-surface/10 border border-border rounded-lg flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-semibold text-white">Enable Radio Server Stream</h5>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Allow web clients to stream `/stream` background audios.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" defaultChecked className="sr-only peer" />
                      <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'ai' && (
              <motion.div
                key="ai"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">AI API Providers</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Setup API authentication tokens for LLM fallbacks.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Gemini API Key</label>
                    <div className="relative">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={geminiKey}
                        onChange={e => setGeminiKey(e.target.value)}
                        className="w-full h-10 pl-3 pr-10 bg-surface/30 border border-border/80 rounded-lg text-xs text-white font-mono placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute inset-y-0 right-3 flex items-center text-muted-foreground/60 hover:text-white"
                      >
                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Groq API Key</label>
                    <input
                      type="password"
                      value={groqKey}
                      onChange={e => setGroqKey(e.target.value)}
                      className="w-full h-10 px-3 bg-surface/30 border border-border/80 rounded-lg text-xs text-white font-mono placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-[10px] font-mono text-muted-foreground uppercase">AI Moderation Sensitivity Threshold</label>
                      <span className="text-[10px] font-mono text-white">{(moderationThreshold * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="0.99"
                      step="0.05"
                      value={moderationThreshold}
                      onChange={e => setModerationThreshold(parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'db' && (
              <motion.div
                key="db"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">Database & Memory Context</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Manage better-sqlite3 database files and session context sizes.</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-surface/10 border border-border rounded-lg flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-semibold text-white">Auto Clean Memory Context</h5>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Erase chat histories older than 3 days automatically.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCleanMemory}
                        onChange={e => setAutoCleanMemory(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  <div className="p-5 border border-border/80 rounded-xl bg-surface/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h5 className="text-xs font-semibold text-white">Prune Database Cache</h5>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Wipe downloaded files logs history but keep users data.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        toast.success('Database cache pruned (0.2 MB freed)')
                      }}
                      className="h-8 px-3 border border-red-500/20 hover:border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-semibold rounded-lg transition-colors"
                    >
                      Clear Logs Cache
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'security' && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">Security & Access Tokens</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Manage auth tokens required to sign into the dashboard.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">RonnBot Web Access Token</label>
                    <div className="relative">
                      <input
                        type={showToken ? "text" : "password"}
                        value={accessToken}
                        onChange={e => setAccessToken(e.target.value)}
                        className="w-full h-10 pl-3 pr-10 bg-surface/30 border border-border/80 rounded-lg text-xs text-white font-mono placeholder:text-muted-foreground outline-none focus:border-accent transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute inset-y-0 right-3 flex items-center text-muted-foreground/60 hover:text-white"
                      >
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'tunnel' && (
              <motion.div
                key="tunnel"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">Cloudflare Tunnel Integration</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Setup remote tunnel token settings for zero-trust public access.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Cloudflare Tunnel Token</label>
                    <textarea
                      rows={4}
                      value={cfTunnelToken}
                      onChange={e => setCfTunnelToken(e.target.value)}
                      className="w-full p-3 bg-surface/30 border border-border/80 rounded-lg text-xs text-white font-mono placeholder:text-muted-foreground outline-none focus:border-accent transition-colors resize-none"
                    />
                  </div>

                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-3">
                    <RadioTower className="text-emerald-400 shrink-0 mt-0.5" size={14} />
                    <div className="text-[10px] text-emerald-400/90 leading-relaxed">
                      <strong>Tunnel Active:</strong> Your bot server is currently listening on port 25637. Traffic routed via <code className="bg-emerald-950/40 px-1 py-0.5 rounded font-mono text-white">ronnbot.zelpstore.id</code> is securely decrypted.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Footer */}
          <div className="pt-6 border-t border-border/60 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="h-9 px-4 bg-white hover:bg-neutral-200 text-black disabled:bg-neutral-800 disabled:text-neutral-500 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

