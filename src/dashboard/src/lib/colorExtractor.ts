export interface ExtractedColors {
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  isDark: boolean;
}

/**
 * Extract dominant colors from image
 * Used for dynamic theming based on album artwork
 */
export async function extractColorsFromImage(imageUrl: string): Promise<ExtractedColors> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(getDefaultColors());
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = sampleDominantColors(imageData);

      resolve(colors);
    };
    img.onerror = () => resolve(getDefaultColors());
    img.src = imageUrl;
  });
}

function sampleDominantColors(imageData: Uint8ClampedArray): ExtractedColors {
  const colorMap = new Map<string, number>();
  
  // Sample every 4th pixel for performance
  for (let i = 0; i < imageData.length; i += 16) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    
    // Skip very dark/light pixels
    const brightness = (r + g + b) / 3;
    if (brightness < 20 || brightness > 240) continue;
    
    const colorKey = `${r},${g},${b}`;
    colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
  }

  const sortedColors = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { r, g, b, hex: `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}` };
    });

  if (sortedColors.length === 0) {
    return getDefaultColors();
  }

  const primary = sortedColors[0].hex;
  const secondary = sortedColors[1]?.hex || sortedColors[0].hex;
  const tertiary = sortedColors[2]?.hex || sortedColors[0].hex;
  const accent = sortedColors[3]?.hex || primary;

  const isDark = sortedColors[0].r + sortedColors[0].g + sortedColors[0].b < 382;

  return { primary, secondary, tertiary, accent, isDark };
}

export function getDefaultColors(): ExtractedColors {
  return {
    primary: '#8B5CF6',
    secondary: '#3B82F6',
    tertiary: '#EC4899',
    accent: '#06B6D4',
    isDark: true,
  };
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 139, g: 92, b: 246 };
}
