
"use client";

import React from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/hooks/use-auth-context';
import { Loader2 } from 'lucide-react';
import LoginPage from '@/components/login/LoginPage';
import { useTheme } from 'next-themes';

// This is the main layout component that wraps the entire application.
// It handles theme switching and authentication state to decide what to render.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  // Show a loading spinner while checking authentication state.
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // If the user is not authenticated, show the LoginPage.
  if (!user) {
    return <LoginPage />;
  }

  // If the user is authenticated, render the main application shell with the children.
  return (
    <AppShell title="Suite Logística">
      {children}
    </AppShell>
  );
}
