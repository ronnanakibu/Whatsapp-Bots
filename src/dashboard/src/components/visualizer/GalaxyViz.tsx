'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioManager } from '@/lib/audioManager';

interface Particle {
  angle: number;
  distance: number;
  size: number;
  speed: number;
  colorOffset: number;
}

export function GalaxyViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const rotationRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array>(new Uint8Array(64));

  const { albumColors, performanceMode } = useSettingsStore();

  // 1. Initialize the galaxy spiral particles once
  useEffect(() => {
    const pCount = performanceMode ? 150 : 320;
    const items: Particle[] = [];
    const arms = 3;

    for (let i = 0; i < pCount; i++) {
      const armIndex = i % arms;
      const baseAngle = (armIndex * (Math.PI * 2)) / arms;
      
      const distance = Math.pow(Math.random(), 1.5) * 220 + 20;
      const spiralAngle = distance * 0.015;
      
      items.push({
        angle: baseAngle + spiralAngle + (Math.random() - 0.5) * 0.25,
        distance,
        size: Math.random() * 2 + 0.5,
        speed: (0.002 + Math.random() * 0.003) * (Math.random() > 0.5 ? 1 : -1),
        colorOffset: Math.random(),
      });
    }

    particlesRef.current = items;
  }, [performanceMode]);

  // 2. Draw loop
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
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Default simulation factors
    let bassMultiplier = 0.5;
    let trebleMultiplier = 0.5;
    let energy = 0;

    const isPlaying = useRadioStore.getState().isPlaying;
    const hasData = audioManager.getByteFrequencyData(dataArrayRef.current);

    if (hasData && isPlaying) {
      const data = dataArrayRef.current;
      
      // Analyze bass for rotation speed
      let bassSum = 0;
      for (let i = 0; i < 6; i++) bassSum += data[i];
      bassMultiplier = bassSum / (255 * 6);

      // Analyze treble/mids for radial displacement
      let trebleSum = 0;
      for (let i = 10; i < 26; i++) trebleSum += data[i];
      trebleMultiplier = trebleSum / (255 * 16);

      energy = (bassMultiplier + trebleMultiplier) / 2;
    }

    // Accelerate galaxy rotation based on bass energy
    rotationRef.current += 0.004 + bassMultiplier * 0.018;

    const { primary, secondary, vibrant } = albumColors;

    // Draw central black-hole star cluster glow
    const centerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 40 + energy * 80);
    centerGlow.addColorStop(0, `rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, ${0.25 + energy * 0.35})`);
    centerGlow.addColorStop(0.5, `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${0.08 + energy * 0.15})`);
    centerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = centerGlow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 120 + energy * 150, 0, Math.PI * 2);
    ctx.fill();

    // Render particles
    particlesRef.current.forEach((p) => {
      const currentAngle = p.angle + rotationRef.current;
      const dynamicDistance = p.distance * (1 + trebleMultiplier * 0.15 * p.colorOffset);

      const x = centerX + Math.cos(currentAngle) * dynamicDistance;
      const y = centerY + Math.sin(currentAngle) * dynamicDistance;

      let r, g, b;
      if (p.colorOffset > 0.6) {
        r = vibrant[0]; g = vibrant[1]; b = vibrant[2];
      } else if (p.colorOffset > 0.25) {
        r = primary[0]; g = primary[1]; b = primary[2];
      } else {
        r = secondary[0]; g = secondary[1]; b = secondary[2];
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.colorOffset * 0.4 + 0.3 + energy * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 + energy * 0.6), 0, Math.PI * 2);
      ctx.fill();

      // High energy star trails
      if (energy > 0.65 && p.colorOffset > 0.8 && !performanceMode) {
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(currentAngle) * 12 * energy, y - Math.sin(currentAngle) * 12 * energy);
        ctx.stroke();
      }
    });

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
