"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { getAllUserStatuses, setGlobalPulse, getGlobalPulse } from '@/app/actions';
import { Loader2, Users, Coffee, Play, Timer, Ban, CheckCircle2 } from 'lucide-react';
import type { OperationPulse, PulseReason } from '@/types';
import { useAuth } from '@/hooks/use-auth-context';

interface UserStatusInfo {
    uid: string;
    userName?: string;
    email?: string;
    currentStatus?: string;
    lastStatusChange?: any;
    currentPulseId?: string;
}

export const ControlPiso: React.FC<{ onReturn: () => void }> = ({ onReturn }) => {
    const [users, setUsers] = useState<UserStatusInfo[]>([]);
    const [globalPulse, setGlobalPulseData] = useState<OperationPulse | null>(null);
    const [loading, setLoading] = useState(true);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const { toast } = useToast();
    const { user: admin } = useAuth();

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersRes, globalRes] = await Promise.all([
                getAllUserStatuses(),
                getGlobalPulse()
            ]);
            
            if (usersRes.data) setUsers(usersRes.data);
            if (globalRes.data !== undefined) setGlobalPulseData(globalRes.data);
        } catch (error) {
            console.error("Error fetching floor data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // Polling every 30s
        return () => clearInterval(interval);
    }, []);

    const handleToggleGlobalPulse = async (active: boolean, reason?: PulseReason) => {
        setIsActionLoading(true);
        try {
            const result = await setGlobalPulse(active, reason, admin?.uid || undefined, (admin?.displayName || admin?.email) || undefined);
            if (result.success) {
                toast({ title: active ? "Pausa Global Activada" : "Pausa Global Finalizada", description: reason });
                fetchData();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setIsActionLoading(false);
        }
    };

    if (loading && users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-muted-foreground text-lg">Cargando monitor de control de piso...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-card p-6 rounded-xl border-2 border-primary/10 shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold flex items-center gap-3">
                        <Users className="w-8 h-8 text-primary" />
                        Control de Piso
                    </h2>
                    <p className="text-muted-foreground mt-1">Monitorización en tiempo real de la operación.</p>
                </div>
                <div className="flex gap-4">
                    {globalPulse ? (
                        <Button variant="outline" className="border-green-500 text-green-600 hover:bg-green-50 gap-2" 
                            disabled={isActionLoading} onClick={() => handleToggleGlobalPulse(false)}>
                            <Play className="w-4 h-4" /> Finalizar Pausa Global
                        </Button>
                    ) : (
                        <Button variant="destructive" className="gap-2" disabled={isActionLoading} 
                            onClick={() => handleToggleGlobalPulse(true, 'Almuerzo' as any)}>
                            <Coffee className="w-4 h-4" /> Activar Almuerzo General
                        </Button>
                    )}
                    <Button variant="ghost" onClick={onReturn}>Volver a Suite</Button>
                </div>
            </div>

            {globalPulse && (
                <Card className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-amber-700 dark:text-amber-400 flex items-center gap-2">
                            <Timer className="w-5 h-5 animate-pulse" />
                            Operación Sincronizada: {globalPulse.reason}
                        </CardTitle>
                        <CardDescription className="text-amber-600 dark:text-amber-500">
                            Toda la suite está bloqueada para los operarios.
                        </CardDescription>
                    </CardHeader>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {users.map((u) => (
                    <Card key={u.uid} className={`relative overflow-hidden ${u.currentStatus === 'Pausado' ? 'border-amber-200' : u.currentStatus === 'En Remisión' ? 'border-blue-200' : 'border-slate-200'}`}>
                        <div className={`absolute top-0 left-0 w-1 h-full ${u.currentStatus === 'Pausado' ? 'bg-amber-500' : u.currentStatus === 'En Remisión' ? 'bg-blue-500' : u.currentStatus === 'Disponible' ? 'bg-green-500' : 'bg-slate-300'}`} />
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-bold truncate max-w-[150px]">{u.userName || u.email || 'Operario'}</h3>
                                <Badge variant={u.currentStatus === 'Disponible' ? 'success' : u.currentStatus === 'Pausado' ? 'destructive' : 'secondary'}>
                                    {u.currentStatus || 'Desconectado'}
                                </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground space-y-1">
                                <p className="flex items-center gap-1">
                                    <ClockIcon className="w-3 h-3" />
                                    Cambio: {u.lastStatusChange ? new Date(u.lastStatusChange).toLocaleTimeString() : '--:--'}
                                </p>
                                {u.currentStatus === 'Pausado' && (
                                    <p className="font-medium text-amber-600">Pausa: {u.currentStatus}</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

const ClockIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
);
