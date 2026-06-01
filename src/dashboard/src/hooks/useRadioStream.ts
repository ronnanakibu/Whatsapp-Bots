'use client';

<<<<<<< HEAD
import { useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { getRadioUrl } from '@/lib/utils';
import { audioManager } from '@/lib/audioManager';

/**
 * Lightweight React bridge to the global, non-rendering AudioManager singleton.
 * Prevents multiple audio streams from spawning and simplifies lifecycle pings.
 */
export function useRadioStream() {
  const { volume, isMuted } = useRadioStore();

  const connect = useCallback(() => {
    const streamUrl = `${getRadioUrl()}/stream`;
    audioManager.connect(streamUrl);
  }, []);

  const disconnect = useCallback(() => {
    audioManager.disconnect();
  }, []);

  // Sync volume shifts instantly to the active HTMLAudioElement
  useEffect(() => {
    const targetVol = isMuted ? 0 : volume;
    audioManager.setVolume(targetVol);
  }, [volume, isMuted]);

  return {
    connect,
    disconnect,
=======
import { useRef, useCallback } from 'react';

export function useRadioStream() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const connect = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      const audio = document.querySelector('audio') as HTMLAudioElement;
      if (audio && !sourceRef.current) {
        sourceRef.current = audioContextRef.current.createMediaElementAudioSource(audio);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      }
    }

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    }
  }, []);

  const getFrequencyData = useCallback(() => {
    if (!analyserRef.current) return new Uint8Array(0);
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    return dataArray;
  }, []);

  const getWaveformData = useCallback(() => {
    if (!analyserRef.current) return new Uint8Array(0);
    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(dataArray);
    return dataArray;
  }, []);

  return {
    connect,
    disconnect,
    getFrequencyData,
    getWaveformData,
    analyser: analyserRef.current,
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99
  };
}