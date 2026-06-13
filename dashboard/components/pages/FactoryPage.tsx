'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useDashboardStore } from '@/lib/store'

type JobStatus = 'running' | 'complete' | 'failed' | 'queued'

interface Job {
    id: string
    type: string
    label: string
    status: JobStatus
    progress?: number
    detail?: string
    ts: number
}

// Derive mock jobs from real store state
function buildJobs(state: ReturnType<typeof useDashboardStore.getState>): Job[] {
    const jobs: Job[] = []
    if (state.nowPlaying.isPlaying && state.nowPlaying.track) {
        jobs.push({
            id: 'broadcast-1', type: 'broadcast', label: state.nowPlaying.track.title,
            status: 'running', progress: 65, detail: `${state.nowPlaying.listeners} listeners`, ts: Date.now() - 60000,
        })
        jobs.push({
            id: 'ffmpeg-1', type: 'ffmpeg', label: 'FFmpeg transcode',
            status: 'running', progress: 100, detail: `${state.nowPlaying.bitrate}kbps · ${state.nowPlaying.codec}`, ts: Date.now() - 60000,
        })
    }
    (state.queue || []).slice(0, 3).forEach((t, i) => {
        jobs.push({
            id: `dl-${i}`, type: 'download', label: t.title,
            status: i === 0 ? 'queued' : 'queued', detail: 'Waiting', ts: Date.now() - i * 30000,
        })
    })
    if (jobs.length === 0) {
        jobs.push({ id: 'idle', type: 'system', label: 'Bot idle — no active jobs', status: 'complete', ts: Date.now() - 120000 })
    }
    return jobs
}

const STATUS_CONFIG: Record<JobStatus, { color: string; label: string }> = {
    running: { color: '#00D4FF', label: 'Running' },
    complete: { color: '#10B981', label: 'Done' },
    failed: { color: '#EF4444', label: 'Failed' },
    queued: { color: '#F59E0B', label: 'Queued' },
}

const TYPE_EMOJI: Record<string, string> = {
    broadcast: '📡', download: '⬇️', ffmpeg: '⚙️', search: '🔍', system: '🤖',
}

function JobRow({ job }: { job: Job }) {
    const cfg = STATUS_CONFIG[job.status]
    const emoji = TYPE_EMOJI[job.type] ?? '⚡'
    const elapsed = Math.floor((Date.now() - job.ts) / 1000)

    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}12` }}>
            <span className="text-xl flex-shrink-0">{emoji}</span>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-medium text-white/80 truncate">{job.label}</p>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `${cfg.color}15`, color: cfg.color }}>
                        {cfg.label}
                    </span>
                </div>
                {job.progress !== undefined && job.status === 'running' && (
                    <div className="h-0.5 rounded-full mb-1" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <motion.div className="h-full rounded-full"
                            animate={{ width: `${job.progress}%` }}
                            style={{ background: `linear-gradient(90deg, ${cfg.color}60, ${cfg.color})` }} />
                    </div>
                )}
                <p className="text-[10px] font-mono text-white/25">
                    {job.detail} · {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`} ago
                </p>
            </div>
        </motion.div>
    )
}

export default function FactoryPage() {
    const store = useDashboardStore()
    const jobs = buildJobs(store)
    const { accentColor, events } = store

    const recentErrors = (events || []).filter(e => e.type === 'error').slice(0, 3)

    return (
        <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="p-4 space-y-4 pb-8">
                <div className="py-2">
                    <h1 className="text-sm font-bold text-white font-mono uppercase tracking-wide">Media Factory</h1>
                    <p className="text-[11px] text-white/25 mt-0.5">Active jobs · downloads · broadcasts · failures</p>
                </div>

                {/* Factory stats */}
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: 'Active Jobs', value: jobs.filter(j => j.status === 'running').length, color: accentColor },
                        { label: 'Queued', value: jobs.filter(j => j.status === 'queued').length, color: '#F59E0B' },
                        { label: 'Failures', value: recentErrors.length, color: '#EF4444' },
                    ].map(s => (
                        <div key={s.label} className="rounded-xl p-3 text-center"
                            style={{ background: `${s.color}07`, border: `1px solid ${s.color}15` }}>
                            <p className="text-[9px] font-mono uppercase tracking-widest text-white/25">{s.label}</p>
                            <p className="text-2xl font-bold font-mono mt-0.5" style={{ color: s.color }}>{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* Job list */}
                <div className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">Active Jobs</span>
                    </div>
                    <div className="p-3 space-y-2">
                        <AnimatePresence>
                            {jobs.map(job => <JobRow key={job.id} job={job} />)}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Recent errors */}
                {recentErrors.length > 0 && (
                    <div className="rounded-2xl overflow-hidden"
                        style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                        <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(239,68,68,0.08)' }}>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-red-400/60">Recent Errors</span>
                        </div>
                        <div className="p-3 space-y-1.5">
                            {recentErrors.map(e => (
                                <div key={e.id} className="flex items-start gap-2 p-2.5 rounded-xl"
                                    style={{ background: 'rgba(239,68,68,0.06)' }}>
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded text-red-400 flex-shrink-0"
                                        style={{ background: 'rgba(239,68,68,0.15)' }}>ERR</span>
                                    <p className="text-xs text-red-300/70">{e.message}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* System throughput */}
                <div className="rounded-2xl p-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-3">Throughput</p>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Requests/hour', value: '—', color: accentColor },
                            { label: 'Downloads/hour', value: '—', color: '#10B981' },
                            { label: 'Broadcasts/hour', value: '—', color: '#8B5CF6' },
                            { label: 'Retries', value: '0', color: '#F59E0B' },
                        ].map(s => (
                            <div key={s.label}>
                                <p className="text-[9px] font-mono text-white/20 uppercase">{s.label}</p>
                                <p className="text-base font-bold font-mono mt-0.5" style={{ color: s.color }}>{s.value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}