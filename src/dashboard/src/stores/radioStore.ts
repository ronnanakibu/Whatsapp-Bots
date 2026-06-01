import { create } from 'zustand';
import type { Track, QueueTrack, RadioStatus } from '@/types/radio';

interface RadioState {
  // Playback state
  isPlaying: boolean;
  isConnected: boolean;
  isBuffering: boolean;
  volume: number;
  isMuted: boolean;
  
  // Current track
  nowPlaying: Track | null;
  
  // Queue
  queue: QueueTrack[];
  history: Track[];
  
  // Listeners
  listenerCount: number;
  
  // Effects
  activeFx: string;
  activeEq: string;
  
  // Audio analysis
  analyzerData: Uint8Array | null;
  
  // Actions
  setPlaying: (playing: boolean) => void;
  setConnected: (connected: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setNowPlaying: (track: Track | null) => void;
  setQueue: (queue: QueueTrack[]) => void;
  setHistory: (history: Track[]) => void;
  setListenerCount: (count: number) => void;
  setActiveFx: (fx: string) => void;
  setActiveEq: (eq: string) => void;
  setAnalyzerData: (data: Uint8Array) => void;
  updateFromStatus: (status: RadioStatus) => void;
}

export const useRadioStore = create<RadioState>((set) => ({
  // Initial state
  isPlaying: false,
  isConnected: false,
  isBuffering: false,
  volume: 0.8,
  isMuted: false,
  nowPlaying: null,
  queue: [],
  history: [],
  listenerCount: 0,
  activeFx: 'normal',
  activeEq: 'flat',
  analyzerData: null,
  
  // Actions
  setPlaying: (isPlaying) => set({ isPlaying }),
  setConnected: (isConnected) => set({ isConnected }),
  setBuffering: (isBuffering) => set({ isBuffering }),
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setQueue: (queue) => set({ queue }),
  setHistory: (history) => set({ history }),
  setListenerCount: (listenerCount) => set({ listenerCount }),
  setActiveFx: (activeFx) => set({ activeFx }),
  setActiveEq: (activeEq) => set({ activeEq }),
  setAnalyzerData: (analyzerData) => set({ analyzerData }),
  
  updateFromStatus: (status) => set({
    isPlaying: status.isPlaying,
    nowPlaying: status.nowPlaying,
    queue: status.queue,
    history: status.history,
    listenerCount: status.listeners,
    activeFx: status.fx,
    activeEq: status.eq,
  }),
}));
