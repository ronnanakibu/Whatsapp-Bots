import { create } from 'zustand';

interface SettingsStore {
  sidebarExpanded: boolean;
  rightPanelOpen: boolean;
<<<<<<< HEAD

  // Immersive state
  developerModeOpen: boolean;
  activeView: 'home' | 'meet-dev';
  
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
  setDeveloperModeOpen: (open: boolean) => void;
  setActiveView: (view: 'home' | 'meet-dev') => void;
=======
  visualizerMode: 'spectrum' | 'circular' | 'waveform' | 'aurora' | 'galaxy' | 'particle-storm';
  developerMode: boolean;
  soundEnabled: boolean;
  theme: 'dark' | 'light';
  
  // Actions
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setVisualizerMode: (mode: any) => void;
  setDeveloperMode: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  sidebarExpanded: false,
<<<<<<< HEAD
  rightPanelOpen: true,
  developerModeOpen: false,
  activeView: 'home',
  
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
  setDeveloperModeOpen: (developerModeOpen) => set({ developerModeOpen }),
  setActiveView: (activeView) => set({ activeView }),
}));
=======
  rightPanelOpen: false,
  visualizerMode: 'spectrum',
  developerMode: false,
  soundEnabled: true,
  theme: 'dark',

  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setVisualizerMode: (mode) => set({ visualizerMode: mode }),
  setDeveloperMode: (enabled) => set({ developerMode: enabled }),
  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
  setTheme: (theme) => set({ theme }),
}));
>>>>>>> 6960750c1007a4c373cf52181fb713410b6f1e99
