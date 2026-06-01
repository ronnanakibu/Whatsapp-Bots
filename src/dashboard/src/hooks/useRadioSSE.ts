'use client';

import { useEffect } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { detectGenre, getAtmosphereForGenre } from '@/lib/musicAnalyzer';

export function useRadioSSE() {
  const {
    setNowPlaying,
    setQueue,
    setIsPlaying,
    setAtmosphere,
    setListeners,
  } = useRadioStore();

  useEffect(() => {
    const eventSource = new EventSource('/api/radio/sse');

    eventSource.addEventListener('nowplaying', (e) => {
      const data = JSON.parse(e.data);
      setNowPlaying(data);

      // Detect genre and set atmosphere
      const genre = detectGenre(data.title, data.artist);
      const atmosphere = getAtmosphereForGenre(genre);
      setAtmosphere(atmosphere);
    });

    eventSource.addEventListener('queue', (e) => {
      const data = JSON.parse(e.data);
      setQueue(data);
    });

    eventSource.addEventListener('playing', (e) => {
      const data = JSON.parse(e.data);
      setIsPlaying(data.isPlaying);
    });

    eventSource.addEventListener('listeners', (e) => {
      const data = JSON.parse(e.data);
      setListeners(data.count);
    });

    return () => {
      eventSource.close();
    };
  }, [setNowPlaying, setQueue, setIsPlaying, setAtmosphere, setListeners]);
}