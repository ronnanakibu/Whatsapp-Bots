export enum MusicGenre {
  SLOW = 'slow',
  EDM = 'edm',
  LOFI = 'lofi',
  ORCHESTRAL = 'orchestral',
  HIP_HOP = 'hip-hop',
  ROCK = 'rock',
  POP = 'pop',
  UNKNOWN = 'unknown',
}

export interface MusicAtmosphere {
  genre: MusicGenre;
  energy: number;
  tempo: number;
  particleIntensity: number;
  glowIntensity: number;
  particleSpeed: number;
  blurAmount: number;
  grainIntensity: number;
  visualizerStyle: 'spectrum' | 'circular' | 'waveform' | 'aurora' | 'galaxy';
}

const GENRE_KEYWORDS: Record<MusicGenre, string[]> = {
  [MusicGenre.SLOW]: ['slow', 'ballad', 'acoustic', 'chill', 'ambient', 'peaceful'],
  [MusicGenre.EDM]: ['edm', 'electronic', 'dance', 'trance', 'house', 'dubstep'],
  [MusicGenre.LOFI]: ['lofi', 'lo-fi', 'chillhop', 'beats', 'study'],
  [MusicGenre.ORCHESTRAL]: ['orchestral', 'symphony', 'classical', 'instrumental', 'epic'],
  [MusicGenre.HIP_HOP]: ['hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'rnb'],
  [MusicGenre.ROCK]: ['rock', 'metal', 'alternative', 'indie', 'punk'],
  [MusicGenre.POP]: ['pop', 'mainstream', 'top 40', 'chart'],
  [MusicGenre.UNKNOWN]: [],
};

export function detectGenre(title: string, artist: string): MusicGenre {
  const text = `${title} ${artist}`.toLowerCase();

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return genre as MusicGenre;
    }
  }

  return MusicGenre.UNKNOWN;
}

export function getAtmosphereForGenre(genre: MusicGenre): MusicAtmosphere {
  const atmospherePresets: Record<MusicGenre, MusicAtmosphere> = {
    [MusicGenre.SLOW]: {
      genre: MusicGenre.SLOW,
      energy: 0.2,
      tempo: 60,
      particleIntensity: 0.3,
      glowIntensity: 0.4,
      particleSpeed: 0.3,
      blurAmount: 15,
      grainIntensity: 0.1,
      visualizerStyle: 'aurora',
    },
    [MusicGenre.EDM]: {
      genre: MusicGenre.EDM,
      energy: 0.9,
      tempo: 130,
      particleIntensity: 1.0,
      glowIntensity: 1.0,
      particleSpeed: 2.0,
      blurAmount: 2,
      grainIntensity: 0.0,
      visualizerStyle: 'spectrum',
    },
    [MusicGenre.LOFI]: {
      genre: MusicGenre.LOFI,
      energy: 0.4,
      tempo: 85,
      particleIntensity: 0.5,
      glowIntensity: 0.6,
      particleSpeed: 0.5,
      blurAmount: 10,
      grainIntensity: 0.4,
      visualizerStyle: 'waveform',
    },
    [MusicGenre.ORCHESTRAL]: {
      genre: MusicGenre.ORCHESTRAL,
      energy: 0.6,
      tempo: 90,
      particleIntensity: 0.7,
      glowIntensity: 0.7,
      particleSpeed: 0.4,
      blurAmount: 12,
      grainIntensity: 0.15,
      visualizerStyle: 'aurora',
    },
    [MusicGenre.HIP_HOP]: {
      genre: MusicGenre.HIP_HOP,
      energy: 0.8,
      tempo: 100,
      particleIntensity: 0.8,
      glowIntensity: 0.8,
      particleSpeed: 1.5,
      blurAmount: 4,
      grainIntensity: 0.05,
      visualizerStyle: 'circular',
    },
    [MusicGenre.ROCK]: {
      genre: MusicGenre.ROCK,
      energy: 0.85,
      tempo: 120,
      particleIntensity: 0.9,
      glowIntensity: 0.9,
      particleSpeed: 1.8,
      blurAmount: 3,
      grainIntensity: 0.02,
      visualizerStyle: 'spectrum',
    },
    [MusicGenre.POP]: {
      genre: MusicGenre.POP,
      energy: 0.7,
      tempo: 110,
      particleIntensity: 0.7,
      glowIntensity: 0.7,
      particleSpeed: 1.2,
      blurAmount: 6,
      grainIntensity: 0.05,
      visualizerStyle: 'galaxy',
    },
    [MusicGenre.UNKNOWN]: {
      genre: MusicGenre.UNKNOWN,
      energy: 0.5,
      tempo: 100,
      particleIntensity: 0.5,
      glowIntensity: 0.5,
      particleSpeed: 1.0,
      blurAmount: 8,
      grainIntensity: 0.1,
      visualizerStyle: 'waveform',
    },
  };

  return atmospherePresets[genre];
}
