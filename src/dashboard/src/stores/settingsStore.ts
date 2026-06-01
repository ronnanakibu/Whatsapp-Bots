import { create } from 'zustand';

interface SettingsStore {
  sidebarExpanded: boolean;
  rightPanelOpen: boolean;
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
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  sidebarExpanded: false,
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