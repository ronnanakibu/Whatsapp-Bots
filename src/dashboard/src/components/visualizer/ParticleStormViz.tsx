'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/stores/radioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioManager } from '@/lib/audioManager';

interface StormParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
  isBurst?: boolean;
}

export function ParticleStormViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<StormParticle[]>([]);
  const lastBassRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array>(new Uint8Array(64));

  const { albumColors, performanceMode } = useSettingsStore();

  // 1. Particle creation helpers
  const createBaseParticle = (width: number, height: number): StormParticle => ({
    x: Math.random() * width,
    y: height + Math.random() * 20,
    vx: (Math.random() - 0.5) * 0.8,
    vy: -(Math.random() * 1.5 + 0.5),
    size: Math.random() * 3 + 1,
    opacity: Math.random() * 0.6 + 0.2,
    life: 0,
    maxLife: Math.random() * 200 + 100,
  });

  const triggerBurst = (width: number, height: number, count: number, force: number) => {
    const rx = width / 2;
    const ry = height / 2;
    const items: StormParticle[] = [];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * force * 4 + 1;
      items.push({
        x: rx,
        y: ry,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 2.5 + 0.8,
        opacity: 0.9,
        life: 0,
        maxLife: Math.random() * 60 + 20,
        isBurst: true,
      });
    }

    particlesRef.current = [...particlesRef.current, ...items].slice(0, 400); // cap particles
  };

  // 2. Draw rendering loop
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
    let bassIntensity = 0;
    let trebleIntensity = 0;

    const isPlaying = useRadioStore.getState().isPlaying;
    const hasData = audioManager.getByteFrequencyData(dataArrayRef.current);

    if (hasData && isPlaying) {
      const data = dataArrayRef.current;
      
      // Analyze bass (0-5)
      let bassSum = 0;
      for (let i = 0; i < 5; i++) bassSum += data[i];
      bassIntensity = bassSum / (255 * 5);

      // Analyze treble (15-28)
      let trebleSum = 0;
      for (let i = 15; i < 28; i++) trebleSum += data[i];
      trebleIntensity = trebleSum / (255 * 13);

      // Bass beat detection
      if (bassIntensity > 0.68 && bassIntensity - lastBassRef.current > 0.15) {
        const burstCount = performanceMode ? 20 : 60;
        triggerBurst(w, h, burstCount, bassIntensity);
      }
      lastBassRef.current = bassIntensity;
    }

    // Initialize base ambient embers
    const maxEmbers = performanceMode ? 35 : 100;
    const currentBaseEmbers = particlesRef.current.filter((p) => !p.isBurst).length;
    if (currentBaseEmbers < maxEmbers) {
      particlesRef.current.push(createBaseParticle(w, h));
    }

    const { primary, secondary, vibrant } = albumColors;

    // Draw and update each particle
    particlesRef.current = particlesRef.current.filter((p) => {
      p.life++;
      if (p.life >= p.maxLife) return false;

      // Accelerate velocities with music energy
      let speedFactor = 1;
      if (p.isBurst) {
        p.vx *= 0.95;
        p.vy *= 0.95;
      } else {
        speedFactor = 1 + bassIntensity * 2.8;
      }

      p.x += p.vx * speedFactor;
      p.y += p.vy * speedFactor;

      if (!p.isBurst) {
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
      }

      const opacityPercent = 1 - p.life / p.maxLife;
      const alpha = Math.min(p.opacity * opacityPercent * (p.isBurst ? 1 : 1.2), 1.0);

      let r, g, b;
      if (p.isBurst) {
        r = vibrant[0]; g = vibrant[1]; b = vibrant[2];
      } else {
        r = primary[0]; g = primary[1]; b = primary[2];
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.isBurst ? 1.0 : 1.0 + trebleIntensity * 0.4), 0, Math.PI * 2);
      ctx.fill();

      // High-frequency flare trails
      if (p.isBurst && alpha > 0.4 && !performanceMode) {
        ctx.shadowColor = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, 0.8)`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      return p.y > -10 && p.y < h + 30;
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
