'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { getRadioUrl } from '@/lib/utils';

/**
 * Hook to manage the audio stream connection to the radio backend.
 * Uses HTML5 Audio element connected to Web Audio API for visualization data.
 */
export function useRadioStream() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animFrameRef = useRef<number>(0);
  
  const {
    volume,
    isMuted,
    setConnected,
    setBuffering,
    setPlaying,
    setAnalyzerData,
  } = useRadioStore();

  // Initialize audio element
  const initAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'none';
    audioRef.current = audio;
    
    return audio;
  }, []);

  // Initialize Web Audio API for visualization
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current) return;
    
    const audio = audioRef.current;
    if (!audio) return;
    
    try {
      const ctx = new AudioContext();
      const analyzer = ctx.createAnalyser();
      analyzer.fftSize = 256;
      analyzer.smoothingTimeConstant = 0.8;
      
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyzer);
      analyzer.connect(ctx.destination);
      
      audioContextRef.current = ctx;
      analyzerRef.current = analyzer;
      sourceRef.current = source;
      
      // Start analysis loop
      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      
      const updateAnalyzer = () => {
        analyzer.getByteFrequencyData(dataArray);
        setAnalyzerData(new Uint8Array(dataArray));
        animFrameRef.current = requestAnimationFrame(updateAnalyzer);
      };
      updateAnalyzer();
    } catch (e) {
      console.warn('[RadioStream] Web Audio API init failed:', e);
    }
  }, [setAnalyzerData]);

  // Connect to stream
  const connect = useCallback(() => {
    const audio = initAudio();
    const streamUrl = `${getRadioUrl()}/stream`;
    
    setBuffering(true);
    
    audio.src = streamUrl;
    audio.volume = isMuted ? 0 : volume;
    
    audio.oncanplay = () => {
      setBuffering(false);
      setConnected(true);
    };
    
    audio.onplaying = () => {
      setPlaying(true);
      setBuffering(false);
      // Init audio context on first play (requires user gesture)
      initAudioContext();
    };
    
    audio.onwaiting = () => {
      setBuffering(true);
    };
    
    audio.onerror = () => {
      setConnected(false);
      setPlaying(false);
      setBuffering(false);
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (audioRef.current) {
          connect();
        }
      }, 3000);
    };
    
    audio.onended = () => {
      setPlaying(false);
      // Stream ended — try reconnecting
      setTimeout(() => connect(), 1000);
    };
    
    audio.play().catch(() => {
      // Autoplay blocked — user needs to interact first
      setBuffering(false);
    });
  }, [initAudio, initAudioContext, volume, isMuted, setBuffering, setConnected, setPlaying]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
    }
    
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
    }
    
    audioContextRef.current = null;
    analyzerRef.current = null;
    sourceRef.current = null;
    
    setConnected(false);
    setPlaying(false);
  }, [setConnected, setPlaying]);

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    audioRef,
    analyzerRef,
  };
}
