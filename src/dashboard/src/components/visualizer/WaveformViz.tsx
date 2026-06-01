'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Real-time waveform renderer using time-domain data.
 */
export function WaveformViz() {
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
    const midY = height / 2;

    ctx.clearRect(0, 0, width, height);

    const { primary, secondary, vibrant } = albumColors;

    // Draw center line
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.strokeStyle = `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.08)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!analyzerData || !isPlaying) {
      // Idle: subtle sine wave
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const t = Date.now() / 3000;
        const y = midY + Math.sin(x * 0.02 + t) * 3 + Math.sin(x * 0.01 + t * 1.5) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.15)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(draw);
      return;
    }

    const data = analyzerData;
    const points = data.length;
    const step = width / points;

    // Draw filled waveform
    ctx.beginPath();
    ctx.moveTo(0, midY);
    
    for (let i = 0; i < points; i++) {
      const value = (data[i] / 255 - 0.5) * 2; // Normalize to -1..1
      const x = i * step;
      const y = midY + value * height * 0.35;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Close the top path
    ctx.lineTo(width, midY);
    
    // Fill gradient
    const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
    fillGrad.addColorStop(0, `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.2)`);
    fillGrad.addColorStop(0.5, `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, 0.05)`);
    fillGrad.addColorStop(1, `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, 0.2)`);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Draw the line on top
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const value = (data[i] / 255 - 0.5) * 2;
      const x = i * step;
      const y = midY + value * height * 0.35;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    
    const lineGrad = ctx.createLinearGradient(0, 0, width, 0);
    lineGrad.addColorStop(0, `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.8)`);
    lineGrad.addColorStop(0.5, `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, 0.9)`);
    lineGrad.addColorStop(1, `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, 0.8)`);
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Mirror waveform (below center)
    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let i = 0; i < points; i++) {
      const value = (data[i] / 255 - 0.5) * 2;
      const x = i * step;
      const y = midY - value * height * 0.25;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, midY);
    
    const mirrorGrad = ctx.createLinearGradient(0, 0, 0, height);
    mirrorGrad.addColorStop(0, `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, 0.1)`);
    mirrorGrad.addColorStop(1, `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.08)`);
    ctx.fillStyle = mirrorGrad;
    ctx.fill();

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
