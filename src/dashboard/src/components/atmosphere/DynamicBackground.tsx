'use client';

import { useEffect, useState, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRadioStore } from '@/stores/radioStore';
import { audioManager } from '@/lib/audioManager';

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  opacity: number;
}

export function DynamicBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  
  const { albumColors, immersiveBackground, blurAmount, performanceMode } = useSettingsStore();
  const { nowPlaying } = useRadioStore();

  const [mood, setMood] = useState<'lofi' | 'edm' | 'orchestral' | 'ambient'>('ambient');

  // 1. Detect song mood/genre based on track metadata
  useEffect(() => {
    if (!nowPlaying) {
      setMood('ambient');
      return;
    }

    const title = nowPlaying.title.toLowerCase();
    const artist = nowPlaying.requestedBy?.toLowerCase() || '';
    const query = `${title} ${artist}`;

    if (query.includes('lofi') || query.includes('lo-fi') || query.includes('chill') || query.includes('relax') || query.includes('sleep')) {
      setMood('lofi');
    } else if (query.includes('remix') || query.includes('edm') || query.includes('club') || query.includes('electronic') || query.includes('bass') || query.includes('house') || query.includes('cyber')) {
      setMood('edm');
    } else if (query.includes('orchestra') || query.includes('symphony') || query.includes('classical') || query.includes('acoustic') || query.includes('piano') || query.includes('violin') || query.includes('epic')) {
      setMood('orchestral');
    } else {
      setMood('ambient');
    }
  }, [nowPlaying]);

  // 2. Initialize particle field in a mutable ref (prevents React re-renders)
  useEffect(() => {
    const particleCount = performanceMode ? 15 : 55;
    const items: Particle[] = Array.from({ length: particleCount }).map(() => ({
      x: Math.random() * 100, // percentage x
      y: Math.random() * 100, // percentage y
      size: Math.random() * (mood === 'orchestral' ? 3.5 : 2.5) + 0.8,
      speedY: -(Math.random() * 0.3 + 0.08),
      opacity: Math.random() * 0.45 + 0.08,
    }));
    particlesRef.current = items;
  }, [mood, performanceMode]);

  // 3. Optimized direct Canvas rendering and CSS variable update loop
  useEffect(() => {
    let blurVal = blurAmount;
    let rotationAngle = 0;
    let swayX = 0;
    let swayY = 0;
    let swayDir = 1;

    const root = document.documentElement;

    const runLoop = () => {
      // Direct raw read from Web Audio analyser (NO React State overhead!)
      const { bass, treble, energy } = audioManager.getAnalyzerVolume();
      
      const bassMultiplier = 1 + bass * 0.4;
      const trebleMultiplier = 1 + treble * 0.3;

      // Sync CSS custom color variables
      const { primary, secondary, tertiary } = albumColors;
      root.style.setProperty('--accent-r', String(Math.round(primary[0] * bassMultiplier)));
      root.style.setProperty('--accent-g', String(Math.round(primary[1] * bassMultiplier)));
      root.style.setProperty('--accent-b', String(Math.round(primary[2] * bassMultiplier)));
      root.style.setProperty('--secondary-r', String(Math.round(secondary[0] * trebleMultiplier)));
      root.style.setProperty('--secondary-g', String(Math.round(secondary[1] * trebleMultiplier)));
      root.style.setProperty('--secondary-b', String(Math.round(secondary[2] * trebleMultiplier)));
      root.style.setProperty('--tertiary-r', String(tertiary[0]));
      root.style.setProperty('--tertiary-g', String(tertiary[1]));
      root.style.setProperty('--tertiary-b', String(tertiary[2]));

      // Ambiance speed factors
      let speedFactor = 1.0;
      if (mood === 'lofi') {
        speedFactor = 0.55;
        blurVal = blurAmount * 1.35;
      } else if (mood === 'edm') {
        speedFactor = 1.95 * bassMultiplier;
        blurVal = blurAmount * 0.78;
      } else if (mood === 'orchestral') {
        speedFactor = 0.65;
        blurVal = blurAmount * 1.15;
        
        // Parallax swaying container logic
        swayX += 0.018 * swayDir;
        swayY += 0.012 * swayDir;
        if (Math.abs(swayX) > 12) swayDir *= -1;
        if (containerRef.current) {
          containerRef.current.style.transform = `scale(1.04) translate(${swayX}px, ${swayY}px)`;
        }
      } else {
        speedFactor = 1.0;
        blurVal = blurAmount;
        if (containerRef.current) {
          containerRef.current.style.transform = 'none';
        }
      }

      // Rotate gradients slowly
      rotationAngle += 0.04 * speedFactor;
      root.style.setProperty('--bg-rotate', `${rotationAngle}deg`);

      // 4. Render particles on direct HTML5 2D Canvas (60fps, 0% React re-render load!)
      const canvas = canvasRef.current;
      if (canvas && !performanceMode) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          
          // Re-scale canvas if container dimension changes
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
          }

          ctx.clearRect(0, 0, w, h);

          const { vibrant } = albumColors;

          // Draw particles
          particlesRef.current.forEach((p) => {
            // Update y coordinate
            p.y += p.speedY * speedFactor;
            if (p.y < -5) {
              p.y = 105;
              p.x = Math.random() * 100;
            }

            // Convert percentages to pixels
            const px = (p.x / 100) * w;
            const py = (p.y / 100) * h;

            // Fluid color choice based on tracks
            let fillCol;
            if (mood === 'lofi') {
              fillCol = `rgba(230, 190, 150, ${p.opacity * 0.9})`;
            } else if (mood === 'edm') {
              fillCol = `rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, ${p.opacity * (0.8 + energy * 0.2)})`;
            } else {
              fillCol = `rgba(255, 255, 255, ${p.opacity})`;
            }

            ctx.fillStyle = fillCol;
            ctx.beginPath();
            ctx.arc(px, py, p.size * (1 + energy * 0.4), 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }

      animRef.current = requestAnimationFrame(runLoop);
    };

    animRef.current = requestAnimationFrame(runLoop);

    return () => cancelAnimationFrame(animRef.current);
  }, [albumColors, mood, blurAmount, performanceMode]);

  const { primary, secondary, vibrant } = albumColors;

  return (
    <div className="atmosphere-layer transition-all duration-[2000ms]" ref={containerRef}>
      {/* 1. Immersive Ambient Gradient */}
      <div 
        className="atmosphere-gradient" 
        style={{
          filter: `blur(${blurAmount}px)`,
          transform: `scale(1.1) rotate(var(--bg-rotate, 0deg))`,
        }}
      />

      {/* 2. Glow Orbs with dynamic reactive shadows */}
      <div
        className="absolute w-[650px] h-[650px] rounded-full"
        style={{
          top: '-15%',
          left: '-5%',
          background: `radial-gradient(circle, rgba(var(--accent-r), var(--accent-g), var(--accent-b), ${mood === 'edm' ? 0.22 : 0.16}) 0%, transparent 70%)`,
          filter: `blur(${blurAmount}px)`,
          transition: 'background 2s ease-in-out',
        }}
      />
      
      <div
        className="absolute w-[550px] h-[550px] rounded-full"
        style={{
          bottom: '-10%',
          right: '-5%',
          background: `radial-gradient(circle, rgba(var(--secondary-r), var(--secondary-g), var(--secondary-b), ${mood === 'edm' ? 0.18 : 0.12}) 0%, transparent 70%)`,
          filter: `blur(${blurAmount * 0.9}px)`,
          transition: 'background 2.5s ease-in-out',
          animation: 'breathe 15s ease-in-out infinite reverse',
        }}
      />

      {/* 3. High-Performance Hardware-Accelerated 2D Canvas Embers */}
      {!performanceMode && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-10 opacity-70"
          style={{ mixBlendMode: 'screen' }}
        />
      )}

      {/* 4. Film Grain Overlay (Explicitly triggered for Lo-Fi tracks) */}
      {mood === 'lofi' && <div className="film-grain" />}

      {/* 5. Album Artwork Immersive Backing Layer */}
      {immersiveBackground && nowPlaying?.thumbnail && (
        <div
          className="absolute inset-0 transition-all duration-[2000ms]"
          style={{
            backgroundImage: `url(${nowPlaying.thumbnail})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: `blur(${mood === 'lofi' ? blurAmount * 1.7 : blurAmount * 1.3}px) brightness(${mood === 'lofi' ? 0.22 : 0.28}) saturate(${mood === 'edm' ? 1.4 : 1.1})`,
            opacity: mood === 'lofi' ? 0.32 : 0.22,
            transform: 'scale(1.15)',
            animation: 'breathe 25s ease-in-out infinite',
          }}
        />
      )}
      
      {/* 6. Vignette overlay for immersive cinematic look */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 35%, rgba(5, 5, 8, 0.85) 100%)',
        }}
      />
      
      {/* 7. Fine SVG Noise Texture overlay */}
      <div className="noise-overlay" />
    </div>
  );
}
