'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioManager } from '@/lib/audioManager';

export function AuroraViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array>(new Uint8Array(64));

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

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Default factors
    let bass = 0.3;
    let mid = 0.3;
    let treble = 0.3;

    const isPlaying = useRadioStore.getState().isPlaying;
    const hasData = audioManager.getByteFrequencyData(dataArrayRef.current);

    if (hasData && isPlaying) {
      const data = dataArrayRef.current;
      
      // Bass (indices 0 to 5)
      let bassSum = 0;
      for (let i = 0; i < 5; i++) bassSum += data[i];
      bass = bassSum / (255 * 5);

      // Mid (indices 6 to 15)
      let midSum = 0;
      for (let i = 6; i < 15; i++) midSum += data[i];
      mid = midSum / (255 * 9);

      // Treble (indices 16 to 32)
      let trebleSum = 0;
      for (let i = 16; i < 32; i++) trebleSum += data[i];
      treble = trebleSum / (255 * 16);
    }

    // Advance wave phase (speed up based on bass)
    phaseRef.current += 0.003 + bass * 0.009;

    const { primary, secondary, vibrant } = albumColors;

    // Draw overlapping auroral ribbons
    const ribbonCount = performanceMode ? 2 : 4;
    for (let r = 0; r < ribbonCount; r++) {
      ctx.beginPath();

      const amplitude = (h * 0.12) + (r * 18) + (mid * h * 0.16);
      const frequency = 0.0015 + (r * 0.0008) + (bass * 0.002);
      const verticalOffset = (h * 0.35) + (r * (h * 0.1));
      const phaseOffset = r * Math.PI * 0.35;

      let color1, color2;
      if (r % 3 === 0) {
        color1 = `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0)`;
        color2 = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${0.12 + treble * 0.18})`;
      } else if (r % 3 === 1) {
        color1 = `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, 0)`;
        color2 = `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, ${0.1 + mid * 0.12})`;
      } else {
        color1 = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, 0)`;
        color2 = `rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, ${0.08 + treble * 0.15})`;
      }

      for (let x = 0; x <= w; x += 10) {
        const y = verticalOffset + 
                  Math.sin(x * frequency + phaseRef.current + phaseOffset) * amplitude +
                  Math.cos(x * frequency * 1.5 - phaseRef.current * 0.6) * (amplitude * 0.3);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      const gradient = ctx.createLinearGradient(0, verticalOffset - amplitude, 0, verticalOffset + amplitude);
      gradient.addColorStop(0, color1);
      gradient.addColorStop(0.5, color2);
      gradient.addColorStop(1, color1);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 14 + r * 10 + treble * 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (!performanceMode) {
        ctx.shadowColor = color2.replace(/,\s*[0-9.]+\)$/, ', 0.45)');
        ctx.shadowBlur = 30;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [albumColors, performanceMode]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0 visualizer-canvas"
    />
  );
}
