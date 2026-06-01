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
    addActivityEvent,
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
        addActivityEvent('System initialized: Connected to WABOT radio host', 'socket');
        addActivityEvent(`FFmpeg streaming active with ${status.listeners} listener(s)`, 'ffmpeg');
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
        addActivityEvent(`Track changed: "${track.title}"`, 'track');
        addActivityEvent(`Metadata synced (Requested by: ${track.requestedBy || 'System'})`, 'download');
      } catch (err) {
        console.warn('[SSE] Failed to parse track:start:', err);
      }
    });

    // Queue update
    es.addEventListener('queue:update', (e) => {
      try {
        const queue: QueueTrack[] = JSON.parse(e.data);
        const prevQueue = useRadioStore.getState().queue;
        setQueue(queue);
        if (queue.length > prevQueue.length) {
          const newSong = queue[queue.length - 1];
          addActivityEvent(`User requested song: "${newSong.title}"`, 'queue');
        } else if (queue.length < prevQueue.length && queue.length > 0) {
          addActivityEvent('Queue updated: song consumed', 'queue');
        } else if (queue.length === 0 && prevQueue.length > 0) {
          addActivityEvent('Queue cleared by host', 'queue');
        }
      } catch (err) {
        console.warn('[SSE] Failed to parse queue:update:', err);
      }
    });

    // Listener count
    es.addEventListener('listeners:update', (e) => {
      try {
        const { count } = JSON.parse(e.data);
        const prevCount = useRadioStore.getState().listenerCount;
        setListenerCount(count);
        if (count > prevCount) {
          addActivityEvent(`New listener joined the stream (Total: ${count})`, 'listener');
        } else if (count < prevCount) {
          addActivityEvent(`Listener left the stream (Total: ${count})`, 'listener');
        }
      } catch (err) {
        console.warn('[SSE] Failed to parse listeners:update:', err);
      }
    });

    // Radio idle
    es.addEventListener('radio:idle', () => {
      setPlaying(false);
      setNowPlaying(null);
      addActivityEvent('Radio went idle: queue is empty', 'ffmpeg');
    });

    // Radio stop
    es.addEventListener('radio:stop', () => {
      setPlaying(false);
      setNowPlaying(null);
      setQueue([]);
      addActivityEvent('Radio streaming stopped by admin', 'ffmpeg');
    });

    // FX change
    es.addEventListener('fx:change', (e) => {
      try {
        const { fx } = JSON.parse(e.data);
        setActiveFx(fx);
        addActivityEvent(`Audio filter changed to: ${fx.toUpperCase()}`, 'fx');
      } catch {}
    });

    // EQ change
    es.addEventListener('eq:change', (e) => {
      try {
        const { eq } = JSON.parse(e.data);
        setActiveEq(eq);
        addActivityEvent(`Equalizer mode adjusted to: ${eq.toUpperCase()}`, 'eq');
      } catch {}
    });

    // Connection error — auto reconnect
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      addActivityEvent('Lost host connection. Attempting to reconnect...', 'socket');
      
      // Reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    return es;
  }, [
    setNowPlaying, setQueue, setHistory, setListenerCount,
    setPlaying, setActiveFx, setActiveEq, updateFromStatus, addActivityEvent
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
