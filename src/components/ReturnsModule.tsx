"use client";

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth-context';
import { Loader2 } from 'lucide-react';

interface ReturnsModuleProps {
  onReturn: () => void;
}

const RETURNS_ROLES = new Set(['admin', 'office']);

const ReturnsModule: React.FC<ReturnsModuleProps> = ({ onReturn }) => {
  const router = useRouter();
  const { role, loading } = useAuth();

  useEffect(() => {
    if (loading || !role) return;
    if (RETURNS_ROLES.has(role)) {
      router.replace('/returns-module');
    }
  }, [loading, role, router]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[40vh]">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!role || !RETURNS_ROLES.has(role)) {
    return (
      <div className="space-y-8">
        <Card>
          <CardHeader className="flex flex-row justify-between items-center gap-4">
            <div>
              <CardTitle>Reporte de Devoluciones</CardTitle>
              <CardDescription>
                No tiene permisos para acceder a este módulo. Solo perfiles administrador u oficina.
              </CardDescription>
            </div>
            <Button onClick={onReturn} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-[40vh] gap-3 text-muted-foreground">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p>Abriendo reporte de devoluciones…</p>
    </div>
  );
};

export default ReturnsModule;
