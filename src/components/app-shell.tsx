
"use client";

import React from 'react';
import { CodeCanvasLogo } from './icons';
import { DarkModeToggle } from './dark-mode-toggle';
import { useAuth } from '@/hooks/use-auth-context';
import { Button } from './ui/button';
import { auth } from '@/services/firebase';

interface AppShellProps {
  title: string;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ title, children }) => {
  const { user } = useAuth();

  const handleLogout = async () => {
    await auth.signOut();
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      <header className="bg-card/80 backdrop-blur-sm sticky top-0 z-20 border-b">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <CodeCanvasLogo className="w-8 h-8 text-primary" />
              <h1 className="text-xl font-bold text-foreground hidden sm:block">
                Nexus Operativo
              </h1>
              <span className="text-muted-foreground hidden sm:block">|</span>
              <span className="text-lg font-medium text-muted-foreground">{title}</span>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden md:inline">{user.email}</span>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>Cerrar Sesión</Button>
                </div>
              )}
              <DarkModeToggle />
            </div>
          </div>
        </div>
      </header>
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>
      <footer className="text-center py-6 text-sm text-muted-foreground border-t mt-8">
        <p>&copy; {new Date().getFullYear()} Nexus Operativo. Todos los derechos reservados.</p>
        <p className="mt-1">Impulsado por IA para la excelencia operativa.</p>
      </footer>
    </div>
  );
};
