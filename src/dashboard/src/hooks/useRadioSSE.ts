'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { getRadioUrl } from '@/lib/utils';
import type { RadioStatus, QueueTrack, Track } from '@/types/radio';

/**
 * Hook for SSE (Server-Sent Events) connection to radio backend.
 * Receives real-time updates for track changes, queue updates, listener counts.
 */
export function useRadioSSE() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const {
    setNowPlaying,
    setQueue,
    setHistory,
    setListenerCount,
    setPlaying,
    setActiveFx,
    setActiveEq,
    updateFromStatus,
  } = useRadioStore();

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${getRadioUrl()}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Initial state
    es.addEventListener('init', (e) => {
      try {
        const status: RadioStatus = JSON.parse(e.data);
        updateFromStatus(status);
      } catch (err) {
        console.warn('[SSE] Failed to parse init data:', err);
      }
    });

    // Track change
    es.addEventListener('track:start', (e) => {
      try {
        const track: Track = JSON.parse(e.data);
        setNowPlaying(track);
        setPlaying(true);
      } catch (err) {
        console.warn('[SSE] Failed to parse track:start:', err);
      }
    });

    // Queue update
    es.addEventListener('queue:update', (e) => {
      try {
        const queue: QueueTrack[] = JSON.parse(e.data);
        setQueue(queue);
      } catch (err) {
        console.warn('[SSE] Failed to parse queue:update:', err);
      }
    });

    // Listener count
    es.addEventListener('listeners:update', (e) => {
      try {
        const { count } = JSON.parse(e.data);
        setListenerCount(count);
      } catch (err) {
        console.warn('[SSE] Failed to parse listeners:update:', err);
      }
    });

    // Radio idle
    es.addEventListener('radio:idle', () => {
      setPlaying(false);
      setNowPlaying(null);
    });

    // Radio stop
    es.addEventListener('radio:stop', () => {
      setPlaying(false);
      setNowPlaying(null);
      setQueue([]);
    });

    // FX change
    es.addEventListener('fx:change', (e) => {
      try {
        const { fx } = JSON.parse(e.data);
        setActiveFx(fx);
      } catch {}
    });

    // EQ change
    es.addEventListener('eq:change', (e) => {
      try {
        const { eq } = JSON.parse(e.data);
        setActiveEq(eq);
      } catch {}
    });

    // Connection error — auto reconnect
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      
      // Reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    return es;
  }, [
    setNowPlaying, setQueue, setHistory, setListenerCount,
    setPlaying, setActiveFx, setActiveEq, updateFromStatus,
  ]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Auto-connect on mount, cleanup on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { connect, disconnect };
}
