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
    stage: 'idle' | 'ai_enhance' | 'suno_gen' | 'gemini_meta' | 'img_gen' | 'downloading' | 'ffmpeg' | 'youtube_upload' | 'done' | 'failed' | string
    progress: number
    logs: string[]
    youtubeUrl: string | null
    source: string
    timestamp: number
    model?: string
}

const NODES_CONFIG = [
    { id: 'ai_enhance', label: 'AI Prompt Enhancer', desc: 'Enhance prompt text for higher music aesthetics', model: 'Groq Llama 3.3', icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', glow: 'rgba(139,92,246,0.4)' },
    { id: 'suno_gen', label: 'Audio Generation', desc: 'Generate vocal & music audio tracks', model: 'Suno v3 / Stable Audio', icon: Music, color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', glow: 'rgba(236,72,153,0.4)' },
    { id: 'gemini_meta', label: 'Gemini Metadata', desc: 'Generate YouTube titles, tags & prompts', model: 'Gemini Flash 2.0', icon: FileText, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20', glow: 'rgba(56,189,248,0.4)' },
    { id: 'img_gen', label: 'Thumbnail Art Design', desc: 'Generate cover art using custom AI models', model: 'FLUX / Krea-2 / Z-Turbo', icon: Image, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', glow: 'rgba(20,184,166,0.4)' },
    { id: 'video_gen', label: 'Video Motion Generator', desc: 'Animate cover art with 3D camera pan', model: 'DreamWan v2', icon: Video, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', glow: 'rgba(99,102,241,0.4)' },
    { id: 'ffmpeg', label: 'FFmpeg Video Render', desc: 'Merge audio, video background & overlay', model: 'FFmpeg v7.0', icon: Terminal, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', glow: 'rgba(245,158,11,0.4)' },
    { id: 'youtube_upload', label: 'YouTube Cloud Upload', desc: 'Publish official music video to channel', model: 'YouTube Data API', icon: Youtube, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', glow: 'rgba(244,63,94,0.4)' }
]

const PLAYLIST_NODES_CONFIG = [
    { id: 'playlist_init', label: 'Playlist Batch Init', desc: 'Verify files, titles, and configurations', model: 'System Queue', icon: Settings, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', glow: 'rgba(139,92,246,0.4)' },
    { id: 'playlist_art', label: 'Artwork Generation', desc: 'AI Generate or verify uploaded artwork per song', model: 'FLUX / Gemini', icon: Image, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', glow: 'rgba(20,184,166,0.4)' },
    { id: 'playlist_render', label: 'FFmpeg Clip Rendering', desc: 'Build video clip with camera shake per song', model: 'FFmpeg v7.0', icon: Terminal, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', glow: 'rgba(245,158,11,0.4)' },
    { id: 'playlist_merge', label: 'Playlist Cross Dissolve', desc: 'Merge all clips with seamless MIX transitions', model: 'FFmpeg v7.0', icon: Music, color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', glow: 'rgba(236,72,153,0.4)' },
    { id: 'playlist_upload', label: 'YouTube Cloud Upload', desc: 'Publish playlist video with chapter timestamps', model: 'YouTube Data API', icon: Youtube, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', glow: 'rgba(244,63,94,0.4)' }
]

const getApiHost = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')
  }
  if (typeof window !== 'undefined') {
    const origin = window.location.origin
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      const devHost = process.env.NEXT_PUBLIC_DEV_API_URL || 'http://localhost:25637'
      return devHost.replace(/\/$/, '')
    }
    return origin
  }
  return 'http://localhost:25637'
}

const logLineColor = (log: string) => {
    if (log.includes('[Error]') || log.includes('FAILED') || log.includes('failed')) return 'text-rose-400'
    if (log.includes('[Success]') || log.includes('DONE') || log.includes('completed') || log.includes('✓')) return 'text-emerald-400'
    if (log.includes('[Warning]') || log.includes('WARN')) return 'text-amber-400'
    if (log.includes('[System]') || log.includes('[Pipeline]')) return 'text-sky-400'
    if (log.includes('[VideoGen]') || log.includes('[FFmpeg]')) return 'text-amber-300'
    if (log.includes('[Suno]') || log.includes('[Audio]')) return 'text-pink-400'
    if (log.includes('[Gemini]') || log.includes('[Meta]')) return 'text-violet-400'
    if (log.includes('[Image]') || log.includes('[Thumbnail]')) return 'text-teal-400'
    return 'text-neutral-300'
}

export default function MusicAutomationPage() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [isLoadingAuth, setIsLoadingAuth] = useState(true)
    const [prompt, setPrompt] = useState('')
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [enhance, setEnhance] = useState(true)
    const [activeJob, setActiveJob] = useState<SunoJob | null>(null)
    const [copied, setCopied] = useState(false)

    // Playlist States
    const [manualSubMode, setManualSubMode] = useState<'single' | 'playlist'>('single')
    const [playlistSongs, setPlaylistSongs] = useState<any[]>([])
    const [playlistTitle, setPlaylistTitle] = useState('')
    const [playlistDescription, setPlaylistDescription] = useState('')
    const [playlistTransition, setPlaylistTransition] = useState('dissolve')
    const [generateMotion, setGenerateMotion] = useState(false)
    const [vignetteMode, setVignetteMode] = useState<'normal' | 'dark' | 'light'>('normal')
    const playlistFileInputRef = useRef<HTMLInputElement>(null)

    const handlePlaylistFilesAdd = async (files: FileList) => {
        const newSongs = [...playlistSongs]
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            
            const tempId = Math.random().toString(36).substring(7)
            const songEntry = {
                id: tempId,
                file: file,
                audioPath: null,
                title: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
                duration: 0,
                artworkMode: 'system' as 'system' | 'generate' | 'upload',
                artworkFile: null,
                artworkPath: null,
                artworkPrompt: '',
                status: 'uploading',
                progress: 0
            }
            newSongs.push(songEntry)
            setPlaylistSongs([...newSongs])
            
            uploadPlaylistAudio(tempId, file)
        }
    }

    const uploadPlaylistAudio = async (tempId: string, file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        
        try {
            const apiBase = getApiHost()
            const xhr = new XMLHttpRequest()
            xhr.open('POST', `${apiBase}/api/music/upload-temp`)
            xhr.setRequestHeader('Authorization', 'Bearer 6285172013920_2007')
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const pct = Math.round((event.loaded / event.total) * 100)
                    setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { ...s, progress: pct } : s))
                }
            }
            
            xhr.onload = () => {
                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText)
                    if (res.success) {
                        setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { 
                            ...s, 
                            audioPath: res.file.path, 
                            duration: res.file.duration,
                            title: res.file.metadataTitle || s.title,
                            status: 'ready',
                            progress: 100
                        } : s))
                    } else {
                        setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { ...s, status: 'error' } : s))
                        toast.error(`Gagal upload ${file.name}: ${res.message}`)
                    }
                } else {
                    setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { ...s, status: 'error' } : s))
                    toast.error(`Gagal upload ${file.name}`)
                }
            }
            
            xhr.onerror = () => {
                setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { ...s, status: 'error' } : s))
                toast.error(`Koneksi terputus saat upload ${file.name}`)
            }
            
            xhr.send(formData)
        } catch (err: any) {
            setPlaylistSongs(prev => prev.map(s => s.id === tempId ? { ...s, status: 'error' } : s))
        }
    }

    const handleArtworkUpload = async (songId: string, file: File) => {
        setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkFile: file, artworkStatus: 'uploading', artworkProgress: 0 } : s))
        
        const formData = new FormData()
        formData.append('file', file)
        
        try {
            const apiBase = getApiHost()
            const xhr = new XMLHttpRequest()
            xhr.open('POST', `${apiBase}/api/music/upload-temp`)
            xhr.setRequestHeader('Authorization', 'Bearer 6285172013920_2007')
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const pct = Math.round((event.loaded / event.total) * 100)
                    setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkProgress: pct } : s))
                }
            }
            
            xhr.onload = () => {
                if (xhr.status === 200) {
                    const res = JSON.parse(xhr.responseText)
                    if (res.success) {
                        setPlaylistSongs(prev => prev.map(s => s.id === songId ? { 
                            ...s, 
                            artworkPath: res.file.path, 
                            artworkStatus: 'ready',
                            artworkProgress: 100
                        } : s))
                    } else {
                        setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkStatus: 'error' } : s))
                        toast.error(`Gagal upload artwork: ${res.message}`)
                    }
                } else {
                    setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkStatus: 'error' } : s))
                    toast.error(`Gagal upload artwork`)
                }
            }
            
            xhr.onerror = () => {
                setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkStatus: 'error' } : s))
                toast.error(`Koneksi terputus saat upload artwork`)
            }
            
            xhr.send(formData)
        } catch (err) {
            setPlaylistSongs(prev => prev.map(s => s.id === songId ? { ...s, artworkStatus: 'error' } : s))
        }
    }

    const removePlaylistSong = (id: string) => {
        setPlaylistSongs(prev => prev.filter(s => s.id !== id))
    }

    const moveSong = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return
        if (direction === 'down' && index === playlistSongs.length - 1) return
        
        const targetIdx = direction === 'up' ? index - 1 : index + 1
        const newSongs = [...playlistSongs]
        const temp = newSongs[index]
        newSongs[index] = newSongs[targetIdx]
        newSongs[targetIdx] = temp
        setPlaylistSongs(newSongs)
    }

    const playlistValidationWarnings = playlistSongs.map((song, idx) => {
        const hasTitle = song.title && song.title.trim() !== ''
        const hasPrompt = song.artworkPrompt && song.artworkPrompt.trim() !== ''
        const isUpload = song.artworkMode === 'upload'
        
        if (isUpload && !song.artworkPath) {
            return `Lagu #${idx + 1}: Silakan upload file artwork.`
        }
        if (!isUpload && !hasTitle && !hasPrompt) {
            return `Lagu #${idx + 1}: Wajib diisi Judul atau Prompt gambar.`
        }
        return null
    }).filter(Boolean) as string[]

    // Model Selector
    const [modelMode, setModelMode] = useState<'suno' | 'stable' | 'manual'>('suno')
    const [sunoProvider, setSunoProvider] = useState<'suno' | 'suno_com'>('suno')
    const [audioFile, setAudioFile] = useState<File | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [isDragActive, setIsDragActive] = useState(false)

    // Custom Lyrics Mode States
    const [isCustom, setIsCustom] = useState(false)
    const [lyrics, setLyrics] = useState('')
    const [tags, setTags] = useState('')
    const [makeInstrumental, setMakeInstrumental] = useState(false)
    const [enhanceLyrics, setEnhanceLyrics] = useState(true)

    // Thumbnail Confirmation
    const [thumbnailConfirm, setThumbnailConfirm] = useState<{
        jobId: string
        imageBase64: string
        title: string
    } | null>(null)
    const [rejectionPrompt, setRejectionPrompt] = useState('')
    const [showRejectionInput, setShowRejectionInput] = useState(false)
    const [isConfirming, setIsConfirming] = useState(false)

    const logsContainerRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const bookmarkletRef = useRef<HTMLAnchorElement>(null)
    const { socket, emit } = useSocket()

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragActive(true)
        } else if (e.type === 'dragleave') {
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
            const apiBase = getApiHost()
            const jsCode = `javascript:(function(){const c=document.cookie;fetch('${apiBase}/api/music/update-cookie', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer 6285172013920_2007'},body:JSON.stringify({cookie:c})}).then(r=>r.json()).then(d=>alert(d.success?'Suno Session Synced!':d.message)).catch(e=>alert('Error: '+e.message))})()`
            setBookmarkletUrl(jsCode)
            if (bookmarkletRef.current) {
                bookmarkletRef.current.setAttribute('href', jsCode)
            }
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
            const apiBase = getApiHost()
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
            const apiBase = getApiHost()
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

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('bot_auth_token')
            if (token === '6285172013920_2007') {
                setIsAuthenticated(true)
            }
            setIsLoadingAuth(false)
        }
    }, [])

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
        const handleThumbnailReady = (data: { jobId: string; imageBase64: string; title: string }) => {
            setThumbnailConfirm(data)
            setShowRejectionInput(false)
            setRejectionPrompt('')
            setIsConfirming(false)
        }
        socket.on('suno:status', handleStatus)
        socket.on('suno:thumbnail_ready', handleThumbnailReady)
        socket.emit('suno:get_active')
        socket.on('suno:started', (data: { jobId: string }) => {
            const isPlaylist = modelMode === 'manual' && manualSubMode === 'playlist'
            setActiveJob({
                id: data.jobId,
                prompt: isPlaylist ? `Playlist: ${playlistTitle}` : prompt,
                title: isPlaylist ? (playlistTitle || 'Untitled Playlist') : (title || 'Untitled Music'),
                status: 'running',
                stage: 'idle',
                progress: 0,
                logs: ['[System] Job initialized, waiting for pipeline activation...'],
                youtubeUrl: null,
                source: 'web',
                timestamp: Date.now(),
                model: isPlaylist ? 'playlist' : modelMode
            })
        })
        return () => {
            socket.off('suno:status', handleStatus)
            socket.off('suno:thumbnail_ready', handleThumbnailReady)
            socket.off('suno:started')
        }
    }, [socket, activeJob, prompt, title])

    useEffect(() => {
        const container = logsContainerRef.current
        if (container) {
            const threshold = 100
            const isNearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < threshold
            if (isNearBottom) {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
            }
        }
    }, [activeJob?.logs])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setAudioFile(e.target.files[0])
        }
    }

    const handleProcessPlaylist = async () => {
        console.log('[DEBUG] handleProcessPlaylist triggered. playlistSongs count:', playlistSongs.length)
        if (playlistSongs.length === 0) {
            console.log('[DEBUG] Early exit: playlistSongs is empty')
            return toast.error('Tambahkan lagu terlebih dahulu!')
        }
        if (!playlistTitle.trim()) {
            console.log('[DEBUG] Early exit: playlistTitle is empty')
            return toast.error('Judul Playlist YouTube wajib diisi!')
        }
        if (playlistValidationWarnings.length > 0) {
            console.log('[DEBUG] Early exit: playlistValidationWarnings exists', playlistValidationWarnings)
            return toast.error('Perbaiki error validasi sebelum memproses!')
        }
        
        const isAnyUploading = playlistSongs.some(s => s.status === 'uploading' || s.artworkStatus === 'uploading')
        if (isAnyUploading) {
            console.log('[DEBUG] Early exit: some files are still uploading')
            return toast.error('Tunggu semua file selesai diupload!')
        }
        
        setIsUploading(true)
        toast.loading('Memulai render playlist batch...', { id: 'playlist-gen', duration: 2500 })
        
        const songsPayload = playlistSongs.map(s => ({
            audioPath: s.audioPath,
            title: s.title || '',
            artworkMode: s.artworkMode,
            artworkPath: s.artworkPath || null,
            artworkPrompt: s.artworkPrompt || ''
        }))
        
        console.log('[DEBUG] Emitting suno:playlist_generate payload:', songsPayload)
        try {
            const apiHost = getApiHost()
            const response = await fetch(`${apiHost}/api/music/playlist-generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer 6285172013920_2007'
                },
                body: JSON.stringify({
                    songs: songsPayload,
                    outputTitle: playlistTitle.trim(),
                    playlistDescription: (playlistDescription || '').trim(),
                    transitionStyle: playlistTransition,
                    generateMotion: generateMotion,
                    vignetteMode: vignetteMode
                })
            })
            
            const res = await response.json()
            if (res.success) {
                setActiveJob({
                    id: res.jobId,
                    prompt: `Playlist: ${playlistTitle.trim()}`,
                    title: playlistTitle.trim() || 'Untitled Playlist',
                    status: 'running',
                    stage: 'idle',
                    progress: 0,
                    logs: ['[System] Job initialized, waiting for pipeline activation...'],
                    youtubeUrl: null,
                    source: 'web',
                    timestamp: Date.now(),
                    model: 'playlist'
                })
                setPlaylistSongs([])
                setPlaylistTitle('')
                toast.success('Playlist pipeline berhasil dijalankan!')
            } else {
                toast.error(`Gagal memulai: ${res.message || 'Error tidak diketahui'}`)
            }
        } catch (err: any) {
            toast.error(`Gagal memulai: ${err.message}`)
        } finally {
            setIsUploading(false)
        }
    }

    const handleGenerate = async (e: React.FormEvent) => {
        e.preventDefault()
        console.log('[DEBUG] handleGenerate triggered. modelMode:', modelMode, 'manualSubMode:', manualSubMode)
        if (modelMode === 'manual' && manualSubMode === 'playlist') {
            return handleProcessPlaylist()
        }
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
            formData.append('description', description.trim())
            try {
                const apiBase = getApiHost()
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
                model: modelMode === 'suno' ? sunoProvider : 'stable',
                isCustom,
                lyrics: lyrics.trim() || null,
                tags: tags.trim() || null,
                make_instrumental: makeInstrumental,
                enhanceLyrics,
                vignetteMode
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
                .catch(() => { fallbackCopy(text) })
        } else {
            fallbackCopy(text)
        }
    }

    const fallbackCopy = (text: string) => {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
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

    const getNodeStatus = (nodeId: string) => {
        if (!activeJob) return 'pending'
        if (activeJob.status === 'completed') return 'completed'
        const activeStage = activeJob.stage
        const activeProgress = activeJob.progress

        const isPlaylist = activeJob.model === 'playlist'
        const order = isPlaylist 
            ? ['playlist_init', 'playlist_art', 'playlist_render', 'playlist_merge', 'playlist_upload']
            : ['ai_enhance', 'suno_gen', 'gemini_meta', 'img_gen', 'video_gen', 'ffmpeg', 'youtube_upload']

        const getOrder = (id: string) => order.indexOf(id)
        const activeIdx = getOrder(activeStage)
        const currentIdx = getOrder(nodeId)

        if (activeJob.status === 'failed' && activeStage === nodeId) return 'failed'

        if (!isPlaylist) {
            if (nodeId === 'video_gen') {
                const hasStartedVideo = activeProgress >= 61 || activeJob.logs?.some(l => l.includes('[VideoGen]'))
                if (activeStage === 'img_gen') return hasStartedVideo ? 'running' : 'pending'
                return activeIdx > getOrder('img_gen') ? 'completed' : 'pending'
            }
            if (nodeId === 'img_gen') {
                const hasStartedVideo = activeProgress >= 61 || activeJob.logs?.some(l => l.includes('[VideoGen]'))
                if (activeStage === 'img_gen') return hasStartedVideo ? 'completed' : 'running'
                return activeIdx > currentIdx ? 'completed' : 'pending'
            }
        }

        if (activeIdx > currentIdx) return 'completed'
        if (activeStage === nodeId) return 'running'
        return 'pending'
    }

    // ── Loading State ──────────────────────────────────────────────
    if (isLoadingAuth) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#09090B]">
                <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                    <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-transparent border-b-violet-500/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                </div>
            </div>
        )
    }

    // ── Unauthenticated State ──────────────────────────────────────
    if (!isAuthenticated) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#09090B] text-white p-6">
                <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-500 mb-6 shadow-[0_0_40px_rgba(244,63,94,0.15)]">
                    <ShieldAlert size={48} />
                </div>
                <h1 className="text-xl font-bold tracking-tight mb-1 font-mono uppercase text-white">Access Denied</h1>
                <p className="text-xs text-neutral-500 mb-6">You don't have permission to access this page.</p>
                <Link href="/" className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl transition-colors">
                    Back to Dashboard
                </Link>
            </div>
        )
    }

    const renderNodeCard = (node: typeof NODES_CONFIG[0]) => {
        const status = getNodeStatus(node.id)
        const Icon = node.icon
        const isRunning = status === 'running'
        const isDone = status === 'completed'
        const isFailed = status === 'failed'
        const isPending = status === 'pending'

        return (
            <motion.div
                key={node.id}
                layout
                animate={isRunning ? {
                    opacity: [1, 0.85, 1],
                } : {}}
                transition={isRunning ? { repeat: Infinity, duration: 2, ease: 'easeInOut' } : {}}
                className={[
                    'relative p-3 md:p-4 rounded-xl border transition-colors duration-300 flex items-start gap-3 w-full overflow-hidden',
                    isDone ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : '',
                    isRunning ? 'border-indigo-500/60 bg-indigo-500/[0.08]' : '',
                    isFailed ? 'border-rose-500/30 bg-rose-500/[0.04]' : '',
                    isPending ? 'border-white/[0.06] bg-white/[0.01] opacity-40' : '',
                ].join(' ')}
                style={isRunning ? { boxShadow: `0 0 20px ${node.glow}` } : {}}
            >
                {/* Left accent bar */}
                <div className={[
                    'absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl',
                    isDone ? 'bg-emerald-500' : '',
                    isRunning ? 'bg-indigo-500' : '',
                    isFailed ? 'bg-rose-500' : '',
                    isPending ? 'bg-white/10' : '',
                ].join(' ')} />

                <div className={`p-2 rounded-lg border shrink-0 ${node.bg}`}>
                    <Icon size={15} className={node.color} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] md:text-[11px] font-bold font-mono text-white/90 truncate">{node.label}</span>
                        <span className={[
                            'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full border uppercase shrink-0',
                            isDone ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : '',
                            isRunning ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : '',
                            isFailed ? 'bg-rose-500/10 border-rose-500/25 text-rose-400' : '',
                            isPending ? 'bg-white/5 border-white/10 text-neutral-600' : '',
                        ].join(' ')}>
                            {status}
                        </span>
                    </div>
                    <p className="text-[9px] text-neutral-500 mt-0.5 line-clamp-1">{node.desc}</p>
                    <span className="inline-block mt-1 text-[8px] font-mono bg-white/5 border border-white/[0.08] px-1 py-0.5 rounded text-neutral-500">
                        {node.model}
                    </span>
                </div>
            </motion.div>
        )
    }

    // ── Main Render ────────────────────────────────────────────────
    return (
        <>
            {/* Google Font */}
            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                * { font-family: 'Inter', sans-serif; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 9999px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.5); }
                .glass-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
                @media (max-width: 768px) {
                    .glass-card { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(255,255,255,0.03); }
                }
                .input-base { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 0.75rem; outline: none; transition: border-color 0.2s; }
                .input-base:focus { border-color: rgba(99,102,241,0.6); }
                .input-base::placeholder { color: rgba(255,255,255,0.2); }
                .btn-primary { background: linear-gradient(135deg, #6366F1, #8B5CF6); color: #fff; font-weight: 700; border-radius: 0.75rem; border: none; cursor: pointer; transition: opacity 0.2s, transform 0.15s; }
                .btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
                .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
                .btn-green { background: linear-gradient(135deg, #10B981, #059669); color: #fff; font-weight: 700; border-radius: 0.75rem; border: none; cursor: pointer; transition: opacity 0.2s, transform 0.15s; }
                .btn-green:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
                .btn-green:disabled { opacity: 0.4; cursor: not-allowed; }
            `}</style>

            <div className="h-screen w-full bg-[#09090B] text-[#F4F4F5] overflow-x-hidden overflow-y-auto pb-16 select-none">

                {/* ── Static ambient blobs (GPU-only, fixed) ── */}
                <div aria-hidden className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                    <div className="absolute top-[-15%] left-[-10%] w-[55vw] h-[55vw] max-w-[700px] max-h-[700px] rounded-full bg-indigo-900/20 blur-[120px]" />
                    <div className="absolute bottom-[-15%] right-[-10%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full bg-violet-900/15 blur-[120px]" />
                    <div className="absolute top-[40%] right-[30%] w-[30vw] h-[30vw] max-w-[400px] max-h-[400px] rounded-full bg-sky-900/10 blur-[100px]" />
                </div>

                <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6 relative z-10 space-y-6">

                    {/* ── Header ── */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/[0.06]">
                        <div className="flex items-center gap-4">
                            <Link
                                href="/"
                                className="p-2.5 glass-card rounded-xl hover:border-indigo-500/30 hover:bg-indigo-500/5 text-neutral-500 hover:text-white transition-colors"
                                title="Back to Dashboard"
                            >
                                <ArrowLeft size={16} />
                            </Link>
                            <div>
                                <div className="flex items-center gap-2.5 mb-0.5">
                                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                                        <Music size={14} className="text-white" />
                                    </div>
                                    <h1 className="text-xl font-bold tracking-tight text-white font-mono">
                                        WABOT <span className="text-indigo-400">MUSIC</span> GEN
                                    </h1>
                                </div>
                                <p className="text-[11px] text-neutral-500">Multi-Model Audio Generation & Automation Pipeline</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-full text-[10px] text-emerald-400 font-mono self-start sm:self-auto">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>SESSION SECURED</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* ══════════════════════════════════════════
                            LEFT COLUMN — Form + Session Sync
                        ══════════════════════════════════════════ */}
                        <div className="lg:col-span-4 space-y-5">

                            {/* ── Form Card ── */}
                            <div className="glass-card rounded-2xl p-5 space-y-5 shadow-xl">

                                {/* Engine Selector */}
                                <div className="space-y-2.5">
                                    <p className="text-[10px] font-mono font-bold tracking-widest text-neutral-500 uppercase">Engine Selector</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { key: 'suno', label: 'Suno AI', icon: Music, activeColor: 'text-pink-400', activeBg: 'bg-pink-500/10 border-pink-500/50' },
                                            { key: 'stable', label: 'Stable Audio', icon: Radio, activeColor: 'text-sky-400', activeBg: 'bg-sky-500/10 border-sky-500/50' },
                                            { key: 'manual', label: 'Manual MP3', icon: UploadCloud, activeColor: 'text-emerald-400', activeBg: 'bg-emerald-500/10 border-emerald-500/50' },
                                        ].map(({ key, label, icon: Icon, activeColor, activeBg }) => {
                                            const isActive = modelMode === key
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => setModelMode(key as any)}
                                                    className={[
                                                        'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all duration-200 text-center',
                                                        isActive ? `${activeBg} text-white` : 'border-white/[0.08] bg-white/[0.02] text-neutral-500 hover:text-neutral-300 hover:border-white/15'
                                                    ].join(' ')}
                                                >
                                                    <Icon size={16} className={isActive ? activeColor : 'text-current'} />
                                                    <span className="text-[9px] font-bold leading-tight">{label}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Suno Provider Sub-Selector */}
                                {modelMode === 'suno' && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl space-y-2"
                                    >
                                        <p className="text-[9px] font-mono font-bold tracking-widest text-neutral-500 uppercase">Suno Provider</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSunoProvider('suno')}
                                                className={[
                                                    'h-9 px-3 rounded-lg border transition-all text-[10px] font-bold flex items-center justify-center gap-1.5',
                                                    sunoProvider === 'suno' ? 'bg-pink-500/10 border-pink-500/50 text-pink-400' : 'bg-white/[0.02] border-white/[0.08] text-neutral-500 hover:text-neutral-300'
                                                ].join(' ')}
                                            >
                                                <Sparkles size={11} /> Suno.org API
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSunoProvider('suno_com')}
                                                className={[
                                                    'h-9 px-3 rounded-lg border transition-all text-[10px] font-bold flex items-center justify-center gap-1.5',
                                                    sunoProvider === 'suno_com' ? 'bg-violet-500/10 border-violet-500/50 text-violet-400' : 'bg-white/[0.02] border-white/[0.08] text-neutral-500 hover:text-neutral-300'
                                                ].join(' ')}
                                            >
                                                <Music size={11} /> Suno.com
                                            </button>
                                        </div>
                                        <p className="text-[9px] text-neutral-600 leading-relaxed">
                                            {sunoProvider === 'suno'
                                                ? 'Menggunakan managed API key dari Suno.org (bebas captcha, limitasi kuota harian gratis).'
                                                : 'Menggunakan akun Clerk Suno.com milikmu (unlimited kuota, bypass captcha via sync session cookie).'}
                                        </p>
                                    </motion.div>
                                )}

                                <form onSubmit={handleGenerate} className="space-y-4">

                                    {/* Manual Audio Upload */}
                                    {modelMode === 'manual' && (
                                        <div className="space-y-4">
                                            {/* Sub-mode selector */}
                                            <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                                                <button
                                                    type="button"
                                                    onClick={() => setManualSubMode('single')}
                                                    className={[
                                                        'h-8 text-[10px] font-bold rounded-lg transition-all',
                                                        manualSubMode === 'single' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'
                                                    ].join(' ')}
                                                >
                                                    Single Track
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setManualSubMode('playlist')}
                                                    className={[
                                                        'h-8 text-[10px] font-bold rounded-lg transition-all',
                                                        manualSubMode === 'playlist' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'
                                                    ].join(' ')}
                                                >
                                                    Playlist Mode (Batch)
                                                </button>
                                            </div>

                                            {manualSubMode === 'single' ? (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Upload Audio (MP3/WAV)</label>
                                                        <div
                                                            onClick={() => fileInputRef.current?.click()}
                                                            onDragEnter={handleDrag}
                                                            onDragOver={handleDrag}
                                                            onDragLeave={handleDrag}
                                                            onDrop={handleDrop}
                                                            className={[
                                                                'w-full p-6 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-all duration-200',
                                                                isDragActive ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-white/[0.08] hover:border-indigo-500/40 hover:bg-indigo-500/[0.03]'
                                                            ].join(' ')}
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
                                                                    <Headset size={22} className="text-emerald-400" />
                                                                    <span className="text-xs text-white text-center font-medium">{audioFile.name}</span>
                                                                    <span className="text-[10px] text-neutral-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <UploadCloud size={22} className="text-neutral-600" />
                                                                    <span className="text-[11px] text-neutral-500 text-center">Click or drag MP3/WAV here</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Title Input */}
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Song Title <span className="text-neutral-700 normal-case tracking-normal">(Optional)</span></label>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. Epic Battlefield"
                                                            value={title}
                                                            onChange={e => setTitle(e.target.value)}
                                                            className="input-base w-full h-11 px-4 text-[13px]"
                                                        />
                                                    </div>

                                                    {/* Description Input */}
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-end">
                                                            <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Description <span className="text-neutral-700 normal-case tracking-normal">(Optional)</span></label>
                                                            <span className="text-[9px] font-mono text-neutral-600">{description.length}/2000</span>
                                                        </div>
                                                        <textarea
                                                            placeholder="YouTube video description, credits, hashtags..."
                                                            value={description}
                                                            onChange={e => setDescription(e.target.value)}
                                                            maxLength={2000}
                                                            rows={3}
                                                            className="input-base w-full p-3.5 text-[12px] resize-none leading-relaxed"
                                                        />
                                                    </div>

                                                    {/* Prompt Input */}
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-end">
                                                            <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Prompt Meta (Thumbnail)</label>
                                                            <span className="text-[9px] font-mono text-neutral-600">
                                                                {prompt.length}/2000
                                                            </span>
                                                        </div>
                                                        <textarea
                                                            placeholder="Enter song description for thumbnail generation..."
                                                            value={prompt}
                                                            onChange={e => setPrompt(e.target.value)}
                                                            rows={5}
                                                            className="input-base w-full p-4 text-[12px] resize-none leading-relaxed"
                                                            required
                                                        />
                                                    </div>
                                                </motion.div>
                                            ) : (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                                                    {/* Drag and Drop Zone */}
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase font-bold">Add Songs to Playlist</label>
                                                        <div
                                                            onClick={() => playlistFileInputRef.current?.click()}
                                                            onDragEnter={handleDrag}
                                                            onDragOver={handleDrag}
                                                            onDragLeave={handleDrag}
                                                            onDrop={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                setIsDragActive(false)
                                                                if (e.dataTransfer.files) handlePlaylistFilesAdd(e.dataTransfer.files)
                                                            }}
                                                            className={[
                                                                'w-full p-6 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-all duration-200',
                                                                isDragActive ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-white/[0.08] hover:border-indigo-500/40 hover:bg-indigo-500/[0.03]'
                                                            ].join(' ')}
                                                        >
                                                            <input
                                                                type="file"
                                                                multiple
                                                                accept="audio/mp3, audio/wav, audio/mpeg, audio/m4a"
                                                                className="hidden"
                                                                ref={playlistFileInputRef}
                                                                onChange={e => {
                                                                    if (e.target.files) handlePlaylistFilesAdd(e.target.files)
                                                                }}
                                                            />
                                                            <UploadCloud size={24} className="text-indigo-400" />
                                                            <span className="text-[11px] text-neutral-500 text-center font-bold">Click or drag multiple MP3/WAV here</span>
                                                            <span className="text-[9px] text-neutral-600">No limits on number of songs</span>
                                                        </div>
                                                    </div>

                                                    {/* Songs list */}
                                                    {playlistSongs.length > 0 && (
                                                        <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
                                                            {playlistSongs.map((song, index) => (
                                                                <div key={song.id} className="p-3.5 bg-white/[0.015] border border-white/[0.06] rounded-xl space-y-3 transition-colors hover:border-white/10">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className="text-[9px] font-bold font-mono px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded shrink-0">
                                                                                #{index + 1}
                                                                            </span>
                                                                            <span className="text-[11px] text-neutral-300 font-medium truncate" title={song.file?.name}>
                                                                                {song.file?.name}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1 shrink-0">
                                                                            <button
                                                                                type="button"
                                                                                disabled={index === 0}
                                                                                onClick={() => moveSong(index, 'up')}
                                                                                className="p-1 hover:bg-white/5 rounded text-neutral-500 hover:text-white disabled:opacity-20 transition-all text-xs"
                                                                                title="Move Up"
                                                                            >
                                                                                ▲
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                disabled={index === playlistSongs.length - 1}
                                                                                onClick={() => moveSong(index, 'down')}
                                                                                className="p-1 hover:bg-white/5 rounded text-neutral-500 hover:text-white disabled:opacity-20 transition-all text-xs"
                                                                                title="Move Down"
                                                                            >
                                                                                ▼
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => removePlaylistSong(song.id)}
                                                                                className="p-1 hover:bg-rose-500/15 rounded text-rose-400 hover:text-rose-300 transition-colors"
                                                                                title="Remove Song"
                                                                            >
                                                                                ✕
                                                                            </button>
                                                                        </div>
                                                                    </div>

                                                                    {/* Probing Progress & Specs */}
                                                                    <div className="flex items-center justify-between text-[9px] font-mono text-neutral-500 border-b border-white/[0.03] pb-2">
                                                                        <span>Size: {(song.file?.size / 1024 / 1024).toFixed(2)} MB</span>
                                                                        {song.status === 'uploading' ? (
                                                                            <span className="text-indigo-400 animate-pulse">Uploading ({song.progress}%)</span>
                                                                        ) : song.status === 'ready' ? (
                                                                            <span className="text-emerald-400">✓ Probed ({Math.floor(song.duration)}s)</span>
                                                                        ) : (
                                                                            <span className="text-rose-400">⚠️ Upload Error</span>
                                                                        )}
                                                                    </div>

                                                                    {/* Input Song Title */}
                                                                    <div className="space-y-1">
                                                                        <label className="text-[9px] font-mono text-neutral-500 uppercase">Song Title <span className="normal-case tracking-normal text-neutral-600">(Optional)</span></label>
                                                                        <input
                                                                            type="text"
                                                                            value={song.title}
                                                                            onChange={e => setPlaylistSongs(prev => prev.map(s => s.id === song.id ? { ...s, title: e.target.value } : s))}
                                                                            placeholder="Auto-generate title if empty"
                                                                            className="input-base w-full h-9 px-3 text-[11px]"
                                                                        />
                                                                    </div>

                                                                    {/* Artwork Source Selector */}
                                                                    <div className="space-y-1">
                                                                        <label className="text-[9px] font-mono text-neutral-500 uppercase font-bold">Artwork Mode</label>
                                                                        <div className="grid grid-cols-3 gap-1.5">
                                                                            {[
                                                                                { key: 'system', label: 'System Decide' },
                                                                                { key: 'generate', label: 'AI Prompt' },
                                                                                { key: 'upload', label: 'Upload custom' }
                                                                            ].map(opt => (
                                                                                <button
                                                                                    key={opt.key}
                                                                                    type="button"
                                                                                    onClick={() => setPlaylistSongs(prev => prev.map(s => s.id === song.id ? { ...s, artworkMode: opt.key as any } : s))}
                                                                                    className={[
                                                                                        'h-7 text-[9px] font-bold rounded-lg border transition-all',
                                                                                        song.artworkMode === opt.key 
                                                                                            ? 'bg-indigo-500/10 border-indigo-500/35 text-indigo-400' 
                                                                                            : 'border-white/[0.06] bg-white/[0.01] text-neutral-500 hover:text-neutral-300'
                                                                                    ].join(' ')}
                                                                                >
                                                                                    {opt.label}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>

                                                                    {/* Artwork Fields */}
                                                                    {song.artworkMode === 'upload' && (
                                                                        <div className="space-y-1">
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*, video/*"
                                                                                onChange={e => {
                                                                                    if (e.target.files && e.target.files[0]) {
                                                                                        handleArtworkUpload(song.id, e.target.files[0])
                                                                                    }
                                                                                }}
                                                                                className="hidden"
                                                                                id={`artwork-file-${song.id}`}
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => document.getElementById(`artwork-file-${song.id}`)?.click()}
                                                                                className="w-full h-9 border border-dashed border-white/[0.08] hover:border-indigo-500/30 rounded-lg flex items-center justify-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-all"
                                                                            >
                                                                                {song.artworkStatus === 'uploading' ? (
                                                                                    <span className="text-indigo-400">Uploading Artwork ({song.artworkProgress}%)</span>
                                                                                ) : song.artworkPath ? (
                                                                                    <span className="text-emerald-400 font-bold">✓ Artwork Ready</span>
                                                                                ) : (
                                                                                    <span>Choose Image/Video</span>
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                    )}

                                                                    {song.artworkMode === 'generate' && (
                                                                        <div className="space-y-1">
                                                                            <label className="text-[9px] font-mono text-neutral-500 uppercase">Visual Prompt</label>
                                                                            <textarea
                                                                                value={song.artworkPrompt}
                                                                                onChange={e => setPlaylistSongs(prev => prev.map(s => s.id === song.id ? { ...s, artworkPrompt: e.target.value } : s))}
                                                                                placeholder="Describe your visual concept (e.g. vintage anime bedroom, soft raining sunset vibe, 4k)..."
                                                                                rows={2}
                                                                                className="input-base w-full p-2.5 text-[11px] resize-none leading-normal"
                                                                            />
                                                                        </div>
                                                                    )}

                                                                    {/* Title/Prompt Warning Alert inside Song Card */}
                                                                    {!song.title?.trim() && !song.artworkPrompt?.trim() && song.artworkMode !== 'upload' && (
                                                                        <p className="text-[9px] text-rose-400 font-bold mt-1">⚠️ Judul atau Prompt wajib diisi agar bot bisa memproses!</p>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Overall Playlist Details */}
                                                    <div className="space-y-3 pt-3 border-t border-white/[0.05]">
                                                        {/* Overall YouTube Title */}
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase font-bold">YouTube Overall Title <span className="text-rose-500 font-bold">*</span></label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. Chill Aesthetic Beats Mix [Lofi Playlist]"
                                                                value={playlistTitle}
                                                                onChange={e => setPlaylistTitle(e.target.value)}
                                                                className="input-base w-full h-11 px-4 text-[13px]"
                                                                required={manualSubMode === 'playlist'}
                                                            />
                                                        </div>

                                                        {/* Overall Playlist Description */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-end">
                                                                <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Playlist Description <span className="text-neutral-700 normal-case tracking-normal">(Optional)</span></label>
                                                                <span className="text-[9px] font-mono text-neutral-600">{playlistDescription.length}/2000</span>
                                                            </div>
                                                            <textarea
                                                                placeholder="Intro text, credits, hashtags — appears above the tracklist timestamps..."
                                                                value={playlistDescription}
                                                                onChange={e => setPlaylistDescription(e.target.value)}
                                                                maxLength={2000}
                                                                rows={3}
                                                                className="input-base w-full p-3.5 text-[12px] resize-none leading-relaxed"
                                                            />
                                                        </div>

                                                        {/* Transition Style Selector */}
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Transition Style</label>
                                                            <div className="grid grid-cols-3 gap-2">
                                                                {[
                                                                    { key: 'dissolve', label: 'Cross Dissolve' },
                                                                    { key: 'fade', label: 'Fade Black' },
                                                                    { key: 'slide', label: 'Slide Left' }
                                                                ].map(opt => (
                                                                    <button
                                                                        key={opt.key}
                                                                        type="button"
                                                                        onClick={() => setPlaylistTransition(opt.key)}
                                                                        className={[
                                                                            'h-9 text-[10px] font-bold rounded-lg border transition-all',
                                                                            playlistTransition === opt.key 
                                                                                ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400' 
                                                                                : 'border-white/[0.06] bg-white/[0.01] text-neutral-500 hover:text-neutral-300'
                                                                        ].join(' ')}
                                                                    >
                                                                        {opt.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* LTX Motion Thumbnails Toggle */}
                                                        <div className="flex items-center justify-between border-t border-white/[0.04] pt-3 pb-1">
                                                            <div>
                                                                <p className="text-[11px] text-neutral-300 font-semibold flex items-center gap-1.5">
                                                                    <Video size={11} className="text-violet-400" />
                                                                    Motion Thumbnails (LTX)
                                                                </p>
                                                                <p className="text-[9px] text-neutral-600 mt-0.5">Animate static images into cinematic loops</p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setGenerateMotion(!generateMotion)}
                                                                className="text-neutral-500 hover:text-white transition-colors"
                                                            >
                                                                {generateMotion ? <ToggleRight className="text-violet-500 w-9.5 h-9.5" /> : <ToggleLeft className="w-9.5 h-9.5" />}
                                                            </button>
                                                        </div>

                                                        {/* Global Validation Warning List */}
                                                        {playlistValidationWarnings.length > 0 && (
                                                            <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-xl space-y-1 shadow-[0_0_15px_rgba(244,63,94,0.08)]">
                                                                <p className="text-[10px] font-bold text-rose-400 font-mono uppercase">⚠️ Validasi Gagal (Harus diperbaiki):</p>
                                                                {playlistValidationWarnings.map((warn, wIdx) => (
                                                                    <p key={wIdx} className="text-[9px] text-neutral-400 leading-tight font-medium">• {warn}</p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </div>
                                    )}

                                    {/* Custom Lyrics Mode */}
                                    {modelMode !== 'manual' && modelMode === 'suno' && (
                                        <div className="space-y-3 border-t border-white/[0.05] pt-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-[11px] text-neutral-300 font-semibold flex items-center gap-1.5">
                                                        <Music size={11} className="text-violet-400" />
                                                        Custom Lyrics Mode
                                                    </p>
                                                    <p className="text-[9px] text-neutral-600 mt-0.5">Write your own lyrics & genre</p>
                                                </div>
                                                <button type="button" onClick={() => setIsCustom(!isCustom)} className="text-neutral-500 hover:text-white transition-colors">
                                                    {isCustom ? <ToggleRight className="text-violet-500 w-9 h-9" /> : <ToggleLeft className="w-9 h-9" />}
                                                </button>
                                            </div>
                                            {isCustom && (
                                                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={makeInstrumental}
                                                            onChange={e => setMakeInstrumental(e.target.checked)}
                                                            className="rounded bg-black/40 border-white/10 text-violet-500 focus:ring-0 w-3.5 h-3.5"
                                                        />
                                                        <span className="text-[10px] text-neutral-400">Instrumental only (no vocals)</span>
                                                    </label>
                                                    {!makeInstrumental && (
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Custom Lyrics</label>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[9px] text-neutral-600">Enhance</span>
                                                                    <button type="button" onClick={() => setEnhanceLyrics(!enhanceLyrics)} className="text-neutral-500 hover:text-white transition-colors scale-75 origin-right">
                                                                        {enhanceLyrics ? <ToggleRight className="text-violet-500 w-9 h-9" /> : <ToggleLeft className="w-9 h-9" />}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <textarea
                                                                placeholder={"[Verse 1]\nWrite your lyrics here...\n\n[Chorus]\nWrite chorus..."}
                                                                value={lyrics}
                                                                onChange={e => setLyrics(e.target.value)}
                                                                rows={5}
                                                                className="input-base w-full p-4 text-[11px] resize-none leading-relaxed font-mono"
                                                                style={{ borderColor: 'rgba(139,92,246,0.2)' }}
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="space-y-1.5">
                                                        <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase">Genre / Style Tags</label>
                                                        <input
                                                            type="text"
                                                            placeholder="e.g. epic heavy metal guitar solo, fast tempo"
                                                            value={tags}
                                                            onChange={e => setTags(e.target.value)}
                                                            className="input-base w-full h-11 px-4 text-[12px]"
                                                            required={isCustom}
                                                        />
                                                    </div>
                                                </motion.div>
                                            )}
                                        </div>
                                    )}

                                    {/* AI Enhance Toggle */}
                                    {modelMode !== 'manual' && (
                                        <div className="flex items-center justify-between py-3 border-t border-white/[0.05]">
                                            <div>
                                                <p className="text-[11px] text-neutral-300 font-semibold flex items-center gap-1.5">
                                                    <Sparkles size={11} className="text-violet-400" />
                                                    AI Prompt Enhance
                                                </p>
                                                <p className="text-[9px] text-neutral-600 mt-0.5">Improve prompt quality via LLM</p>
                                            </div>
                                            <button type="button" onClick={() => setEnhance(!enhance)} className="text-neutral-500 hover:text-white transition-colors">
                                                {enhance ? <ToggleRight className="text-indigo-500 w-9 h-9" /> : <ToggleLeft className="w-9 h-9" />}
                                            </button>
                                        </div>
                                    )}

                                    {/* Vignette Mode Selector */}
                                    <div className="space-y-1.5 border-t border-white/[0.05] pt-3">
                                        <label className="text-[10px] font-mono tracking-widest text-neutral-500 uppercase font-bold">Vignette Mode</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { key: 'normal', label: '✦ Normal', desc: 'No effect' },
                                                { key: 'dark', label: '🌑 Dark', desc: 'Black border' },
                                                { key: 'light', label: '☀️ Light', desc: 'White border' }
                                            ].map(opt => (
                                                <button
                                                    key={opt.key}
                                                    type="button"
                                                    onClick={() => setVignetteMode(opt.key as 'normal' | 'dark' | 'light')}
                                                    className={[
                                                        'h-10 text-[10px] font-bold rounded-lg border transition-all flex flex-col items-center justify-center gap-0.5',
                                                        vignetteMode === opt.key
                                                            ? opt.key === 'dark'
                                                                ? 'bg-slate-800/50 border-slate-500/50 text-slate-300'
                                                                : opt.key === 'light'
                                                                    ? 'bg-amber-500/10 border-amber-500/35 text-amber-300'
                                                                    : 'bg-indigo-500/10 border-indigo-500/35 text-indigo-300'
                                                            : 'border-white/[0.06] bg-white/[0.01] text-neutral-500 hover:text-neutral-300'
                                                    ].join(' ')}
                                                >
                                                    <span>{opt.label}</span>
                                                    <span className="text-[8px] font-normal opacity-60">{opt.desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Generate Button */}
                                    <button
                                        type="submit"
                                        disabled={
                                            activeJob?.status === 'running' || 
                                            isUploading ||
                                            (modelMode === 'manual' && manualSubMode === 'playlist' && (
                                                playlistSongs.some(s => s.status === 'uploading' || s.artworkStatus === 'uploading')
                                            ))
                                        }
                                        className="btn-green w-full h-12 text-[12px] flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(16,185,129,0.25)]"
                                    >
                                        {isUploading ? (
                                            <><Loader2 size={14} className="animate-spin" /><span>Uploading...</span></>
                                        ) : activeJob?.status === 'running' ? (
                                            <><Loader2 size={14} className="animate-spin" /><span>Pipeline Active...</span></>
                                        ) : (
                                            <><Play size={12} className="fill-white" /><span>{modelMode === 'manual' ? (manualSubMode === 'playlist' ? '🚀 Process Playlist' : 'Upload & Render') : 'Generate Track'}</span></>
                                        )}
                                    </button>
                                </form>
                            </div>

                            {/* ── Session Sync Card ── */}
                            <div className="glass-card rounded-2xl p-5 space-y-4 shadow-xl">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                                        <Settings size={13} className="text-indigo-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-[11px] font-bold font-mono tracking-wider text-neutral-200">SUNO SESSION SYNC</h3>
                                        <p className="text-[9px] text-neutral-600">Session expired or blocked? Sync instantly.</p>
                                    </div>
                                </div>

                                {/* Method A */}
                                <div className="p-3.5 bg-white/[0.015] border border-white/[0.06] rounded-xl space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/15 text-indigo-400 font-mono font-bold rounded">METHOD A</span>
                                        <span className="text-[10px] font-bold text-neutral-300">Fast Bookmarklet (PC)</span>
                                    </div>
                                    <p className="text-[9px] leading-relaxed text-neutral-500">
                                        Drag the button to your Bookmark Bar. Open <a href="https://suno.com" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-bold">suno.com</a>, login, solve any captchas, then click the bookmarklet to sync!
                                    </p>
                                    <a
                                        ref={bookmarkletRef}
                                        href="#"
                                        onClick={e => { e.preventDefault(); alert('Silakan seret (drag) tombol ini ke Bookmark Bar browser Anda, jangan diklik langsung!') }}
                                        className="inline-flex items-center gap-1.5 px-3.5 h-8 bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-[10px] rounded-lg transition-colors cursor-grab active:cursor-grabbing"
                                    >
                                        + Drag to Bookmarks
                                    </a>
                                </div>

                                {/* Method B */}
                                <div className="p-3.5 bg-white/[0.015] border border-white/[0.06] rounded-xl space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-mono font-bold rounded">METHOD B</span>
                                        <span className="text-[10px] font-bold text-neutral-300">Paste Cookie Manually</span>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Paste document.cookie string here..."
                                        value={manualCookie}
                                        onChange={e => setManualCookie(e.target.value)}
                                        className="input-base w-full h-9 px-3 text-[10px] font-mono"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSyncCookie}
                                        disabled={isSyncingCookie}
                                        className="btn-green w-full h-8 text-[10px] flex items-center justify-center gap-1.5"
                                    >
                                        {isSyncingCookie ? <><Loader2 size={11} className="animate-spin" /><span>Syncing...</span></> : <span>Sync Session Cookie</span>}
                                    </button>
                                </div>

                                {/* Method C */}
                                <div className="p-3.5 bg-white/[0.015] border border-white/[0.06] rounded-xl space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-mono font-bold rounded">METHOD C</span>
                                        <span className="text-[10px] font-bold text-neutral-300">Local Proxy Tunnel URL</span>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Paste serveo/localtunnel URL here..."
                                        value={tunnelUrl}
                                        onChange={e => setTunnelUrl(e.target.value)}
                                        className="input-base w-full h-9 px-3 text-[10px] font-mono"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSyncTunnel}
                                        disabled={isSyncingTunnel}
                                        className="btn-primary w-full h-8 text-[10px] flex items-center justify-center gap-1.5"
                                    >
                                        {isSyncingTunnel ? <><Loader2 size={11} className="animate-spin" /><span>Saving...</span></> : <span>Save Tunnel URL</span>}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ══════════════════════════════════════════
                            RIGHT COLUMN — Pipeline + Terminal
                        ══════════════════════════════════════════ */}
                        <div className="lg:col-span-8 space-y-5">

                            {/* ── Pipeline Card ── */}
                            <div className="glass-card rounded-2xl p-5 md:p-6 space-y-5 shadow-xl">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                                        <Sparkles size={13} className="text-indigo-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-[11px] font-bold font-mono tracking-wider text-neutral-200">LIVE PIPELINE</h3>
                                        <p className="text-[9px] text-neutral-600">Server-side automation workflow</p>
                                    </div>
                                </div>

                                {activeJob ? (
                                    <div className="space-y-5">

                                        {/* ── THUMBNAIL CONFIRMATION PANEL ── */}
                                        <AnimatePresence>
                                            {thumbnailConfirm && (
                                                <motion.div
                                                    key="thumb-confirm"
                                                    initial={{ opacity: 0, y: -12 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -8 }}
                                                    transition={{ duration: 0.3 }}
                                                    className="rounded-2xl overflow-hidden border border-indigo-500/30"
                                                    style={{ boxShadow: '0 0 40px rgba(99,102,241,0.15)' }}
                                                >
                                                    {/* Header */}
                                                    <div className="px-4 py-3 bg-indigo-500/10 border-b border-indigo-500/20 flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                                        <span className="text-[10px] font-bold font-mono tracking-widest text-indigo-300 uppercase">Thumbnail Review Required</span>
                                                        <span className="ml-auto text-[9px] text-neutral-600 font-mono">auto-approve in 10 min</span>
                                                    </div>

                                                    {/* Thumbnail Preview */}
                                                    <div className="relative w-full bg-black">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={`data:image/png;base64,${thumbnailConfirm.imageBase64}`}
                                                            alt="Generated thumbnail preview"
                                                            className="w-full object-contain max-h-56 md:max-h-72"
                                                        />
                                                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
                                                            <p className="text-xs font-bold text-white truncate">{thumbnailConfirm.title}</p>
                                                            <p className="text-[9px] text-neutral-400 mt-0.5">Job: {thumbnailConfirm.jobId}</p>
                                                        </div>
                                                    </div>

                                                    {/* Action Area */}
                                                    <div className="p-4 space-y-3 bg-[#0d0d10]">
                                                        <p className="text-[11px] text-neutral-400 text-center">Does this thumbnail look good? Pipeline is paused waiting for your decision.</p>

                                                        {/* Reject prompt input */}
                                                        <AnimatePresence>
                                                            {showRejectionInput && (
                                                                <motion.div
                                                                    initial={{ opacity: 0, height: 0 }}
                                                                    animate={{ opacity: 1, height: 'auto' }}
                                                                    exit={{ opacity: 0, height: 0 }}
                                                                    className="space-y-2 overflow-hidden"
                                                                >
                                                                    <label className="text-[9px] font-mono tracking-widest text-neutral-500 uppercase block">New Thumbnail Prompt</label>
                                                                    <textarea
                                                                        value={rejectionPrompt}
                                                                        onChange={e => setRejectionPrompt(e.target.value)}
                                                                        placeholder="Describe the thumbnail you want instead..."
                                                                        rows={3}
                                                                        autoFocus
                                                                        className="input-base w-full p-3 text-[11px] resize-none leading-relaxed"
                                                                    />
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>

                                                        <div className="flex gap-2">
                                                            {/* Approve */}
                                                            <button
                                                                type="button"
                                                                disabled={isConfirming}
                                                                onClick={() => {
                                                                    setIsConfirming(true)
                                                                    emit('suno:confirm_thumbnail', { jobId: thumbnailConfirm.jobId, approved: true, newPrompt: null })
                                                                    setThumbnailConfirm(null)
                                                                }}
                                                                className="flex-1 h-11 btn-green text-[11px] flex items-center justify-center gap-2"
                                                            >
                                                                <CheckCircle2 size={14} />
                                                                <span>Looks Great, Continue!</span>
                                                            </button>

                                                            {/* Reject */}
                                                            {!showRejectionInput ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowRejectionInput(true)}
                                                                    className="flex-1 h-11 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-bold text-[11px] rounded-xl transition-colors flex items-center justify-center gap-2"
                                                                >
                                                                    <AlertCircle size={14} />
                                                                    <span>Regenerate</span>
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    disabled={isConfirming || !rejectionPrompt.trim()}
                                                                    onClick={() => {
                                                                        if (!rejectionPrompt.trim()) return
                                                                        setIsConfirming(true)
                                                                        emit('suno:confirm_thumbnail', { jobId: thumbnailConfirm.jobId, approved: false, newPrompt: rejectionPrompt.trim() })
                                                                        setThumbnailConfirm(null)
                                                                    }}
                                                                    className="flex-1 h-11 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 font-bold text-[11px] rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                                                >
                                                                    {isConfirming ? <Loader2 size={13} className="animate-spin" /> : <Image size={13} />}
                                                                    <span>Regen with this Prompt</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* ── Playlist Pipeline Timeline ── */}
                                        {activeJob?.model === 'playlist' ? (
                                            <div className="flex flex-col gap-4 relative py-2">
                                                <div className="absolute left-[22px] top-6 bottom-6 w-[2px] bg-white/[0.04] z-0" />
                                                {PLAYLIST_NODES_CONFIG.map(node => {
                                                    const status = getNodeStatus(node.id)
                                                    return (
                                                        <div key={node.id} className="relative z-10 pl-12">
                                                            <div className={[
                                                                'absolute left-[22px] top-6 w-3.5 h-3.5 rounded-full border-2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300',
                                                                status === 'completed' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : '',
                                                                status === 'running' ? 'bg-indigo-500 border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.6)]' : '',
                                                                status === 'failed' ? 'bg-rose-500 border-rose-400' : '',
                                                                status === 'pending' ? 'bg-[#09090B] border-white/15' : '',
                                                            ].join(' ')} />
                                                            {renderNodeCard(node)}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ) : (
                                            <>
                                                {/* ── Mobile: Vertical Timeline ── */}
                                                <div className="md:hidden flex flex-col gap-3 relative">
                                                    <div className="absolute left-[22px] top-6 bottom-6 w-[2px] bg-white/[0.04] z-0" />
                                                    {NODES_CONFIG.map(node => {
                                                        const status = getNodeStatus(node.id)
                                                        return (
                                                            <div key={node.id} className="relative z-10 pl-12">
                                                                <div className={[
                                                                    'absolute left-[22px] top-6 w-3 h-3 rounded-full border-2 -translate-x-1/2 -translate-y-1/2',
                                                                    status === 'completed' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : '',
                                                                    status === 'running' ? 'bg-indigo-500 border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.6)]' : '',
                                                                    status === 'failed' ? 'bg-rose-500 border-rose-400' : '',
                                                                    status === 'pending' ? 'bg-[#09090B] border-white/15' : '',
                                                                ].join(' ')} />
                                                                {renderNodeCard(node)}
                                                            </div>
                                                        )
                                                    })}
                                                </div>

                                                {/* ── Desktop: 2-Column Flowchart ── */}
                                                <div className="hidden md:flex flex-col items-center w-full relative py-2 max-w-4xl mx-auto gap-0">

                                                    {/* Row 1: AI Enhance */}
                                                    <div className="w-full max-w-sm">{renderNodeCard(NODES_CONFIG[0])}</div>

                                                    {/* Connector 1→2 */}
                                                    <div className="w-full h-10 flex justify-center items-center">
                                                        <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
                                                            <path d="M 50,0 L 50,20 M 50,20 L 25,20 L 25,40 M 50,20 L 75,20 L 75,40" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
                                                            {getNodeStatus('ai_enhance') === 'completed' && (<>
                                                                <path d="M 50,0 L 50,20 L 25,20 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                    <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                </path>
                                                                <path d="M 50,0 L 50,20 L 75,20 L 75,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                    <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                </path>
                                                            </>)}
                                                        </svg>
                                                    </div>

                                                    {/* Row 2: Audio + Gemini */}
                                                    <div className="grid grid-cols-2 gap-x-12 w-full">
                                                        {renderNodeCard(NODES_CONFIG[1])}
                                                        {renderNodeCard(NODES_CONFIG[2])}
                                                    </div>

                                                    {/* Connector 2→3 */}
                                                    <div className="w-full h-10 flex justify-center items-center">
                                                        <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
                                                            <path d="M 25,0 L 25,40" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
                                                            <path d="M 75,0 L 75,20 L 25,20 L 25,40 M 75,20 L 75,40" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
                                                            {getNodeStatus('suno_gen') === 'completed' && (
                                                                <path d="M 25,0 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                    <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                </path>
                                                            )}
                                                            {getNodeStatus('gemini_meta') === 'completed' && (<>
                                                                <path d="M 75,0 L 75,20 L 25,20 L 25,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                    <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                </path>
                                                                <path d="M 75,20 L 75,40" stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="4,4">
                                                                    <animate attributeName="strokeDashoffset" values="20;0" dur="1.5s" repeatCount="indefinite" />
                                                                </path>
                                                            </>)}
                                                        </svg>
                                                    </div>

                                                    {/* Row 3: Thumbnail + Video Gen */}
                                                    <div className="grid grid-cols-2 gap-x-12 w-full">
                                                        {renderNodeCard(NODES_CONFIG[3])}
                                                        {renderNodeCard(NODES_CONFIG[4])}
                                                    </div>

                                                    {/* Connector 3→4 */}
                                                    <div className="w-full h-10 flex justify-center items-center">
                                                        <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
                                                            <path d="M 25,0 L 25,40 M 75,0 L 75,20 L 50,20 L 25,20" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
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

                                                    {/* Row 4: FFmpeg + YouTube */}
                                                    <div className="grid grid-cols-2 gap-x-12 w-full relative">
                                                        {renderNodeCard(NODES_CONFIG[5])}
                                                        {renderNodeCard(NODES_CONFIG[6])}
                                                        <div className="absolute left-[calc(50%-28px)] top-[calc(50%-10px)] w-14 h-5 pointer-events-none">
                                                            <svg viewBox="0 0 40 10" className="w-full h-full" preserveAspectRatio="none">
                                                                <path d="M 0,5 L 40,5" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
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
                                        )}

                                        {/* Progress Bar */}
                                        <div className="space-y-2 pt-1">
                                            <div className="flex items-center justify-between text-[10px] font-mono">
                                                <span className="text-neutral-500">PIPELINE PROGRESS</span>
                                                <span className="text-emerald-400 font-bold tabular-nums">{activeJob.progress}%</span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                                                <motion.div
                                                    className="h-full rounded-full"
                                                    style={{ background: 'linear-gradient(90deg, #6366F1, #10B981)' }}
                                                    animate={{ width: `${activeJob.progress}%` }}
                                                    transition={{ duration: 0.5 }}
                                                />
                                            </div>
                                        </div>

                                        {/* YouTube success card */}
                                        <AnimatePresence>
                                            {activeJob.status === 'completed' && activeJob.youtubeUrl && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0 }}
                                                    className="p-5 bg-emerald-500/[0.07] border border-emerald-500/25 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4"
                                                    style={{ boxShadow: '0 0 30px rgba(16,185,129,0.08)' }}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2.5 bg-rose-500/15 border border-rose-500/25 rounded-xl">
                                                            <Youtube size={20} className="text-rose-400" />
                                                        </div>
                                                        <div>
                                                            <h4 className="text-xs font-bold text-white font-mono">UPLOAD SUCCESSFUL!</h4>
                                                            <p className="text-[10px] text-neutral-400 mt-0.5">Live on YouTube Network</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2.5 w-full md:w-auto">
                                                        <button
                                                            onClick={() => copyToClipboard(activeJob.youtubeUrl || '')}
                                                            className="flex-1 md:flex-none h-10 px-4 bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                                                        >
                                                            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                                            <span>{copied ? 'Copied' : 'Copy Link'}</span>
                                                        </button>
                                                        <a
                                                            href={activeJob.youtubeUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex-1 md:flex-none h-10 px-5 bg-white text-[#09090B] hover:bg-neutral-100 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                                                        >
                                                            <ExternalLink size={13} />
                                                            <span>Watch</span>
                                                        </a>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                ) : (
                                    /* Empty state */
                                    <div className="py-16 text-center border-2 border-dashed border-white/[0.05] rounded-xl">
                                        <div className="inline-flex p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 mb-4">
                                            <Sparkles className="w-10 h-10 text-indigo-500/40" />
                                        </div>
                                        <p className="text-sm font-bold text-neutral-400">Ready to Generate</p>
                                        <p className="text-[11px] text-neutral-600 mt-1.5 max-w-xs mx-auto leading-relaxed">
                                            Select an engine, write a prompt, and kick off the automated workflow.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* ── Terminal Card ── */}
                            <div className="rounded-2xl p-5 space-y-4 border border-white/[0.06]" style={{ background: 'rgba(0,0,0,0.55)' }}>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-rose-500/70" />
                                        <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                                        <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                                    </div>
                                    <div className="flex-1 flex items-center gap-2 ml-2">
                                        <Terminal size={12} className="text-indigo-400" />
                                        <span className="text-[10px] font-bold font-mono tracking-wider text-neutral-400">SYSTEM LOGS</span>
                                    </div>
                                    {activeJob && (
                                        <span className="text-[9px] font-mono text-neutral-600 tabular-nums">
                                            {activeJob.logs.length} lines
                                        </span>
                                    )}
                                </div>

                                <div
                                    ref={logsContainerRef}
                                    className="h-52 md:h-72 rounded-xl border border-white/[0.05] bg-black/70 p-4 font-mono text-[10px] leading-relaxed overflow-y-auto space-y-1.5"
                                >
                                    {activeJob && activeJob.logs.length > 0 ? (
                                        activeJob.logs.map((log, idx) => (
                                            <div key={idx} className={`flex items-start gap-2 ${logLineColor(log)}`}>
                                                <span className="text-neutral-700 shrink-0 select-none">{String(idx + 1).padStart(3, '0')}</span>
                                                <span className="text-indigo-500/60 shrink-0 select-none">›</span>
                                                <span className="break-all">{log}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex items-center gap-2 text-neutral-700">
                                            <span className="text-neutral-800">001</span>
                                            <span className="text-indigo-900">›</span>
                                            <span className="italic">Waiting for pipeline to start...</span>
                                            <span className="inline-block w-1.5 h-3 bg-neutral-700 animate-pulse ml-1" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
