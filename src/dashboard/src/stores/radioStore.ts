import { create } from 'zustand';
import { MusicAtmosphere } from '@/lib/musicAnalyzer';
import { ExtractedColors } from '@/lib/colorExtractor';

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