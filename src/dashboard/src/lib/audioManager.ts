'use client';

import { useRadioStore } from '@/stores/radioStore';

class AudioManager {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private initialized = false;

  constructor() {
    // Perform browser checks and instantiate lazily on client-side
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.crossOrigin = 'anonymous';
      this.audio.preload = 'none';
    }
  }

  // Safe lazy initializer for Web Audio context (requires user gesture)
  public init() {
    if (this.initialized || !this.audio) return;

    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.75;

      this.source = this.ctx.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      
      this.initialized = true;
      console.log('[AudioManager] Web Audio API initialized successfully.');
    } catch (e) {
      console.warn('[AudioManager] Web Audio Context failed to initialize:', e);
    }
  }

  public connect(streamUrl: string) {
    if (!this.audio) return;
    
    this.init(); // lazy init context on click
    
    const store = useRadioStore.getState();
    store.setBuffering(true);

    // Stop current stream if already running
    this.audio.pause();
    this.audio.src = streamUrl;
    this.audio.volume = store.isMuted ? 0 : store.volume;

    // Listeners for standard state mapping
    this.audio.oncanplay = () => {
      useRadioStore.getState().setBuffering(false);
      useRadioStore.getState().setConnected(true);
    };

    this.audio.onplaying = () => {
      // Resume audio context if suspended (browser security)
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      useRadioStore.getState().setPlaying(true);
      useRadioStore.getState().setBuffering(false);
    };

    this.audio.onwaiting = () => {
      useRadioStore.getState().setBuffering(true);
    };

    this.audio.onerror = () => {
      useRadioStore.getState().setConnected(false);
      useRadioStore.getState().setPlaying(false);
      useRadioStore.getState().setBuffering(false);
      
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (this.audio && this.audio.src === streamUrl) {
          this.connect(streamUrl);
        }
      }, 3000);
    };

    this.audio.onended = () => {
      useRadioStore.getState().setPlaying(false);
      setTimeout(() => {
        if (this.audio && this.audio.src === streamUrl) {
          this.connect(streamUrl);
        }
      }, 1000);
    };

    this.audio.play().catch((err) => {
      console.warn('[AudioManager] Autoplay blocked or connection failed:', err);
      useRadioStore.getState().setBuffering(false);
    });
  }

  public disconnect() {
    if (!this.audio) return;
    
    this.audio.pause();
    this.audio.src = '';
    this.audio.load();

    const store = useRadioStore.getState();
    store.setConnected(false);
    store.setPlaying(false);
    store.setBuffering(false);
  }

  public setVolume(vol: number) {
    if (this.audio) {
      this.audio.volume = vol;
    }
  }

  // Read frequencies directly into passed array (Zero React Overhead)
  public getByteFrequencyData(array: any) {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array);
      return true;
    }
    return false;
  }

  // Extract quick real-time volume metrics for non-canvas elements (like glows)
  public getAnalyzerVolume() {
    if (!this.analyser || !useRadioStore.getState().isPlaying) {
      return { bass: 0, treble: 0, energy: 0 };
    }

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);

    // Calculate low bass energy
    let bassSum = 0;
    for (let i = 0; i < 5; i++) bassSum += data[i];
    const bass = bassSum / (255 * 5);

    // Calculate high treble/mid energy
    let trebleSum = 0;
    for (let i = 12; i < 24; i++) trebleSum += data[i];
    const treble = trebleSum / (255 * 12);

    // Total aggregate energy
    let totalSum = 0;
    for (let i = 0; i < data.length; i++) totalSum += data[i];
    const energy = totalSum / (255 * data.length);

    return { bass, treble, energy };
  }
}

export const audioManager = new AudioManager();
