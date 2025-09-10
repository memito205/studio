
"use client";

import { SuiteApp } from '@/components/suite-app';
import AuthLayout from '@/components/AuthLayout';
import { useTheme } from 'next-themes';

// This is the main entry point page for the application.
// The AuthLayout will wrap this and handle whether to show the login screen
// or the full application shell based on authentication state.
export default function HomePage() {
  const { theme } = useTheme();
  
  return (
      <AuthLayout>
        <SuiteApp theme={theme as 'light' | 'dark'} />
      </AuthLayout>
  );
}
