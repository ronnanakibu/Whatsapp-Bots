'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Animated audio spectrum bars visualization.
 * Uses Web Audio API frequency data to render responsive bars.
 */
export function SpectrumBars() {
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

    ctx.clearRect(0, 0, width, height);

    if (!analyzerData || !isPlaying) {
      // Draw idle state — subtle static bars
      const barCount = 48;
      const barWidth = width / barCount - 2;
      
      for (let i = 0; i < barCount; i++) {
        const barHeight = 2 + Math.random() * 3;
        const x = i * (barWidth + 2);
        const y = height - barHeight;
        
        ctx.fillStyle = `rgba(${albumColors.primary[0]}, ${albumColors.primary[1]}, ${albumColors.primary[2]}, 0.15)`;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }
      
      animFrameRef.current = requestAnimationFrame(draw);
      return;
    }

    const data = analyzerData;
    const barCount = Math.min(data.length, performanceMode ? 32 : 64);
    const barWidth = width / barCount - 2;
    const { primary, secondary, vibrant } = albumColors;

    for (let i = 0; i < barCount; i++) {
      const value = data[i] / 255;
      const barHeight = Math.max(2, value * height * 0.85);
      const x = i * (barWidth + 2);
      const y = height - barHeight;

      // Create gradient per bar
      const gradient = ctx.createLinearGradient(x, height, x, y);
      const intensity = value;

      gradient.addColorStop(0, `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, ${0.3 + intensity * 0.4})`);
      gradient.addColorStop(0.5, `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${0.2 + intensity * 0.5})`);
      gradient.addColorStop(1, `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, ${0.1 + intensity * 0.6})`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();

      // Glow effect for high-intensity bars
      if (value > 0.6) {
        ctx.shadowColor = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${value * 0.4})`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
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
      className="w-full h-full visualizer-canvas"
      style={{ imageRendering: 'auto' }}
    />
  );
}
