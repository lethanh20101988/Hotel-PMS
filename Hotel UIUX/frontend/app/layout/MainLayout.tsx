
import React from 'react';
import { Sidebar, SidebarRevealTab } from './Sidebar';
import { Header } from './Header';
import { SmartAssistant } from '@shared/components/SmartAssistant';
import { SidebarLayoutProvider, useSidebarLayout } from './sidebarLayoutContext';
import { useApp } from '../store';

interface MainLayoutProps {
  children?: React.ReactNode;
}

const MainLayoutInner = ({ children }: MainLayoutProps) => {
  const { mode, showSidebar } = useSidebarLayout();
  const { activeTab } = useApp();
  const mainPadClass = activeTab === 'accounting' ? 'p-4 sm:p-5' : 'p-8';

  return (
    <div className="flex min-h-screen flex-row overflow-x-hidden bg-slate-50 font-sans text-slate-800 print:bg-white">
      <Sidebar />
      {mode === 'hidden' && <SidebarRevealTab onOpen={showSidebar} />}
      <main
        className={`flex min-h-screen min-w-0 flex-1 flex-col overflow-x-hidden ${mainPadClass} print:max-w-none print:p-4 print:shadow-none`}
      >
        <Header />
        {children}
      </main>
      <SmartAssistant />
    </div>
  );
};

export const MainLayout = ({ children }: MainLayoutProps) => {
  return (
    <SidebarLayoutProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </SidebarLayoutProvider>
  );
};
