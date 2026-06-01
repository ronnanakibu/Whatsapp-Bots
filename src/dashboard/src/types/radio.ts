// TypeScript interfaces for the radio dashboard

export interface Track {
  title: string;
  url: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string | null;
  requestedBy: string;
  startedAt?: number;
  playedAt?: number;
}

export interface QueueTrack extends Track {
  position: number;
}

export interface RadioStatus {
  isPlaying: boolean;
  listeners: number;
  nowPlaying: Track | null;
  queue: QueueTrack[];
  queueLength: number;
  history: Track[];
  fx: string;
  eq: string;
}

export interface SSEEvent {
  type: string;
  data: unknown;
}

export type VisualizerMode = 'spectrum' | 'circular' | 'waveform' | 'none';

export type ThemeName = 'aurora' | 'midnight' | 'glass' | 'neon' | 'cyberpunk' | 'minimal' | 'oled';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentGlow: string;
  border: string;
}

export interface DynamicColors {
  primary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
  vibrant: [number, number, number];
  muted: [number, number, number];
}
