import { create } from 'zustand';
import type { DynamicColors, VisualizerMode } from '@/types/radio';

interface SettingsState {
  // Visualizer
  visualizerMode: VisualizerMode;
  
  // Atmosphere
  immersiveBackground: boolean;
  dynamicColors: boolean;
  motionIntensity: number; // 0-1
  blurAmount: number; // 0-100
  
  // Performance
  performanceMode: boolean;
  fpsLimit: number; // 30 or 60
  
  // Dynamic colors from album art
  albumColors: DynamicColors;
  isExtractingColors: boolean;
  
  // Sidebar
  sidebarExpanded: boolean;
  
  // Right panel
  rightPanelOpen: boolean;
  
  // Actions
  setVisualizerMode: (mode: VisualizerMode) => void;
  setImmersiveBackground: (enabled: boolean) => void;
  setDynamicColors: (enabled: boolean) => void;
  setMotionIntensity: (intensity: number) => void;
  setBlurAmount: (amount: number) => void;
  setPerformanceMode: (enabled: boolean) => void;
  setFpsLimit: (fps: number) => void;
  setAlbumColors: (colors: DynamicColors) => void;
  setIsExtractingColors: (extracting: boolean) => void;
  setSidebarExpanded: (expanded: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
}

const DEFAULT_COLORS: DynamicColors = {
  primary: [139, 92, 246],    // violet
  secondary: [59, 130, 246],  // blue
  tertiary: [236, 72, 153],   // pink
  vibrant: [168, 85, 247],    // purple
  muted: [100, 116, 139],     // slate
};

export const useSettingsStore = create<SettingsState>((set) => ({
  visualizerMode: 'spectrum',
  immersiveBackground: true,
  dynamicColors: true,
  motionIntensity: 0.8,
  blurAmount: 60,
  performanceMode: false,
  fpsLimit: 60,
  albumColors: DEFAULT_COLORS,
  isExtractingColors: false,
  sidebarExpanded: false,
  rightPanelOpen: true,
  
  setVisualizerMode: (visualizerMode) => set({ visualizerMode }),
  setImmersiveBackground: (immersiveBackground) => set({ immersiveBackground }),
  setDynamicColors: (dynamicColors) => set({ dynamicColors }),
  setMotionIntensity: (motionIntensity) => set({ motionIntensity }),
  setBlurAmount: (blurAmount) => set({ blurAmount }),
  setPerformanceMode: (performanceMode) => set({ performanceMode }),
  setFpsLimit: (fpsLimit) => set({ fpsLimit }),
  setAlbumColors: (albumColors) => set({ albumColors }),
  setIsExtractingColors: (isExtractingColors) => set({ isExtractingColors }),
  setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
}));
