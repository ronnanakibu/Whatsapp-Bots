'use client';

import { useEffect, useState, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRadioStore } from '@/stores/radioStore';

/**
 * Immersive, genre-adaptive dynamic atmosphere background.
 * Adapts to album art colors, track keywords, and Web Audio API real-time frequencies.
 */
export function DynamicBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const { albumColors, immersiveBackground, blurAmount, performanceMode } = useSettingsStore();
  const { nowPlaying, analyzerData, isPlaying } = useRadioStore();

  const [mood, setMood] = useState<'lofi' | 'edm' | 'orchestral' | 'ambient'>('ambient');
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; speedY: number; opacity: number }>>([]);

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

  // 2. Initialize particle field
  useEffect(() => {
    const particleCount = performanceMode ? 20 : 60;
    const items = Array.from({ length: particleCount }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * (mood === 'orchestral' ? 4 : 3) + 1,
      speedY: -(Math.random() * 0.4 + 0.1),
      opacity: Math.random() * 0.5 + 0.1,
    }));
    setParticles(items);
  }, [mood, performanceMode]);

  // 3. Main real-time Web Audio rendering loop for ambient lights and particles
  useEffect(() => {
    let scaleVal = 1;
    let blurVal = blurAmount;
    let rotationAngle = 0;
    let swayX = 0;
    let swayY = 0;
    let swayDir = 1;

    const { primary, secondary, tertiary } = albumColors;
    const root = document.documentElement;

    const runLoop = () => {
      let bassMultiplier = 1;
      let trebleMultiplier = 1;

      // Extract frequency features if audio is playing
      if (analyzerData && isPlaying) {
        // Average low-bin frequencies (bass)
        let bassSum = 0;
        for (let i = 0; i < 6; i++) bassSum += analyzerData[i];
        const avgBass = bassSum / 6;
        bassMultiplier = 1 + (avgBass / 255) * 0.4;

        // Average high-bin frequencies (treble)
        let trebleSum = 0;
        for (let i = 12; i < 24; i++) trebleSum += analyzerData[i];
        const avgTreble = trebleSum / 12;
        trebleMultiplier = 1 + (avgTreble / 255) * 0.3;
      }

      // Sync color tokens (and modulate intensities with audio data)
      root.style.setProperty('--accent-r', String(Math.round(primary[0] * bassMultiplier)));
      root.style.setProperty('--accent-g', String(Math.round(primary[1] * bassMultiplier)));
      root.style.setProperty('--accent-b', String(Math.round(primary[2] * bassMultiplier)));
      root.style.setProperty('--secondary-r', String(Math.round(secondary[0] * trebleMultiplier)));
      root.style.setProperty('--secondary-g', String(Math.round(secondary[1] * trebleMultiplier)));
      root.style.setProperty('--secondary-b', String(Math.round(secondary[2] * trebleMultiplier)));
      root.style.setProperty('--tertiary-r', String(tertiary[0]));
      root.style.setProperty('--tertiary-g', String(tertiary[1]));
      root.style.setProperty('--tertiary-b', String(tertiary[2]));

      // 4. Mood specific animation adjustments
      let speedFactor = 1;
      if (mood === 'lofi') {
        speedFactor = 0.5;
        blurVal = blurAmount * 1.3;
      } else if (mood === 'edm') {
        speedFactor = 2.0 * bassMultiplier;
        blurVal = blurAmount * 0.75;
      } else if (mood === 'orchestral') {
        speedFactor = 0.6;
        blurVal = blurAmount * 1.1;
        // Simulated slow camera movement (sway)
        swayX += 0.02 * swayDir;
        swayY += 0.015 * swayDir;
        if (Math.abs(swayX) > 15) swayDir *= -1;
        if (containerRef.current) {
          containerRef.current.style.transform = `scale(1.05) translate(${swayX}px, ${swayY}px)`;
        }
      } else {
        speedFactor = 1.0;
        blurVal = blurAmount;
        if (containerRef.current) {
          containerRef.current.style.transform = 'none';
        }
      }

      // Rotate gradients slowly
      rotationAngle += 0.05 * speedFactor;
      root.style.setProperty('--bg-rotate', `${rotationAngle}deg`);

      // Update particle positions on screen
      setParticles((prevParticles) =>
        prevParticles.map((p) => {
          let nextY = p.y + p.speedY * speedFactor;
          if (nextY < -5) {
            nextY = 105;
          }
          return { ...p, y: nextY };
        })
      );

      animRef.current = requestAnimationFrame(runLoop);
    };

    animRef.current = requestAnimationFrame(runLoop);

    return () => cancelAnimationFrame(animRef.current);
  }, [albumColors, mood, blurAmount, analyzerData, isPlaying]);

  const { primary, secondary, tertiary, vibrant } = albumColors;

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
        className="absolute w-[650px] h-[650px] rounded-full animate-breathe"
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

      {/* 3. Floating Particles / Ambient Dust Field */}
      {!performanceMode && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 opacity-70">
          {particles.map((p) => (
            <circle
              key={p.id}
              cx={`${p.x}%`}
              cy={`${p.y}%`}
              r={p.size}
              fill={`rgba(${mood === 'lofi' ? '230, 190, 150' : mood === 'edm' ? `${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}` : '255, 255, 255'}, ${p.opacity})`}
              style={{
                filter: mood === 'lofi' ? 'blur(1px)' : 'none',
                transition: 'fill 2s ease-in-out',
              }}
            />
          ))}
        </svg>
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
