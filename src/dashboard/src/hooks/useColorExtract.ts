'use client';

import { useEffect } from 'react';
import { extractColorsFromImage, hexToRgb } from '@/lib/colorExtractor';
import { useRadioStore } from '@/stores/radioStore';

export function useColorExtract(imageUrl: string | null) {
  const { setColors } = useRadioStore();

  useEffect(() => {
    if (!imageUrl) return;

    extractColorsFromImage(imageUrl).then((colors) => {
      setColors(colors);

      // Apply colors to CSS variables
      const rgb = hexToRgb(colors.primary);
      document.documentElement.style.setProperty('--accent-r', rgb.r.toString());
      document.documentElement.style.setProperty('--accent-g', rgb.g.toString());
      document.documentElement.style.setProperty('--accent-b', rgb.b.toString());

      const secondaryRgb = hexToRgb(colors.secondary);
      document.documentElement.style.setProperty('--secondary-r', secondaryRgb.r.toString());
      document.documentElement.style.setProperty('--secondary-g', secondaryRgb.g.toString());
      document.documentElement.style.setProperty('--secondary-b', secondaryRgb.b.toString());

      const tertiaryRgb = hexToRgb(colors.tertiary);
      document.documentElement.style.setProperty('--tertiary-r', tertiaryRgb.r.toString());
      document.documentElement.style.setProperty('--tertiary-g', tertiaryRgb.g.toString());
      document.documentElement.style.setProperty('--tertiary-b', tertiaryRgb.b.toString());
    });
  }, [imageUrl, setColors]);
}