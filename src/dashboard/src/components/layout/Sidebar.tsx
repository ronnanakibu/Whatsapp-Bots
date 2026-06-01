'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio,
  ListMusic,
  Settings,
  BarChart3,
  Home,
  AudioWaveform,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

interface NavItem {
  id: string;
  icon: React.ElementType;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'queue', icon: ListMusic, label: 'Queue' },
  { id: 'visualizer', icon: AudioWaveform, label: 'Visualizer' },
  { id: 'stats', icon: BarChart3, label: 'Statistics' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { sidebarExpanded, setSidebarExpanded } = useSettingsStore();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <motion.aside
      className="fixed left-0 top-0 bottom-0 z-40 flex flex-col glass"
      style={{ 
        width: sidebarExpanded ? 'var(--sidebar-expanded)' : 'var(--sidebar-width)',
        paddingBottom: 'var(--bottom-bar-height)',
      }}
      onMouseEnter={() => setSidebarExpanded(true)}
      onMouseLeave={() => setSidebarExpanded(false)}
      animate={{ width: sidebarExpanded ? 240 : 72 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.06]">
        <motion.div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'var(--accent-soft)' }}
          whileHover={{ scale: 1.1, rotate: 10 }}
          whileTap={{ scale: 0.95 }}
        >
          <Radio className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        </motion.div>
        <AnimatePresence>
          {sidebarExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden whitespace-nowrap"
            >
              <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                RonnBot Radio
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const isHovered = hoveredItem === item.id;
          const Icon = item.icon;
          
          return (
            <motion.button
              key={item.id}
              className={cn(
                'relative flex items-center gap-3 w-full rounded-xl px-3 py-2.5',
                'transition-colors duration-200 cursor-pointer',
                'outline-none focus:outline-none',
                isActive ? '' : 'hover:bg-white/[0.04]',
              )}
              onClick={() => onViewChange(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.97 }}
            >
              {/* Active indicator */}
              {isActive && (
                <motion.div
                  className="absolute inset-0 rounded-xl"
                  style={{ 
                    background: 'var(--accent-soft)',
                    border: '1px solid rgba(var(--accent-r), var(--accent-g), var(--accent-b), 0.15)',
                  }}
                  layoutId="sidebar-active"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              
              <div className="relative z-10 flex items-center justify-center w-6 h-6">
                <Icon
                  className="w-[18px] h-[18px] transition-colors"
                  style={{
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                />
              </div>
              
              <AnimatePresence>
                {sidebarExpanded && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                    className="relative z-10 text-sm whitespace-nowrap"
                    style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Hover tooltip when collapsed */}
              <AnimatePresence>
                {!sidebarExpanded && isHovered && (
                  <motion.div
                    initial={{ opacity: 0, x: -4, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -4, scale: 0.95 }}
                    className="absolute left-full ml-3 px-3 py-1.5 rounded-lg glass text-xs font-medium whitespace-nowrap z-50"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {item.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </nav>

      {/* Bottom indicator — live status */}
      <div className="px-3 py-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-3">
          <motion.div
            className="w-2 h-2 rounded-full"
            style={{ background: '#22c55e' }}
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.7, 1, 0.7],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <AnimatePresence>
            {sidebarExpanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Live Stream
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}
