
import React from 'react';
import { AppProvider } from './app/store';
import { MainLayout } from './app/layout/MainLayout';
import { AppRoutes } from './app/routes';
import { AuthPage } from './modules/auth/AuthPage';
import { AppToastProvider } from './app/components/AppToastContext';

function App() {
  const token = (() => {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  })();

  if (!token) {
    return (
      <div className="fixed inset-0 z-[9999] overflow-hidden">
        <AuthPage />
      </div>
    );
  }

  return (
    <AppProvider>
      <AppToastProvider>
        <MainLayout>
          <AppRoutes />
        </MainLayout>
      </AppToastProvider>
    </AppProvider>
  );
}

export default App;
