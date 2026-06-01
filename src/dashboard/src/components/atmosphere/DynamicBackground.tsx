'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRadioStore } from '@/stores/radioStore';

/**
 * Dynamic background that adapts to album artwork colors.
 * Creates ambient gradient orbs that breathe and transition cinematically.
 */
export function DynamicBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { albumColors, immersiveBackground, blurAmount } = useSettingsStore();
  const { nowPlaying } = useRadioStore();

  // Update CSS custom properties when colors change
  useEffect(() => {
    const root = document.documentElement;
    const { primary, secondary, tertiary } = albumColors;
    
    root.style.setProperty('--accent-r', String(primary[0]));
    root.style.setProperty('--accent-g', String(primary[1]));
    root.style.setProperty('--accent-b', String(primary[2]));
    root.style.setProperty('--secondary-r', String(secondary[0]));
    root.style.setProperty('--secondary-g', String(secondary[1]));
    root.style.setProperty('--secondary-b', String(secondary[2]));
    root.style.setProperty('--tertiary-r', String(tertiary[0]));
    root.style.setProperty('--tertiary-g', String(tertiary[1]));
    root.style.setProperty('--tertiary-b', String(tertiary[2]));
  }, [albumColors]);

  const { primary, secondary, tertiary, vibrant } = albumColors;

  return (
    <div className="atmosphere-layer" ref={containerRef}>
      {/* Main gradient orbs */}
      <div className="atmosphere-gradient" />
      
      {/* Large ambient orb - top left */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full animate-breathe"
        style={{
          top: '-10%',
          left: '-5%',
          background: `radial-gradient(circle, rgba(${primary[0]}, ${primary[1]}, ${primary[2]}, 0.15) 0%, transparent 70%)`,
          filter: `blur(${blurAmount}px)`,
          transition: 'all 2s ease-in-out',
        }}
      />
      
      {/* Secondary orb - bottom right */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full"
        style={{
          bottom: '-5%',
          right: '-5%',
          background: `radial-gradient(circle, rgba(${secondary[0]}, ${secondary[1]}, ${secondary[2]}, 0.12) 0%, transparent 70%)`,
          filter: `blur(${blurAmount * 0.8}px)`,
          transition: 'all 2.5s ease-in-out',
          animation: 'breathe 15s ease-in-out infinite reverse',
        }}
      />
      
      {/* Tertiary accent orb - center */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full"
        style={{
          top: '40%',
          left: '30%',
          background: `radial-gradient(circle, rgba(${tertiary[0]}, ${tertiary[1]}, ${tertiary[2]}, 0.08) 0%, transparent 70%)`,
          filter: `blur(${blurAmount * 0.6}px)`,
          transition: 'all 3s ease-in-out',
          animation: 'float 20s ease-in-out infinite',
        }}
      />

      {/* Vibrant spotlight - follows album mood */}
      <div
        className="absolute w-[300px] h-[300px] rounded-full"
        style={{
          top: '20%',
          right: '20%',
          background: `radial-gradient(circle, rgba(${vibrant[0]}, ${vibrant[1]}, ${vibrant[2]}, 0.06) 0%, transparent 70%)`,
          filter: `blur(${blurAmount * 0.5}px)`,
          transition: 'all 2s ease-in-out',
          animation: 'float 12s ease-in-out infinite 3s',
        }}
      />
      
      {/* Album art immersive background */}
      {immersiveBackground && nowPlaying?.thumbnail && (
        <div
          className="absolute inset-0 transition-opacity duration-[2000ms]"
          style={{
            backgroundImage: `url(${nowPlaying.thumbnail})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: `blur(${blurAmount * 1.5}px) brightness(0.3) saturate(1.2)`,
            opacity: 0.25,
            transform: 'scale(1.2)',
            animation: 'breathe 20s ease-in-out infinite',
          }}
        />
      )}
      
      {/* Vignette overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(5, 5, 8, 0.8) 100%)',
        }}
      />
      
      {/* Noise texture */}
      <div className="noise-overlay" />
    </div>
  );
}
