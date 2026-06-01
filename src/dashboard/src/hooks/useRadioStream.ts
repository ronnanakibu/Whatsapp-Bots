'use client';

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
  };
}
