// src/app/sunoautomation/page.tsx
'use client'
import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ArrowLeft, ToggleLeft, ToggleRight, Sparkles, Youtube,
    CheckCircle2, AlertCircle, Loader2, Music, Terminal,
    Video, Image, FileText, Settings, Play, ShieldAlert,
    ExternalLink, Copy, Check
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
    { id: 'suno_gen', label: 'Suno Music Generation', icon: Music, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
    { id: 'gemini_meta', label: 'Gemini Metadata', icon: FileText, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { id: 'img_gen', label: 'Thumbnail Art Design', icon: Image, color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
    { id: 'ffmpeg', label: 'FFmpeg Video Render', icon: Video, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { id: 'youtube_upload', label: 'YouTube Cloud Upload', icon: Youtube, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' }
]

export default function SunoAutomationPage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoadingAuth, setIsLoadingAuth] = useState(true)
    const [prompt, setPrompt] = useState('')
    const [title, setTitle] = useState('')
    const [enhance, setEnhance] = useState(true)
    const [activeJob, setActiveJob] = useState<SunoJob | null>(null)
    const [copied, setCopied] = useState(false)

    const logsEndRef = useRef<HTMLDivElement>(null)
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

    // 2. Socket Listeners for Real-Time Pipeline Updates
    useEffect(() => {
        if (!socket) return

        const handleStatus = (job: SunoJob) => {
            // Track the active job
            if (activeJob && job.id === activeJob.id) {
                setActiveJob(job)
            } else if (!activeJob && job.status === 'running') {
                // If no job is tracked, attach to any incoming running job
                setActiveJob(job)
            } else if (activeJob && job.id !== activeJob.id && job.status === 'running' && job.timestamp > activeJob.timestamp) {
                // Switch to newer running job
                setActiveJob(job)
            }
        }

        socket.on('suno:status', handleStatus)

        // Request initial list of jobs to see if one is already running
        socket.emit('suno:get_active')

        // Capture started event
        socket.on('suno:started', (data: { jobId: string }) => {
            setActiveJob({
                id: data.jobId,
                prompt,
                title: title || 'Untitled Instrumental',
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

    // Auto scroll console logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeJob?.logs])

    const handleGenerate = (e: React.FormEvent) => {
        e.preventDefault()
        if (!prompt.trim()) {
            return toast.error('Vibe atau Deskripsi lagu wajib diisi!')
        }

        toast.loading('Memulai pipeline musik otomatis...', { duration: 2500 })
        emit('suno:generate', {
            prompt: prompt.trim(),
            title: title.trim() || null,
            enhance
        })
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        toast.success('Link disalin ke clipboard')
        setTimeout(() => setCopied(false), 2000)
    }

    const getStageIndex = (stageId: string) => {
        return STAGES_CONFIG.findIndex(s => s.id === stageId)
    }

    if (isLoadingAuth) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-black">
                <Loader2 size={32} className="text-purple-500 animate-spin" />
            </div>
        )
    }

    if (!isAuthenticated) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#020208] text-white p-6">
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 mb-6 animate-pulse-soft">
                    <ShieldAlert size={48} />
                </div>
                <h1 className="text-xl font-bold tracking-tight mb-2 font-mono uppercase">Access Denied</h1>
                <p className="text-sm text-neutral-400 text-center max-w-sm mb-6 font-sans">
                    Halaman ini dikonfigurasi khusus untuk Owner Bot. Silakan login ke Dashboard utama terlebih dahulu.
                </p>
                <Link href="/" className="px-5 py-2.5 bg-white text-black font-semibold text-xs rounded-xl hover:bg-neutral-200 transition-colors">
                    Kembali ke Beranda
                </Link>
            </div>
        )
    }

    return (
        <div className="h-screen w-full bg-[#03030c] text-white relative overflow-x-hidden overflow-y-auto pb-12 font-sans select-none">
            {/* Ambient Background Glowing Orbs */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 fixed">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-950/20 blur-[150px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-rose-950/20 blur-[150px]" />
                <div className="absolute top-[30%] right-[-5%] w-[40%] h-[40%] rounded-full bg-blue-950/10 blur-[120px]" />
            </div>

            <div className="max-w-7xl mx-auto px-6 pt-6 relative z-10 space-y-6">
                {/* Header Section */}
                <div className="flex items-center justify-between border-b border-white/5 pb-5">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-neutral-400 hover:text-white transition-colors" title="Kembali ke Dashboard">
                            <ArrowLeft size={16} />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-white font-righteous text-shadow-glow">
                                SUNO MUSIC AUTOMATION
                            </h1>
                            <p className="text-xs text-neutral-400 font-sans mt-0.5">
                                Generate premium video looping instrumental & upload otomatis ke YouTube Data Cloud
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs text-emerald-400 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>OWNER SESSION SECURED</span>
                    </div>
                </div>

                {/* Main Workspace Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Left Column: Form Inputs */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl glassmorphism space-y-5">
                            <div>
                                <h3 className="text-sm font-bold font-mono tracking-wider text-neutral-200">WORKFLOW CONFIG</h3>
                                <p className="text-[10px] text-neutral-400">Masukan genre/vibe lagu untuk memicu pipeline</p>
                            </div>

                            <form onSubmit={handleGenerate} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">Judul Lagu (Opsional)</label>
                                    <input
                                        type="text"
                                        placeholder="Misal: Sunset Breeze (atau dikosongkan)"
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        className="w-full h-11 px-4 bg-white/[0.03] border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 outline-none focus:border-purple-500/50 transition-colors"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">Vibe / Genre Deskripsi</label>
                                    <textarea
                                        placeholder="Misal: lofi hiphop chill dengan gitar akustik lembut dan ketukan drum santai sore hari..."
                                        value={prompt}
                                        onChange={e => setPrompt(e.target.value)}
                                        rows={4}
                                        className="w-full p-4 bg-white/[0.03] border border-white/10 rounded-xl text-xs text-white placeholder:text-neutral-500 outline-none focus:border-purple-500/50 transition-colors resize-none leading-relaxed"
                                        required
                                    />
                                </div>

                                {/* Toggle switch */}
                                <div className="flex items-center justify-between py-3 border-t border-white/5">
                                    <div className="min-w-0 mr-4">
                                        <p className="text-xs text-neutral-200 font-medium flex items-center gap-1.5">
                                            <Sparkles size={12} className="text-purple-400" />
                                            <span>Sempurnakan dengan AI</span>
                                        </p>
                                        <p className="text-[9px] text-neutral-400 mt-0.5 leading-relaxed">
                                            Memakai Gemini untuk memperkaya deskripsi visual & audio prompt
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setEnhance(!enhance)}
                                        className="text-neutral-400 hover:text-white transition-colors"
                                    >
                                        {enhance ? (
                                            <ToggleRight className="text-purple-500 w-10 h-10" />
                                        ) : (
                                            <ToggleLeft className="w-10 h-10" />
                                        )}
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={activeJob?.status === 'running'}
                                    className="w-full h-11 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-purple-500/10 hover:shadow-purple-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {activeJob?.status === 'running' ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin text-white" />
                                            <span>Pipeline Sedang Berjalan</span>
                                        </>
                                    ) : (
                                        <>
                                            <Play size={12} className="fill-white" />
                                            <span>Generate Music Video</span>
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* Right Column: Live Pipeline & Logs */}
                    <div className="lg:col-span-8 space-y-6">
                        {/* Interactive Pipeline Process */}
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl glassmorphism space-y-6">
                            <div>
                                <h3 className="text-sm font-bold font-mono tracking-wider text-neutral-200">LIVE AUTOMATION PIPELINE</h3>
                                <p className="text-[10px] text-neutral-400">Progres alur kerja automasi real-time seperti server Railway</p>
                            </div>

                            {activeJob ? (
                                <div className="space-y-8 py-2 relative">
                                    {/* Stages visual display */}
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 relative z-10">
                                        {STAGES_CONFIG.map((stage, idx) => {
                                            const Icon = stage.icon
                                            const activeIdx = getStageIndex(activeJob.stage)
                                            const isCompleted = activeJob.status === 'completed' || activeIdx > idx
                                            const isCurrent = activeJob.status === 'running' && activeJob.stage === stage.id
                                            const isPending = !isCompleted && !isCurrent

                                            return (
                                                <div
                                                    key={stage.id}
                                                    className={`p-4 rounded-xl border flex flex-col gap-3 transition-all duration-300 ${
                                                        isCompleted ? 'bg-emerald-500/5 border-emerald-500/20' :
                                                        isCurrent ? 'bg-purple-500/5 border-purple-500/30 shadow-lg shadow-purple-500/5' :
                                                        'bg-neutral-900/40 border-white/5 opacity-40'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className={`p-2 rounded-lg border ${stage.color}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        <div>
                                                            {isCompleted && <CheckCircle2 size={14} className="text-emerald-400" />}
                                                            {isCurrent && <Loader2 size={14} className="text-purple-400 animate-spin" />}
                                                            {isPending && <div className="w-2.5 h-2.5 rounded-full border border-white/20" />}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-bold font-mono text-white/90">{stage.label}</p>
                                                        <p className="text-[9px] font-mono text-neutral-500 mt-0.5">
                                                            {isCompleted ? 'Completed' : isCurrent ? 'Running...' : 'Pending'}
                                                        </p>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* Global progress bar */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                                            <span>PIPELINE PROGRESS</span>
                                            <span>{activeJob.progress}%</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                            <motion.div
                                                className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500"
                                                animate={{ width: `${activeJob.progress}%` }}
                                                transition={{ duration: 0.5 }}
                                            />
                                        </div>
                                    </div>

                                    {/* Completion Card */}
                                    <AnimatePresence>
                                        {activeJob.status === 'completed' && activeJob.youtubeUrl && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
                                                        <Youtube size={24} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-bold text-white font-righteous">AUTOMATION SUCCESSFUL!</h4>
                                                        <p className="text-[10px] text-neutral-300 mt-0.5">Video telah berhasil diupload ke YouTube</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2.5 w-full md:w-auto">
                                                    <button
                                                        onClick={() => copyToClipboard(activeJob.youtubeUrl || '')}
                                                        className="flex-1 md:flex-none h-9 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                                    >
                                                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                        <span>{copied ? 'Copied' : 'Copy Link'}</span>
                                                    </button>
                                                    <a
                                                        href={activeJob.youtubeUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex-1 md:flex-none h-9 px-4 bg-white text-black hover:bg-neutral-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                                    >
                                                        <ExternalLink size={12} />
                                                        <span>Buka YouTube</span>
                                                    </a>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Failure Card */}
                                    <AnimatePresence>
                                        {activeJob.status === 'failed' && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0 }}
                                                className="p-5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3"
                                            >
                                                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl">
                                                    <AlertCircle size={24} />
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-bold text-white font-mono">AUTOMATION PIPELINE FAILED</h4>
                                                    <p className="text-[10px] text-red-400 mt-0.5 leading-relaxed">
                                                        {activeJob.logs[activeJob.logs.length - 1]?.replace(/\[.*\]/, '').trim() || 'Terjadi kesalahan sistem.'}
                                                    </p>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <div className="py-16 text-center border border-dashed border-white/5 rounded-xl bg-white/[0.01]">
                                    <Music className="w-10 h-10 text-neutral-600 mx-auto mb-3 animate-pulse-soft" />
                                    <p className="text-xs font-semibold text-neutral-300">Belum Ada Pipeline Berjalan</p>
                                    <p className="text-[10px] text-neutral-500 mt-1 max-w-xs mx-auto">
                                        Masukan vibe atau deskripsi lagu di samping untuk memulai proses automasi musik instrumen
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Real-time terminal log console */}
                        <div className="p-6 bg-[#010103] border border-white/5 rounded-2xl space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Terminal size={14} className="text-purple-400" />
                                    <h3 className="text-xs font-bold font-mono tracking-wider text-neutral-200">REAL-TIME CONSOLE LOGS</h3>
                                </div>
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/[0.03] border border-white/5 rounded text-[9px] font-mono text-neutral-400">
                                    <span>SHELL: BASH/FFMPEG</span>
                                </div>
                            </div>

                            <div className="h-64 rounded-xl border border-white/5 bg-[#000000] p-4 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-2 selection:bg-purple-500/20 select-text">
                                {activeJob && activeJob.logs.length > 0 ? (
                                    activeJob.logs.map((log, idx) => (
                                        <div key={idx} className="text-neutral-300 flex items-start gap-2">
                                            <span className="text-neutral-600 shrink-0 font-medium">#</span>
                                            <span>{log}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-neutral-600 italic">Console idle, waiting for active process stream...</div>
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
