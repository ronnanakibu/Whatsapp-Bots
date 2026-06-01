'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Circular audio visualizer that renders frequency data in a ring around album art.
 */
export function CircularViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const { analyzerData, isPlaying } = useRadioStore();
  const { albumColors, performanceMode } = useSettingsStore();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = performanceMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;

    ctx.clearRect(0, 0, width, height);

    const { primary, secondary, vibrant } = albumColors;
    const barCount = performanceMode ? 48 : 80;

    // Draw base circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.1)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      
      let value = 0;
      if (analyzerData && isPlaying) {
        const dataIndex = Math.floor(i * (analyzerData.length / barCount));
        value = (analyzerData[dataIndex] || 0) / 255;
      } else {
        // Idle subtle pulse
        value = 0.03 + Math.sin(Date.now() / 2000 + i * 0.2) * 0.02;
      }

      const barLength = value * radius * 0.8;
      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;
      const x2 = cx + Math.cos(angle) * (radius + barLength);
      const y2 = cy + Math.sin(angle) * (radius + barLength);

      // Color interpolation based on position
      const t = i / barCount;
      const r = Math.round(primary[0] * (1 - t) + secondary[0] * t);
      const g = Math.round(primary[1] * (1 - t) + secondary[1] * t);
      const b = Math.round(primary[2] * (1 - t) + secondary[2] * t);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + value * 0.6})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Inner bars (mirror)
      if (value > 0.1) {
        const innerLength = value * radius * 0.3;
        const x3 = cx + Math.cos(angle) * (radius - innerLength);
        const y3 = cy + Math.sin(angle) * (radius - innerLength);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x3, y3);
        ctx.strokeStyle = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${value * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [analyzerData, isPlaying, albumColors, performanceMode]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
    />
  );
}
