import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type SidebarMode = 'expanded' | 'icons' | 'hidden';

type SidebarLayoutValue = {
  mode: SidebarMode;
  setMode: (m: SidebarMode) => void;
  toggleExpandedIcons: () => void;
  hideSidebar: () => void;
  showSidebar: () => void;
};

const STORAGE_KEY = 'victory_sidebar_mode';

const SidebarLayoutContext = createContext<SidebarLayoutValue | null>(null);

export function SidebarLayoutProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<SidebarMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'icons' || v === 'hidden' || v === 'expanded') return v;
    } catch {
      /* ignore */
    }
    return 'expanded';
  });

  const lastVisibleRef = useRef<'expanded' | 'icons'>('expanded');

  useEffect(() => {
    if (mode === 'expanded' || mode === 'icons') {
      lastVisibleRef.current = mode;
    }
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const setMode = useCallback((m: SidebarMode) => {
    setModeState(m);
  }, []);

  const toggleExpandedIcons = useCallback(() => {
    setModeState(prev => {
      if (prev === 'hidden') return lastVisibleRef.current;
      return prev === 'expanded' ? 'icons' : 'expanded';
    });
  }, []);

  const hideSidebar = useCallback(() => {
    setModeState('hidden');
  }, []);

  const showSidebar = useCallback(() => {
    setModeState(lastVisibleRef.current);
  }, []);

  const value: SidebarLayoutValue = {
    mode,
    setMode,
    toggleExpandedIcons,
    hideSidebar,
    showSidebar,
  };

  return <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>;
}

export function useSidebarLayout(): SidebarLayoutValue {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) {
    throw new Error('useSidebarLayout must be used within SidebarLayoutProvider');
  }
  return ctx;
}
