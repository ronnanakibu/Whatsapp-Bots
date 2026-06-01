'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { DynamicColors } from '@/types/radio';

/**
 * Extract dominant colors from album artwork using canvas.
 * Uses k-means-like color quantization for accurate palette extraction.
 */
export function useColorExtract(imageUrl: string | null) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { setAlbumColors, setIsExtractingColors, dynamicColors } = useSettingsStore();

  const extractColors = useCallback(async (url: string): Promise<DynamicColors | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
          }
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(null);

          // Scale down for performance
          const size = 64;
          canvas.width = size;
          canvas.height = size;
          ctx.drawImage(img, 0, 0, size, size);

          const imageData = ctx.getImageData(0, 0, size, size);
          const pixels = imageData.data;

          // Collect all pixel colors
          const colors: [number, number, number][] = [];
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];
            
            // Skip transparent/near-white/near-black pixels
            if (a < 128) continue;
            const brightness = (r + g + b) / 3;
            if (brightness < 15 || brightness > 240) continue;
            
            colors.push([r, g, b]);
          }

          if (colors.length === 0) return resolve(null);

          // Simple color quantization: sort by hue buckets
          const buckets = new Map<number, { sum: [number, number, number]; count: number }>();
          
          for (const [r, g, b] of colors) {
            // Create hue bucket (12 buckets)
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let hue = 0;
            if (max !== min) {
              const d = max - min;
              switch (max) {
                case r: hue = ((g - b) / d + (g < b ? 6 : 0)); break;
                case g: hue = ((b - r) / d + 2); break;
                case b: hue = ((r - g) / d + 4); break;
              }
            }
            const bucket = Math.floor(hue * 2); // 12 buckets
            
            const existing = buckets.get(bucket);
            if (existing) {
              existing.sum[0] += r;
              existing.sum[1] += g;
              existing.sum[2] += b;
              existing.count++;
            } else {
              buckets.set(bucket, { sum: [r, g, b], count: 1 });
            }
          }

          // Sort buckets by count (most dominant first)
          const sorted = [...buckets.values()]
            .sort((a, b) => b.count - a.count)
            .map(b => [
              Math.round(b.sum[0] / b.count),
              Math.round(b.sum[1] / b.count),
              Math.round(b.sum[2] / b.count),
            ] as [number, number, number]);

          // Find most vibrant (highest saturation)
          let vibrant: [number, number, number] = sorted[0];
          let maxSat = 0;
          for (const c of sorted) {
            const max2 = Math.max(...c);
            const min2 = Math.min(...c);
            const sat = max2 > 0 ? (max2 - min2) / max2 : 0;
            if (sat > maxSat) {
              maxSat = sat;
              vibrant = c;
            }
          }

          // Find most muted (lowest saturation)
          let muted: [number, number, number] = sorted[0];
          let minSat = 1;
          for (const c of sorted) {
            const max2 = Math.max(...c);
            const min2 = Math.min(...c);
            const sat = max2 > 0 ? (max2 - min2) / max2 : 0;
            if (sat < minSat) {
              minSat = sat;
              muted = c;
            }
          }

          resolve({
            primary: sorted[0] || [139, 92, 246],
            secondary: sorted[1] || sorted[0] || [59, 130, 246],
            tertiary: sorted[2] || sorted[1] || sorted[0] || [236, 72, 153],
            vibrant,
            muted,
          });
        } catch {
          resolve(null);
        }
      };

      img.onerror = () => resolve(null);
      img.src = url;
    });
  }, []);

  useEffect(() => {
    if (!imageUrl || !dynamicColors) return;
    
    setIsExtractingColors(true);
    
    extractColors(imageUrl).then((colors) => {
      if (colors) {
        setAlbumColors(colors);
      }
      setIsExtractingColors(false);
    });
  }, [imageUrl, dynamicColors, extractColors, setAlbumColors, setIsExtractingColors]);
}
