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

const NODES_CONFIG = [
    { id: 'ai_enhance', label: 'AI Prompt Enhancer', desc: 'Enhance prompt text for higher music aesthetics', model: 'Groq Llama 3.3', icon: Sparkles, color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
    { id: 'suno_gen', label: 'Audio Generation', desc: 'Generate vocal & music audio tracks', model: 'Suno v3 / Stable Audio', icon: Music, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
    { id: 'gemini_meta', label: 'Gemini Metadata', desc: 'Generate YouTube titles, tags & prompts', model: 'Gemini Flash 2.0', icon: FileText, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { id: 'img_gen', label: 'Thumbnail Art Design', desc: 'Generate cover art using custom AI models', model: 'FLUX / Krea-2 / Z-Turbo', icon: Image, color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
    { id: 'video_gen', label: 'Video Motion Generator', desc: 'Animate cover art with 3D camera pan', model: 'DreamWan v2', icon: Video, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
    { id: 'ffmpeg', label: 'FFmpeg Video Render', desc: 'Merge audio, video background & overlay', model: 'FFmpeg v7.0', icon: Terminal, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { id: 'youtube_upload', label: 'YouTube Cloud Upload', desc: 'Publish official music video to channel', model: 'YouTube Data API', icon: Youtube, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' }
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
    const [sunoProvider, setSunoProvider] = useState<'suno' | 'suno_com'>('suno')
    const [audioFile, setAudioFile] = useState<File | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [isDragActive, setIsDragActive] = useState(false)

    const logsContainerRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const bookmarkletRef = useRef<HTMLAnchorElement>(null)
    const { socket, emit } = useSocket()

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === "dragenter" || e.type === "dragover") {
            setIsDragActive(true)
        } else if (e.type === "dragleave") {
            setIsDragActive(false)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragActive(false)
        
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0]
            if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
                setAudioFile(file)
            } else {
                toast.error('Hanya menerima file audio MP3/WAV!')
            }
        }
    }

    const [manualCookie, setManualCookie] = useState('')
    const [isSyncingCookie, setIsSyncingCookie] = useState(false)
    const [bookmarkletUrl, setBookmarkletUrl] = useState('')
    const [tunnelUrl, setTunnelUrl] = useState('')
    const [isSyncingTunnel, setIsSyncingTunnel] = useState(false)

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const apiBase = window.location.origin.replace(':3001', ':3000')
            const jsCode = `javascript:(function(){const c=document.cookie;fetch('${apiBase}/api/music/update-cookie', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer 6285172013920_2007'},body:JSON.stringify({cookie:c})}).then(r=>r.json()).then(d=>alert(d.success?'Suno Session Synced!':d.message)).catch(e=>alert('Error: '+e.message))})()`
            setBookmarkletUrl(jsCode)
            if (bookmarkletRef.current) {
                bookmarkletRef.current.setAttribute('href', jsCode)
            }

            // Fetch current tunnel config
            const fetchConfig = async () => {
                try {
                    const res = await fetch(`${apiBase}/api/music/config`, {
                        headers: { 'Authorization': 'Bearer 6285172013920_2007' }
                    })
                    const data = await res.json()
                    if (data.success) {
                        setTunnelUrl(data.tunnelUrl || '')
                    }
                } catch (err) {
                    console.error('Gagal fetch config:', err)
                }
            }
            fetchConfig()
        }
    }, [])

    const handleSyncCookie = async () => {
        if (!manualCookie.trim()) {
            return toast.error('Masukkan cookie Suno terlebih dahulu!')
        }
        setIsSyncingCookie(true)
        try {
            const apiBase = window.location.origin.replace(':3001', ':3000')
            const res = await fetch(`${apiBase}/api/music/update-cookie`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer 6285172013920_2007` 
                },
                body: JSON.stringify({ cookie: manualCookie.trim() })
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Suno Session Cookie berhasil diperbarui!')
                setManualCookie('')
            } else {
                toast.error(`Gagal sync: ${data.message}`)
            }
        } catch (err) {
            toast.error('Gagal menghubungi server untuk update cookie.')
        } finally {
            setIsSyncingCookie(false)
        }
    }

    const handleSyncTunnel = async () => {
        if (!tunnelUrl.trim()) {
            return toast.error('Masukkan URL Tunnel terlebih dahulu!')
        }
        setIsSyncingTunnel(true)
        try {
            const apiBase = window.location.origin.replace(':3001', ':3000')
            const res = await fetch(`${apiBase}/api/music/update-tunnel`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer 6285172013920_2007` 
                },
                body: JSON.stringify({ tunnelUrl: tunnelUrl.trim() })
            })
            const data = await res.json()
            if (data.success) {
                toast.success('Suno API Proxy Tunnel URL berhasil diperbarui!')
            } else {
                toast.error(`Gagal sync: ${data.message}`)
            }
        } catch (err) {
            toast.error('Gagal menghubungi server untuk update tunnel URL.')
        } finally {
            setIsSyncingTunnel(false)
        }
    }

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
        const container = logsContainerRef.current
        if (container) {
            const threshold = 100 // px
            const isNearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < threshold
            if (isNearBottom) {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth'
                })
            }
        }
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
                model: modelMode === 'suno' ? sunoProvider : 'stable'
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
        const order = ['ai_enhance', 'suno_gen', 'gemini_meta', 'img_gen', 'video_gen', 'ffmpeg', 'youtube_upload']
        return order.indexOf(stageId)
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

                            {/* Suno Provider Sub-Selector */}
                            {modelMode === 'suno' && (
                                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[9px] font-mono font-bold tracking-widest text-neutral-400 uppercase">Suno Provider</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSunoProvider('suno')}
                                            className={`h-9 px-3 rounded-lg border transition-all text-[10px] font-bold flex items-center justify-center gap-1.5 ${
                                                sunoProvider === 'suno'
                                                    ? 'bg-pink-500/10 border-pink-500 text-pink-400'
                                                    : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'
                                            }`}
                                        >
                                            <Sparkles size={12} />
                                            <span>Suno.org API</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSunoProvider('suno_com')}
                                            className={`h-9 px-3 rounded-lg border transition-all text-[10px] font-bold flex items-center justify-center gap-1.5 ${
                                                sunoProvider === 'suno_com'
                                                    ? 'bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                                                    : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'
                                            }`}
                                        >
                                            <Music size={12} />
                                            <span>Suno.com (Bypass)</span>
                                        </button>
                                    </div>
                                    <p className="text-[8px] text-neutral-500 leading-normal">
                                        {sunoProvider === 'suno' 
                                            ? 'Menggunakan managed API key dari Suno.org (bebas captcha, limitasi kuota harian gratis).'
                                            : 'Menggunakan akun Clerk Suno.com milikmu sendiri (unlimited kuota, bypass captcha via sync session cookie).'}
                                    </p>
                                </div>
                            )}

                            <form onSubmit={handleGenerate} className="space-y-4">
                                {modelMode === 'manual' && (
                                    <div className="space-y-1.5 animate-in fade-in zoom-in duration-300">
                                        <label className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">Upload Audio (MP3)</label>
                                        <div 
                                            onClick={() => fileInputRef.current?.click()}
                                            onDragEnter={handleDrag}
                                            onDragOver={handleDrag}
                                            onDragLeave={handleDrag}
                                            onDrop={handleDrop}
                                            className={`w-full p-6 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                                                isDragActive 
                                                    ? 'border-[#22C55E] bg-[#22C55E]/5 scale-[1.02]' 
                                                    : 'border-white/10 hover:border-[#4338CA]/50 hover:bg-[#4338CA]/5'
                                            }`}
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
                                                    <span className="text-xs text-neutral-400 text-center">Klik atau seret file audio MP3/WAV ke sini</span>
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

                        {/* Suno Session Sync Card */}
                        <div className="p-5 md:p-6 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-xl space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom duration-300">
                            <div>
                                <h3 className="text-xs font-bold font-mono tracking-wider text-neutral-200 flex items-center gap-2">
                                    <Settings size={14} className="text-[#4338CA] animate-pulse" />
                                    <span>SUNO SESSION SYNC</span>
                                </h3>
                                <p className="text-[10px] text-neutral-400 mt-1">Suno session expired or captcha blocked? Sync it instantly here.</p>
                            </div>

                            {/* Option 1: Bookmarklet (Easiest) */}
                            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-[#4338CA]/20 text-[#818CF8] font-mono font-bold rounded">METHOD A</span>
                                    <span className="text-[10px] font-bold text-neutral-300">Fast Bookmarklet (PC)</span>
                                </div>
                                <p className="text-[9px] leading-relaxed text-neutral-400">
                                    Drag the button below to your browser Bookmark Bar. Open <a href="https://suno.com" target="_blank" rel="noreferrer" className="text-[#818CF8] hover:underline font-bold">suno.com</a> (login and solve any captchas), then click the bookmarklet to sync cookie automatically!
                                </p>
                                <div className="pt-1">
                                    <a
                                        ref={bookmarkletRef}
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            alert('Silakan seret (drag) tombol ini ke Bookmark Bar browser Anda, jangan diklik langsung!')
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3.5 h-8 bg-[#4338CA] hover:bg-[#3730A3] text-white font-mono font-bold text-[10px] rounded-lg transition-colors cursor-grab active:cursor-grabbing shadow-[0_2px_8px_rgba(67,56,202,0.3)]"
                                    >
                                        <span>+ Drag to Bookmarks</span>
                                    </a>
                                </div>
                            </div>

                            {/* Option 2: Paste Cookie (Mobile / Fallback) */}
                            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl space-y-2.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-mono font-bold rounded">METHOD B</span>
                                    <span className="text-[10px] font-bold text-neutral-300">Paste Cookie Manually</span>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Paste document.cookie string here..."
                                    value={manualCookie}
                                    onChange={(e) => setManualCookie(e.target.value)}
                                    className="w-full h-9 px-3 bg-white/[0.02] border border-white/10 rounded-lg text-[10px] text-white outline-none focus:border-[#4338CA] transition-colors font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={handleSyncCookie}
                                    disabled={isSyncingCookie}
                                    className="w-full h-8 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-[#0F0F23] font-bold text-[10px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {isSyncingCookie ? (
                                        <><Loader2 size={12} className="animate-spin" /><span>Syncing...</span></>
                                    ) : (
                                        <><span>Sync Session Cookie</span></>
                                    )}
                                </button>
                            </div>

                            {/* Option 3: Local Proxy Tunnel (Serveo/Localtunnel) */}
                            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl space-y-2.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 font-mono font-bold rounded">METHOD C</span>
                                    <span className="text-[10px] font-bold text-neutral-300">Suno Local Proxy Tunnel URL</span>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Paste serveo/localtunnel URL here..."
                                    value={tunnelUrl}
                                    onChange={(e) => setTunnelUrl(e.target.value)}
                                    className="w-full h-9 px-3 bg-white/[0.02] border border-white/10 rounded-lg text-[10px] text-white outline-none focus:border-[#4338CA] transition-colors font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={handleSyncTunnel}
                                    disabled={isSyncingTunnel}
                                    className="w-full h-8 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-[#0F0F23] font-bold text-[10px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {isSyncingTunnel ? (
                                        <><Loader2 size={12} className="animate-spin" /><span>Saving...</span></>
                                    ) : (
                                        <><span>Save Tunnel URL</span></>
                                    )}
                                </button>
                            </div>
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
                                    <div className="relative z-10">
                                        {(() => {
                                            const getNodeStatus = (nodeId: string) => {
                                                if (!activeJob) return 'pending'
                                                if (activeJob.status === 'completed') return 'completed'
                                                
                                                const activeStage = activeJob.stage
                                                const activeProgress = activeJob.progress
                                                
                                                const getOrder = (id: string) => {
                                                    const order = ['ai_enhance', 'suno_gen', 'gemini_meta', 'img_gen', 'video_gen', 'ffmpeg', 'youtube_upload']
                                                    return order.indexOf(id)
                                                }
                                                
                                                const activeIdx = getOrder(activeStage)
                                                const currentIdx = getOrder(nodeId)
                                                
                                                if (activeJob.status === 'failed' && activeStage === nodeId) {
                                                    return 'failed'
                                                }

                                                if (nodeId === 'video_gen') {
                                                    const hasStartedVideo = activeProgress >= 61 || activeJob.logs?.some(l => l.includes('[VideoGen]'))
                                                    if (activeStage === 'img_gen') {
                                                        return hasStartedVideo ? 'running' : 'pending'
                                                    }
                                                    return activeIdx > getOrder('img_gen') ? 'completed' : 'pending'
                                                }
                                                
                                                if (nodeId === 'img_gen') {
                                                    const hasStartedVideo = activeProgress >= 61 || activeJob.logs?.some(l => l.includes('[VideoGen]'))
                                                    if (activeStage === 'img_gen') {
                                                        return hasStartedVideo ? 'completed' : 'running'
                                                    }
                                                    return activeIdx > currentIdx ? 'completed' : 'pending'
                                                }
                                                
                                                if (activeIdx > currentIdx) return 'completed'
                                                if (activeStage === nodeId) return 'running'
                                                return 'pending'
                                            }

                                            const renderNodeCard = (node: typeof NODES_CONFIG[0]) => {
                                                const status = getNodeStatus(node.id)
                                                const Icon = node.icon
                                                
                                                return (
                                                    <motion.div
                                                        key={node.id}
                                                        layout
                                                        animate={status === 'running' ? {
                                                            scale: [1, 1.015, 1],
                                                            borderColor: ['rgba(67, 56, 202, 0.3)', 'rgba(99, 102, 241, 0.8)', 'rgba(67, 56, 202, 0.3)'],
                                                            boxShadow: [
                                                                '0 0 15px rgba(67, 56, 202, 0.1)',
                                                                '0 0 25px rgba(67, 56, 202, 0.3)',
                                                                '0 0 15px rgba(67, 56, 202, 0.1)'
                                                             ]
                                                        } : {}}
                                                        transition={status === 'running' ? {
                                                            repeat: Infinity,
                                                            duration: 2.5,
                                                            ease: "easeInOut"
                                                        } : {}}
                                                        className={`p-3 md:p-4 rounded-xl border backdrop-blur-xl transition-all duration-300 relative overflow-hidden flex items-start gap-3 w-full text-left ${
                                                            status === 'completed' ? 'bg-emerald-500/[0.02] border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.03)]' :
                                                            status === 'running' ? 'bg-[#4338CA]/10 z-10' :
                                                            status === 'failed' ? 'bg-rose-500/[0.03] border-rose-500/30' :
                                                            'bg-white/[0.01] border-white/5 opacity-40'
                                                        }`}
                                                    >
                                                        {/* Status indicator bar */}
                                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                                                            status === 'completed' ? 'bg-emerald-500' :
                                                            status === 'running' ? 'bg-[#4338CA]' :
                                                            status === 'failed' ? 'bg-rose-500' :
                                                            'bg-white/10'
                                                        }`} />
                                                        
                                                        <div className={`p-2 rounded-lg border shrink-0 ${node.color}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-1">
                                                                <span className="text-[10px] md:text-[11px] font-bold font-mono text-white/95 truncate">{node.label}</span>
                                                                <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full border uppercase shrink-0 ${
                                                                    status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                                                    status === 'running' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 animate-pulse' :
                                                                    status === 'failed' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                                                                    'bg-white/5 border-white/10 text-neutral-500'
                                                                }`}>
                                                                    {status}
                                                                </span>
                                                            </div>
                                                            <p className="text-[9px] md:text-[10px] text-neutral-400 mt-0.5 leading-relaxed line-clamp-1">{node.desc}</p>
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                <span className="text-[8px] font-mono bg-white/5 border border-white/10 px-1 py-0.5 rounded text-neutral-400 select-none">
                                                                    {node.model}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                )
                                            }

                                            return (
                                                <>
                                                    {/* Mobile View: Vertical Timeline */}
                                                    <div className="md:hidden flex flex-col gap-4 relative">
                                                        <div className="absolute left-6 top-6 bottom-6 w-[2px] bg-white/5 z-0" />
                                                        {NODES_CONFIG.map((node) => {
                                                            const status = getNodeStatus(node.id)
                                                            return (
                                                                <div key={node.id} className="relative z-10 pl-12">
                                                                    <div className={`absolute left-6 top-6 w-3 h-3 rounded-full border-2 transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center ${
                                                                        status === 'completed' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
                                                                        status === 'running' ? 'bg-indigo-500 border-indigo-400 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.5)]' :
                                                                        status === 'failed' ? 'bg-rose-500 border-rose-400' :
                                                                        'bg-[#0F0F23] border-white/20'
                                                                    }`} />
                                                                    {renderNodeCard(node)}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>

                                                    {/* Desktop View: Automation 2D Node Flowchart */}
                                                    <div className="hidden md:flex flex-col items-center w-full relative z-10 py-4 max-w-4xl mx-auto">
                                                        
                                                        {/* ROW 1: AI Prompt Enhance */}
                                                        <div className="w-full max-w-sm">
                                                            {renderNodeCard(NODES_CONFIG[0])}
                                                        </div>

                                                        {/* CONNECTOR: Row 1 to Row 2 */}
                                                        <div className="w-full h-10 flex justify-center items-center">
                                                            <svg viewBox="0 0 100 40" className="w-full h-full text-white/10" preserveAspectRatio="none">
                                                                <path d="M 50,0 L 50,20 M 50,20 L 25,20 L 25,40 M 50,20 L 75,20 L 75,40" stroke="currentColor" strokeWidth="1.5" fill="none" />
                                                                {getNodeStatus('ai_enhance') === 'completed' && (
                                                                    <path d="M 50,0 L 50,20 L 25,20 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                                {getNodeStatus('ai_enhance') === 'completed' && (
                                                                    <path d="M 50,0 L 50,20 L 75,20 L 75,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                            </svg>
                                                        </div>

                                                        {/* ROW 2: Parallel Tracks (Audio & Metadata) */}
                                                        <div className="grid grid-cols-2 gap-x-16 gap-y-0 w-full">
                                                            {renderNodeCard(NODES_CONFIG[1])}
                                                            {renderNodeCard(NODES_CONFIG[2])}
                                                        </div>

                                                        {/* CONNECTOR: Row 2 to Row 3 */}
                                                        <div className="w-full h-10 flex justify-center items-center">
                                                            <svg viewBox="0 0 100 40" className="w-full h-full text-white/10" preserveAspectRatio="none">
                                                                {/* Suno Gen straight down to Thumbnail Art */}
                                                                <path d="M 25,0 L 25,40" stroke="currentColor" strokeWidth="1.5" fill="none" />
                                                                {/* Gemini Meta down & branch: left to Thumbnail, right to Video Gen */}
                                                                <path d="M 75,0 L 75,20 L 25,20 L 25,40 M 75,20 L 75,40" stroke="currentColor" strokeWidth="1.5" fill="none" />
                                                                
                                                                {getNodeStatus('suno_gen') === 'completed' && (
                                                                    <path d="M 25,0 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                                {getNodeStatus('gemini_meta') === 'completed' && (
                                                                    <path d="M 75,0 L 75,20 L 25,20 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                                {getNodeStatus('gemini_meta') === 'completed' && (
                                                                    <path d="M 75,20 L 75,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                            </svg>
                                                        </div>

                                                        {/* ROW 3: Visual Assets (Thumbnail & Video Gen) */}
                                                        <div className="grid grid-cols-2 gap-x-16 gap-y-0 w-full">
                                                            {renderNodeCard(NODES_CONFIG[3])}
                                                            {renderNodeCard(NODES_CONFIG[4])}
                                                        </div>

                                                        {/* CONNECTOR: Row 3 to Row 4 */}
                                                        <div className="w-full h-10 flex justify-center items-center">
                                                            <svg viewBox="0 0 100 40" className="w-full h-full text-white/10" preserveAspectRatio="none">
                                                                {/* Flow from Thumbnail and Video Gen merging into FFmpeg Render */}
                                                                <path d="M 25,0 L 25,40 M 75,0 L 75,20 L 50,20 L 25,20" stroke="currentColor" strokeWidth="1.5" fill="none" />
                                                                {getNodeStatus('img_gen') === 'completed' && (
                                                                    <path d="M 25,0 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                                {getNodeStatus('video_gen') === 'completed' && (
                                                                    <path d="M 75,0 L 75,20 L 25,20" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                        <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                    </path>
                                                                )}
                                                            </svg>
                                                        </div>

                                                        {/* ROW 4: Compiling & Deployment Node Grid */}
                                                        <div className="grid grid-cols-2 gap-x-16 gap-y-0 w-full relative">
                                                            {renderNodeCard(NODES_CONFIG[5])}
                                                            {renderNodeCard(NODES_CONFIG[6])}
                                                            
                                                            {/* Horizontal connector line from FFmpeg to YouTube upload */}
                                                            <div className="absolute left-[calc(50%-32px)] top-[calc(50%-10px)] w-16 h-5 pointer-events-none">
                                                                <svg viewBox="0 0 40 10" className="w-full h-full text-white/10" preserveAspectRatio="none">
                                                                    <path d="M 0,5 L 40,5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                                                                    {getNodeStatus('ffmpeg') === 'completed' && (
                                                                        <path d="M 0,5 L 40,5" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                            <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                        </path>
                                                                    )}
                                                                </svg>
                                                            </div>
                                                        </div>

                                                    </div>
                                                </>
                                            )
                                        })()}

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

                            <div 
                                ref={logsContainerRef}
                                className="h-48 md:h-64 rounded-xl border border-white/5 bg-black/60 p-4 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-2 selection:bg-[#4338CA]/30"
                            >
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
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
