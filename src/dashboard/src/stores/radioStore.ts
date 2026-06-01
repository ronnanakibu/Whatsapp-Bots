import { create } from 'zustand';
import { MusicAtmosphere } from '@/lib/musicAnalyzer';
import { ExtractedColors } from '@/lib/colorExtractor';

<<<<<<< HEAD
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
  
  // Real-time Activity Logs
  activityEvents: Array<{ id: string; text: string; type: string; timestamp: number }>;
  
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
  addActivityEvent: (text: string, type: string) => void;
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
  activityEvents: [],
  
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
  addActivityEvent: (text, type) => set((s) => ({
    activityEvents: [
      { id: Math.random().toString(36).substring(7), text, type, timestamp: Date.now() },
      ...s.activityEvents
    ].slice(0, 50)
  })),
  
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
=======
export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration: number;
  currentTime?: number;
}

interface RadioStore {
  nowPlaying: Track | null;
  queue: Track[];
  isPlaying: boolean;
  atmosphere: MusicAtmosphere | null;
  colors: ExtractedColors | null;
  listeners: number;
  
  // Actions
  setNowPlaying: (track: Track | null) => void;
  setQueue: (tracks: Track[]) => void;
  setIsPlaying: (playing: boolean) => void;
  setAtmosphere: (atmosphere: MusicAtmosphere) => void;
  setColors: (colors: ExtractedColors) => void;
  setListeners: (count: number) => void;
  updateProgress: (trackId: string, currentTime: number) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (trackId: string) => void;
}

export const useRadioStore = create<RadioStore>((set) => ({
  nowPlaying: null,
  queue: [],
  isPlaying: false,
  atmosphere: null,
  colors: null,
  listeners: 0,

  setNowPlaying: (track) => set({ nowPlaying: track }),
  setQueue: (tracks) => set({ queue: tracks }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setAtmosphere: (atmosphere) => set({ atmosphere }),
  setColors: (colors) => set({ colors }),
  setListeners: (count) => set({ listeners: count }),

  updateProgress: (trackId, currentTime) =>
    set((state) => ({
      nowPlaying: state.nowPlaying?.id === trackId
        ? { ...state.nowPlaying, currentTime }
        : state.nowPlaying,
    })),

  addToQueue: (track) =>
    set((state) => ({
      queue: [...state.queue, track],
    })),

  removeFromQueue: (trackId) =>
    set((state) => ({
      queue: state.queue.filter((t) => t.id !== trackId),
    })),
}));
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99
