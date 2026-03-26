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
    currentReason?: string;
    lastStatusChange?: any;
    currentPulseId?: string;
}

const formatElapsedTime = (startDate: Date, now: Date) => {
    const diff = Math.floor((now.getTime() - startDate.getTime()) / 1000);
    if (diff < 0) return "0s";
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

export const ControlPiso: React.FC<{ onReturn: () => void }> = ({ onReturn }) => {
    const [users, setUsers] = useState<UserStatusInfo[]>([]);
    const [globalPulse, setGlobalPulseData] = useState<OperationPulse | null>(null);
    const [loading, setLoading] = useState(true);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [now, setNow] = useState(new Date());
    const { toast } = useToast();
    const { user: admin } = useAuth();

    const fetchData = async () => {
        try {
            const [usersRes, globalRes] = await Promise.all([
                getAllUserStatuses(),
                getGlobalPulse()
            ]);
            
            if (usersRes.data) {
                // Filter out admins or generic accounts if needed, but for now show all as requested
                setUsers(usersRes.data);
            }
            if (globalRes.data !== undefined) setGlobalPulseData(globalRes.data);
        } catch (error) {
            console.error("Error fetching floor data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const fetchInterval = setInterval(fetchData, 15000); // Poll every 15s instead of 30s for better responsiveness
        const timerInterval = setInterval(() => setNow(new Date()), 1000); // Tick every second
        
        return () => {
            clearInterval(fetchInterval);
            clearInterval(timerInterval);
        };
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
                <p className="text-muted-foreground text-lg italic animate-pulse">Sincronizando monitor de control de piso...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-card p-6 rounded-2xl border-2 border-primary/5 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl">
                        <Users className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Control de Piso</h2>
                        <p className="text-muted-foreground font-medium">Monitorización en tiempo real de la operación.</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    {globalPulse ? (
                        <Button variant="outline" className="border-green-500 text-green-600 hover:bg-green-50 gap-2 h-11 px-6 font-bold shadow-sm" 
                            disabled={isActionLoading} onClick={() => handleToggleGlobalPulse(false)}>
                            <Play className="w-4 h-4 fill-current" /> Finalizar Pausa Global
                        </Button>
                    ) : (
                        <Button variant="destructive" className="gap-2 h-11 px-6 font-bold shadow-md hover:shadow-lg transition-all" disabled={isActionLoading} 
                            onClick={() => handleToggleGlobalPulse(true, 'Almuerzo' as any)}>
                            <Coffee className="w-4 h-4" /> Activar Almuerzo General
                        </Button>
                    )}
                    <Button variant="ghost" onClick={onReturn} className="h-11 font-medium">Volver a Suite</Button>
                </div>
            </div>

            {globalPulse && (
                <Card className="border-none bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-l-4 border-amber-500 animate-in fade-in duration-500">
                    <CardHeader className="py-4 px-6 flex flex-row items-center justify-between space-y-0">
                        <div className="space-y-1">
                            <CardTitle className="text-xl text-amber-700 dark:text-amber-400 flex items-center gap-2">
                                <Timer className="w-5 h-5 animate-spin-slow" />
                                Operación Sincronizada: {globalPulse.reason}
                            </CardTitle>
                            <CardDescription className="text-amber-600 dark:text-amber-500 font-medium">
                                Todas las estaciones de trabajo se encuentran bloqueadas.
                            </CardDescription>
                        </div>
                        <div className="text-right">
                           <p className="text-xs uppercase font-bold text-amber-600/60 dark:text-amber-400/40 tracking-widest">Tiempo Acumulado</p>
                           <p className="text-2xl font-mono font-bold text-amber-700 dark:text-amber-400">
                               {globalPulse.startTime ? formatElapsedTime(new Date(globalPulse.startTime), now) : '--'}
                           </p>
                        </div>
                    </CardHeader>
                </Card>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
                {users.map((u) => {
                    const statusColor = u.currentStatus === 'Pausado' ? 'amber' : u.currentStatus === 'En Remisión' ? 'blue' : u.currentStatus === 'Disponible' ? 'emerald' : 'slate';
                    const isActive = u.currentStatus === 'Disponible' || u.currentStatus === 'En Remisión';
                    
                    return (
                        <Card key={u.uid} className={`relative overflow-hidden border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                            statusColor === 'emerald' ? 'border-emerald-500/20 bg-emerald-500/5' : 
                            statusColor === 'amber' ? 'border-amber-500/20 bg-amber-500/5' : 
                            statusColor === 'blue' ? 'border-blue-500/20 bg-blue-500/5' : 'border-slate-200 opacity-70'
                        }`}>
                            <div className={`absolute top-0 left-0 w-1.5 h-full ${
                                statusColor === 'emerald' ? 'bg-emerald-500' : 
                                statusColor === 'amber' ? 'bg-amber-500' : 
                                statusColor === 'blue' ? 'bg-blue-500' : 'bg-slate-300'
                            }`} />
                            
                            <CardContent className="p-5">
                                <div className="flex justify-between items-start gap-4 mb-4">
                                    <div className="space-y-0.5 max-w-[70%]">
                                        <h3 className="text-lg font-bold truncate leading-tight tracking-tight text-foreground/90">
                                            {u.userName || u.email?.split('@')[0] || 'Operario'}
                                        </h3>
                                        <p className="text-[10px] text-muted-foreground truncate uppercase tracking-widest font-bold opacity-60">
                                            {u.email || u.uid.substring(0, 8)}
                                        </p>
                                    </div>
                                    <Badge className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider h-6 ${
                                        statusColor === 'emerald' ? 'bg-emerald-500 hover:bg-emerald-600' : 
                                        statusColor === 'amber' ? 'bg-amber-500 hover:bg-amber-600' : 
                                        statusColor === 'blue' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-slate-400'
                                    }`}>
                                        {u.currentStatus || 'Desconectado'}
                                    </Badge>
                                </div>
                                
                                <div className="space-y-4">
                                    {u.currentStatus && u.lastStatusChange && (
                                        <div className="flex items-end justify-between">
                                            <div className="space-y-1">
                                                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest opacity-60">Tiempo en estado</p>
                                                <div className="flex items-center gap-2">
                                                    <Timer className={`w-4 h-4 ${isActive ? 'text-emerald-500' : 'text-amber-500'}`} />
                                                    <span className="text-xl font-mono font-bold tracking-tighter tabular-nums">
                                                        {formatElapsedTime(new Date(u.lastStatusChange), now)}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            <div className="text-right">
                                                {u.currentReason ? (
                                                     <div className="px-2 py-1 rounded-md bg-background/50 border border-border/40 text-[11px] font-bold text-foreground/80 shadow-sm flex items-center gap-1.5 animate-pulse">
                                                        <span className={`w-2 h-2 rounded-full ${statusColor === 'amber' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                                                        {u.currentReason}
                                                     </div>
                                                ) : u.currentStatus === 'Disponible' ? (
                                                     <div className="flex items-center gap-1.5 text-emerald-600 text-[11px] font-bold uppercase tracking-wider">
                                                        <CheckCircle2 className="w-3.5 h-3.5" /> Activo
                                                     </div>
                                                ) : (
                                                     <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                                                        <Ban className="w-3.5 h-3.5" /> Inactivo
                                                     </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {!u.currentStatus && (
                                        <div className="flex items-center justify-center py-4 text-slate-300">
                                            <Users className="w-12 h-12 opacity-10" />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

const ClockIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
);
