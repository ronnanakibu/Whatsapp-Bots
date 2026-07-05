// src/app/music/page.tsx
'use client'
import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ArrowLeft, ToggleLeft, ToggleRight, Sparkles, Youtube,
    CheckCircle2, AlertCircle, Loader2, Music, Terminal,
    Video, Image, FileText, Settings, Play, ShieldAlert,
    ExternalLink, Copy, Check, UploadCloud, Radio, Headset
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useSocket } from '../../hooks/useSocket'

interface SunoJob {
    id: string
    prompt: string
    title: string
    status: 'running' | 'completed' | 'failed'
    stage: 'idle' | 'ai_enhance' | 'suno_gen' | 'gemini_meta' | 'img_gen' | 'downloading' | 'ffmpeg' | 'youtube_upload' | 'done' | 'failed'
    progress: number
    logs: string[]
    youtubeUrl: string | null
    source: string
    timestamp: number
}

const STAGES_CONFIG = [
    { id: 'ai_enhance', label: 'AI Prompt Enhancer', icon: Sparkles, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
    { id: 'suno_gen', label: 'Audio Generation', icon: Music, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
    { id: 'gemini_meta', label: 'Gemini Metadata', icon: FileText, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { id: 'img_gen', label: 'Thumbnail Art Design', icon: Image, color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
    { id: 'ffmpeg', label: 'FFmpeg Video Render', icon: Video, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { id: 'youtube_upload', label: 'YouTube Cloud Upload', icon: Youtube, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' }
]

export default function MusicAutomationPage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoadingAuth, setIsLoadingAuth] = useState(true)
    const [prompt, setPrompt] = useState('')
    const [title, setTitle] = useState('')
    const [enhance, setEnhance] = useState(true)
    const [activeJob, setActiveJob] = useState<SunoJob | null>(null)
    const [copied, setCopied] = useState(false)

    // New States for Model Selector
    const [modelMode, setModelMode] = useState<'suno' | 'stable' | 'manual'>('suno')
    const [audioFile, setAudioFile] = useState<File | null>(null)
    const [isUploading, setIsUploading] = useState(false)

    const logsEndRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { socket, emit } = useSocket()

    // 1. Authenticate Owner
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('bot_auth_token')
            if (token === '6285172013920_2007') {
                setIsAuthenticated(true)
            }
            setIsLoadingAuth(false)
        }
    }, [])

    // 2. Socket Listeners
    useEffect(() => {
        if (!socket) return

        const handleStatus = (job: SunoJob) => {
            if (activeJob && job.id === activeJob.id) {
                setActiveJob(job)
            } else if (!activeJob && job.status === 'running') {
                setActiveJob(job)
            } else if (activeJob && job.id !== activeJob.id && job.status === 'running' && job.timestamp > activeJob.timestamp) {
                setActiveJob(job)
            }
        }

        socket.on('suno:status', handleStatus)
        socket.emit('suno:get_active')

        socket.on('suno:started', (data: { jobId: string }) => {
            setActiveJob({
                id: data.jobId,
                prompt,
                title: title || 'Untitled Music',
                status: 'running',
                stage: 'idle',
                progress: 0,
                logs: ['[System] Job initialized, waiting for pipeline activation...'],
                youtubeUrl: null,
                source: 'web',
                timestamp: Date.now()
            })
        })

        return () => {
            socket.off('suno:status', handleStatus)
            socket.off('suno:started')
        }
    }, [socket, activeJob, prompt, title])

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeJob?.logs])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setAudioFile(e.target.files[0])
        }
    }

    const handleGenerate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!prompt.trim()) {
            return toast.error('Prompt atau Deskripsi lagu wajib diisi!')
        }

        if (modelMode === 'suno' && prompt.length > 200) {
            return toast.error('Maksimal 200 karakter untuk Suno API!')
        }
        if (modelMode === 'stable' && prompt.length > 2000) {
            return toast.error('Maksimal 2000 karakter untuk Stable Audio!')
        }

        if (modelMode === 'manual') {
            if (!audioFile) {
                return toast.error('Pilih file audio MP3 terlebih dahulu!')
            }
            setIsUploading(true)
            toast.loading('Mengupload audio manual...', { id: 'upload' })

            const formData = new FormData()
            formData.append('audio', audioFile)
            formData.append('prompt', prompt.trim())
            formData.append('title', title.trim() || '')

            try {
                // Determine base URL dynamically (socket usually uses same host)
                const apiBase = window.location.origin.replace(':3001', ':3000') // Adjust for express port
                const res = await fetch(`${apiBase}/api/music/manual-upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer 6285172013920_2007` },
                    body: formData
                })
                const data = await res.json()
                if (data.success) {
                    toast.success('Upload berhasil! Pipeline berjalan.', { id: 'upload' })
                    setAudioFile(null)
                } else {
                    toast.error(`Upload gagal: ${data.message}`, { id: 'upload' })
                }
            } catch (err) {
                toast.error('Terjadi kesalahan jaringan saat upload.', { id: 'upload' })
            } finally {
                setIsUploading(false)
            }
        } else {
            toast.loading('Memulai pipeline AI...', { duration: 2500 })
            emit('suno:generate', {
                prompt: prompt.trim(),
                title: title.trim() || null,
                enhance,
                model: modelMode // 'suno' or 'stable'
            })
        }
    }

    const copyToClipboard = (text: string) => {
        if (!text) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    setCopied(true)
                    toast.success('Link disalin ke clipboard')
                    setTimeout(() => setCopied(false), 2000)
                })
                .catch(() => {
                    fallbackCopy(text)
                })
        } else {
            fallbackCopy(text)
        }
    }

    const fallbackCopy = (text: string) => {
        const textArea = document.createElement("textarea")
        textArea.value = text
        textArea.style.position = "fixed"
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        try {
            document.execCommand('copy')
            setCopied(true)
            toast.success('Link disalin ke clipboard')
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            toast.error('Gagal menyalin link.')
        }
        document.body.removeChild(textArea)
    }

    const getStageIndex = (stageId: string) => {
        return STAGES_CONFIG.findIndex(s => s.id === stageId)
    }

    if (isLoadingAuth) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#0F0F23]">
                <Loader2 size={32} className="text-[#4338CA] animate-spin" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0F0F23] text-white p-6">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 mb-6">
                    <ShieldAlert size={48} />
                </div>
                <h1 className="text-xl font-bold tracking-tight mb-2 font-mono uppercase">Access Denied</h1>
                <Link href="/" className="px-5 py-2.5 bg-white text-[#0F0F23] font-semibold text-xs rounded-xl hover:bg-neutral-200 transition-colors">
                    Kembali ke Beranda
                </Link>
            </div>
        )
    }

    return (
        <div className="h-screen w-full bg-[#0F0F23] text-[#F8FAFC] relative overflow-x-hidden overflow-y-auto pb-12 font-sans select-none">
            {/* Ambient Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 fixed">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#1E1B4B]/30 blur-[150px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#4338CA]/20 blur-[150px]" />
            </div>

            <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6 relative z-10 space-y-6">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-white/5 pb-5 gap-4">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-neutral-400 hover:text-white transition-colors" title="Kembali ke Dashboard">
                            <ArrowLeft size={16} />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-white font-mono text-shadow-glow">
                                WABOT MUSIC GEN
                            </h1>
                            <p className="text-xs text-neutral-400 mt-0.5">
                                Multi-Model Audio Generation & Automation Pipeline
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs text-emerald-400 font-mono self-start md:self-auto">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>SESSION SECURED</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Column: Form Inputs */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="p-5 md:p-6 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-xl space-y-5 shadow-2xl">
                            
                            {/* Model Selector */}
                            <div className="space-y-3">
                                <h3 className="text-[10px] font-mono font-bold tracking-widest text-neutral-400 uppercase">Engine Selector</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    <button 
                                        type="button"
                                        onClick={() => setModelMode('suno')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300 ${modelMode === 'suno' ? 'bg-[#4338CA]/20 border-[#4338CA] text-white shadow-[0_0_15px_rgba(67,56,202,0.3)]' : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'}`}
                                    >
                                        <Music size={18} className={modelMode === 'suno' ? 'text-pink-400' : ''} />
                                        <span className="text-[10px] font-bold">Suno AI</span>
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setModelMode('stable')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300 ${modelMode === 'stable' ? 'bg-[#4338CA]/20 border-[#4338CA] text-white shadow-[0_0_15px_rgba(67,56,202,0.3)]' : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'}`}
                                    >
                                        <Radio size={18} className={modelMode === 'stable' ? 'text-blue-400' : ''} />
                                        <span className="text-[10px] font-bold text-center">Stable Audio</span>
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setModelMode('manual')}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-300 ${modelMode === 'manual' ? 'bg-[#4338CA]/20 border-[#4338CA] text-white shadow-[0_0_15px_rgba(67,56,202,0.3)]' : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'}`}
                                    >
                                        <UploadCloud size={18} className={modelMode === 'manual' ? 'text-emerald-400' : ''} />
                                        <span className="text-[10px] font-bold text-center">Manual MP3</span>
                                    </button>
                                </div>
                            </div>

                            <form onSubmit={handleGenerate} className="space-y-4">
                                {modelMode === 'manual' && (
                                    <div className="space-y-1.5 animate-in fade-in zoom-in duration-300">
                                        <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">Upload Audio (MP3)</label>
                                        <div 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-full p-6 border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#4338CA]/50 hover:bg-[#4338CA]/5 transition-all"
                                        >
                                            <input 
                                                type="file" 
                                                accept="audio/mp3, audio/wav, audio/mpeg" 
                                                className="hidden" 
                                                ref={fileInputRef}
                                                onChange={handleFileChange}
                                            />
                                            {audioFile ? (
                                                <>
                                                    <Headset size={24} className="text-emerald-400" />
                                                    <span className="text-xs text-white text-center">{audioFile.name}</span>
                                                    <span className="text-[10px] text-neutral-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
                                                </>
                                            ) : (
                                                <>
                                                    <UploadCloud size={24} className="text-neutral-500" />
                                                    <span className="text-xs text-neutral-400 text-center">Klik untuk upload file audio MP3/WAV</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">Judul Lagu (Opsional)</label>
                                    <input
                                        type="text"
                                        placeholder="Misal: Epic Battlefield"
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        className="w-full h-11 px-4 bg-white/[0.03] border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 outline-none focus:border-[#4338CA]/80 transition-colors"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-end">
                                        <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">
                                            {modelMode === 'manual' ? 'Prompt Meta (Untuk Thumbnail)' : 'Vibe / Genre Deskripsi'}
                                        </label>
                                        <span className={`text-[9px] font-mono ${
                                            (modelMode === 'suno' && prompt.length > 200) || (modelMode === 'stable' && prompt.length > 2000) 
                                                ? 'text-red-400' : 'text-neutral-500'
                                        }`}>
                                            {prompt.length}/{modelMode === 'suno' ? '200' : '2000'}
                                        </span>
                                    </div>
                                    <textarea
                                        placeholder={modelMode === 'manual' ? "Masukkan prompt original lagu ini untuk membuat visualisasi/thumbnail..." : "Misal: cinematic orchestral epic battle..."}
                                        value={prompt}
                                        onChange={e => setPrompt(e.target.value)}
                                        rows={5}
                                        className="w-full p-4 bg-white/[0.03] border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-600 outline-none focus:border-[#4338CA]/80 transition-colors resize-none leading-relaxed"
                                        required
                                    />
                                </div>

                                {modelMode !== 'manual' && (
                                    <div className="flex items-center justify-between py-3 border-t border-white/5">
                                        <div className="min-w-0 mr-4">
                                            <p className="text-xs text-neutral-200 font-medium flex items-center gap-1.5">
                                                <Sparkles size={12} className="text-purple-400" />
                                                <span>AI Prompt Enhance</span>
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setEnhance(!enhance)}
                                            className="text-neutral-400 hover:text-white transition-colors"
                                        >
                                            {enhance ? <ToggleRight className="text-[#4338CA] w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
                                        </button>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={activeJob?.status === 'running' || isUploading}
                                    className="w-full h-12 bg-[#22C55E] hover:bg-[#16a34a] text-[#0F0F23] font-bold text-xs rounded-xl shadow-[0_4px_14px_rgba(34,197,94,0.3)] hover:shadow-[0_6px_20px_rgba(34,197,94,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 duration-200"
                                >
                                    {isUploading ? (
                                        <><Loader2 size={14} className="animate-spin" /><span>Mengupload...</span></>
                                    ) : activeJob?.status === 'running' ? (
                                        <><Loader2 size={14} className="animate-spin" /><span>Pipeline Aktif</span></>
                                    ) : (
                                        <><Play size={12} className="fill-[#0F0F23]" /><span>{modelMode === 'manual' ? 'Upload & Render' : 'Generate Track'}</span></>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* Right Column: Live Pipeline & Logs */}
                    <div className="lg:col-span-8 space-y-6">
                        <div className="p-5 md:p-6 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-xl space-y-6 shadow-2xl">
                            <div>
                                <h3 className="text-sm font-bold font-mono tracking-wider text-neutral-200">LIVE WORKFLOW</h3>
                                <p className="text-[10px] text-neutral-400">Server-side automation pipeline progress</p>
                            </div>

                            {activeJob ? (
                                <div className="space-y-8 py-2 relative">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 relative z-10">
                                        {STAGES_CONFIG.map((stage, idx) => {
                                            const Icon = stage.icon
                                            const activeIdx = getStageIndex(activeJob.stage)
                                            const isCompleted = activeJob.status === 'completed' || activeIdx > idx
                                            const isCurrent = activeJob.status === 'running' && activeJob.stage === stage.id
                                            const isPending = !isCompleted && !isCurrent

                                            return (
                                                <div
                                                    key={stage.id}
                                                    className={`p-3 md:p-4 rounded-xl border flex flex-col gap-3 transition-all duration-300 ${
                                                        isCompleted ? 'bg-[#22C55E]/5 border-[#22C55E]/20' :
                                                        isCurrent ? 'bg-[#4338CA]/10 border-[#4338CA]/40 shadow-[0_0_15px_rgba(67,56,202,0.15)] scale-[1.02]' :
                                                        'bg-black/20 border-white/5 opacity-50'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className={`p-2 rounded-lg border ${stage.color}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        <div>
                                                            {isCompleted && <CheckCircle2 size={14} className="text-[#22C55E]" />}
                                                            {isCurrent && <Loader2 size={14} className="text-[#4338CA] animate-spin" />}
                                                            {isPending && <div className="w-2 h-2 rounded-full border border-white/20" />}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] md:text-[11px] font-bold font-mono text-white/90">{stage.label}</p>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                                            <span>PROGRESS</span>
                                            <span className="text-[#22C55E]">{activeJob.progress}%</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                            <motion.div
                                                className="h-full bg-gradient-to-r from-[#4338CA] to-[#22C55E]"
                                                animate={{ width: `${activeJob.progress}%` }}
                                                transition={{ duration: 0.5 }}
                                            />
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {activeJob.status === 'completed' && activeJob.youtubeUrl && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="p-5 bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4 backdrop-blur-sm"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="p-3 bg-red-500/20 text-red-400 rounded-xl">
                                                        <Youtube size={24} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-bold text-white font-mono">UPLOAD SUCCESSFUL!</h4>
                                                        <p className="text-[10px] text-neutral-300 mt-0.5">Live on YouTube Network</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2.5 w-full md:w-auto">
                                                    <button
                                                        onClick={() => copyToClipboard(activeJob.youtubeUrl || '')}
                                                        className="flex-1 md:flex-none h-10 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                                    >
                                                        {copied ? <Check size={14} className="text-[#22C55E]" /> : <Copy size={14} />}
                                                        <span>{copied ? 'Copied' : 'Copy'}</span>
                                                    </button>
                                                    <a
                                                        href={activeJob.youtubeUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex-1 md:flex-none h-10 px-4 bg-[#F8FAFC] text-[#0F0F23] hover:bg-neutral-200 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                                    >
                                                        <ExternalLink size={14} />
                                                        <span>Watch</span>
                                                    </a>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <div className="py-16 text-center border border-dashed border-white/10 rounded-xl bg-black/20">
                                    <Sparkles className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
                                    <p className="text-xs font-bold text-neutral-300">Ready to Generate</p>
                                    <p className="text-[10px] text-neutral-500 mt-1 max-w-xs mx-auto">
                                        Select an engine, write a prompt, and start the automated workflow.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Terminal */}
                        <div className="p-5 bg-black/40 border border-white/5 rounded-2xl space-y-4 backdrop-blur-md">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Terminal size={14} className="text-[#4338CA]" />
                                    <h3 className="text-xs font-bold font-mono tracking-wider text-neutral-300">SYSTEM LOGS</h3>
                                </div>
                            </div>

                            <div className="h-48 md:h-64 rounded-xl border border-white/5 bg-black/60 p-4 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-2 selection:bg-[#4338CA]/30">
                                {activeJob && activeJob.logs.length > 0 ? (
                                    activeJob.logs.map((log, idx) => (
                                        <div key={idx} className="text-neutral-300 flex items-start gap-2">
                                            <span className="text-[#22C55E]/50 shrink-0 font-medium">~</span>
                                            <span>{log}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-neutral-600 italic">Waiting for incoming logs...</div>
                                )}
                                <div ref={logsEndRef} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
