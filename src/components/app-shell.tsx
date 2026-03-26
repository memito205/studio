import React, { useState } from 'react';
import { CodeCanvasLogo } from './icons';
import { DarkModeToggle } from './dark-mode-toggle';
import { useAuth } from '@/hooks/use-auth-context';
import { Button } from './ui/button';
import { auth } from '@/services/firebase';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { useInactivityGuard } from '@/hooks/useInactivityGuard';
import { PulseDialog } from './PulseDialog';
import { Badge } from './ui/badge';
import { Coffee, Play, StopCircle, Clock, ExternalLink, AlertTriangle } from 'lucide-react';

interface AppShellProps {
  title: string;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ title, children }) => {
  const { user } = useAuth();
  const { 
    status, 
    isPaused, 
    isInRemision, 
    startPause, 
    endPause, 
    punchInRemision, 
    punchOut,
    globalPulse 
  } = useSuitePulse();
  
  const { showModal, justifyInactivity } = useInactivityGuard();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleLogout = async () => {
    await auth.signOut();
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* GLOBAL PAUSE OVERLAY */}
      {isPaused && (
        <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6">
          <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Coffee className="w-12 h-12 text-primary" />
          </div>
          <h2 className="text-3xl font-bold mb-2">Operación en Pausa</h2>
          <p className="text-xl text-muted-foreground max-w-md">
            {globalPulse 
              ? `Pausa Global Activa: ${globalPulse.reason || 'Sincronización de Equipo'}`
              : `Has registrado una pausa: ${status}`}
          </p>
          {!globalPulse && (
            <Button size="lg" className="mt-8 gap-2" onClick={endPause}>
              <Play className="w-5 h-5" /> Reanudar Actividad
            </Button>
          )}
          {globalPulse && (
            <p className="mt-8 text-sm text-muted-foreground border-t pt-4">
              Espera a que un administrador reactive la operación.
            </p>
          )}
        </div>
      )}

      {/* INACTIVITY MODAL OVERLAY */}
      {showModal && !isPaused && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md p-8 rounded-2xl shadow-2xl border-2 border-primary/20 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-primary mb-4">
              <AlertTriangle className="w-8 h-8" />
              <h3 className="text-2xl font-bold">¿Sigues ahí?</h3>
            </div>
            <p className="text-muted-foreground mb-8">
              Detectamos 5 minutos de inactividad. Si estabas en un receso, por favor justifícalo para que no afecte tus indicadores.
            </p>
            <div className="grid grid-cols-1 gap-3">
              <Button size="lg" className="justify-start gap-3 h-14" onClick={() => setIsDialogOpen(true)}>
                <Coffee className="w-5 h-5" /> Registrar Pausa / Justificar
              </Button>
              <Button size="lg" variant="outline" className="justify-start gap-3 h-14" onClick={() => justifyInactivity('Otro')}>
                <Play className="w-5 h-5" /> Sigo Trabajando
              </Button>
            </div>
          </div>
        </div>
      )}

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
            
            <div className="hidden lg:flex items-center gap-4 border-x px-4">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Estado Operativo</span>
                    <Badge variant={status === 'Disponible' ? 'success' : status === 'Pausado' ? 'destructive' : 'secondary'} className="px-3 py-1">
                        {status}
                    </Badge>
                </div>
                
                <div className="flex gap-2">
                    {isInRemision ? (
                        <Button variant="outline" size="sm" className="gap-2 border-red-200 text-red-600 hover:bg-red-50" onClick={punchOut}>
                            <StopCircle className="w-4 h-4" /> Finalizar Remisión
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" className="gap-2 border-blue-200 text-blue-600 hover:bg-blue-50" onClick={punchInRemision}>
                            <ExternalLink className="w-4 h-4" /> Iniciar Remisión
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" className="gap-2" onClick={() => setIsDialogOpen(true)}>
                        <Clock className="w-4 h-4" /> Pausa
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden md:inline">{user.displayName || user.email}</span>
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

      <PulseDialog 
        isOpen={isDialogOpen} 
        onClose={() => setIsDialogOpen(false)} 
        onSelect={(reason) => {
            startPause(reason);
            setIsDialogOpen(false);
        }}
      />

      <footer className="text-center py-6 text-sm text-muted-foreground border-t mt-8">
        <p>&copy; {new Date().getFullYear()} Nexus Operativo. Todos los derechos reservados.</p>
        <p className="mt-1">Impulsado por IA para la excelencia operativa.</p>
      </footer>
    </div>
  );
};
