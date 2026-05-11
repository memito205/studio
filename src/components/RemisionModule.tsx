"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    Clock, 
    Play, 
    Pause, 
    StopCircle, 
    Coffee, 
    Utensils, 
    Bath, 
    AlertCircle, 
    Timer,
    ChevronLeft,
    CheckCircle2
} from 'lucide-react';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import { createPulse, loadOperatorMappings } from '@/app/actions';
import { cn } from '@/lib/utils';
import { PACKERS } from './suite-app';
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface RemisionModuleProps {
    onReturn: () => void;
}

const PAUSE_REASONS = [
    { id: 'Desayuno', label: 'Desayuno', icon: Coffee, color: 'text-amber-500' },
    { id: 'Almuerzo', label: 'Almuerzo', icon: Utensils, color: 'text-orange-500' },
    { id: 'Refrigerio', label: 'Refrigerio', icon: Coffee, color: 'text-yellow-500' },
    { id: 'Baño', label: 'Baño', icon: Bath, color: 'text-blue-500' },
    { id: 'Soporte Técnico', label: 'Soporte Técnico', icon: AlertCircle, color: 'text-red-500' },
    { id: 'Otro', label: 'Otro', icon: AlertCircle, color: 'text-slate-500' },
];

export const RemisionModule: React.FC<RemisionModuleProps> = ({ onReturn }) => {
    const { user, userName } = useAuth();
    const { toast } = useToast();
    const { currentPulse, refreshPulses } = useSuitePulse();
    const [elapsedTime, setElapsedTime] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    
    // Identity standardization
    const [operationalName, setOperationalName] = useState<string | null>(null);
    const [showIdentityDialog, setShowIdentityDialog] = useState(false);
    const [masterPackers, setMasterPackers] = useState<string[]>([]);
    
    const availablePackers = masterPackers.length > 0 ? masterPackers : PACKERS;
    const isIdentityReady = Boolean(operationalName || (userName && availablePackers.find(p => p.toUpperCase() === userName.toUpperCase())));

    useEffect(() => {
        const fetchMasterPackers = async () => {
            const result = await loadOperatorMappings();
            const names = Object.values(result.data || {})
                .map(n => String(n || '').trim().toUpperCase())
                .filter(Boolean);
            const uniqueSorted = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
            if (uniqueSorted.length > 0) {
                setMasterPackers(uniqueSorted);
            }
        };
        fetchMasterPackers();
    }, []);

    // Initialize identity
    useEffect(() => {
        if (!userName) return;

        // 1. Check if name is already standardized in the current master list
        const standardizedName = availablePackers.find(p => p.toUpperCase() === userName.toUpperCase());
        
        // 2. Check localStorage for previous selection
        const storedName = localStorage.getItem(`op_name_${user?.uid}`);

        if (standardizedName) {
            setOperationalName(standardizedName);
        } else if (storedName && availablePackers.includes(storedName)) {
            setOperationalName(storedName);
        } else {
            // No match found, must ask the user
            setShowIdentityDialog(true);
        }
    }, [userName, user?.uid, availablePackers]);

    const handleConfirmIdentity = (name: string) => {
        setOperationalName(name);
        localStorage.setItem(`op_name_${user?.uid}`, name);
        setShowIdentityDialog(false);
    };

    const effectiveName = operationalName || userName || 'Operario';

    const pulseMeta = (currentPulse?.metadata as { fromModule?: string; remisionStartIso?: string } | undefined) || undefined;
    const isPulseFromRemision = pulseMeta?.fromModule === 'Remisión';

    /** Sesión de remisión activa si el pulso activo actual pertenece al módulo (En Remisión o Pausado). */
    const isInRemision = isPulseFromRemision && currentPulse?.status === 'En Remisión';
    const isRemisionPaused = isPulseFromRemision && currentPulse?.status === 'Pausado';
    const isRemisionSessionActive = isInRemision || isRemisionPaused;

    const [remisionStartIso, setRemisionStartIso] = useState<string>('');
    useEffect(() => {
        if (!user?.uid) return;
        const key = `remision_start_${user.uid}`;
        const fromPulse = pulseMeta?.remisionStartIso;
        const fromStorage = localStorage.getItem(key) || '';
        const next = fromPulse || fromStorage;
        if (next && next !== remisionStartIso) setRemisionStartIso(next);
        // limpiar si ya no hay sesión activa
        if (!isRemisionSessionActive && fromStorage) {
            localStorage.removeItem(key);
            if (remisionStartIso) setRemisionStartIso('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, currentPulse?.id, isRemisionSessionActive, pulseMeta?.remisionStartIso]);

    // Timer: corre durante toda la sesión (activa o pausada) usando remisionStartIso persistido.
    useEffect(() => {
        let timer: NodeJS.Timeout;
        const startIso = remisionStartIso || (isInRemision && currentPulse?.startTime ? new Date(currentPulse.startTime).toISOString() : '');
        if (isRemisionSessionActive && startIso) {
            const start = new Date(startIso).getTime();
            timer = setInterval(() => {
                setElapsedTime(Date.now() - start);
            }, 1000);
        } else if (!isRemisionSessionActive) {
            setElapsedTime(0);
        }
        return () => clearInterval(timer);
    }, [isRemisionSessionActive, remisionStartIso, isInRemision, currentPulse]);

    const formatDuration = (ms: number) => {
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));

        return [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0')
        ].join(':');
    };

    const handleStartRemision = async () => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Sesión no disponible', description: 'Debe iniciar sesión nuevamente.' });
            return;
        }
        if (isLoading) return;
        if (!isIdentityReady) {
            setShowIdentityDialog(true);
            toast({ title: 'Seleccione identidad', description: 'Primero confirme su nombre operativo para iniciar remisión.' });
            return;
        }
        setIsLoading(true);
        try {
            const startIso = new Date().toISOString();
            const result = await createPulse({
                userId: user.uid,
                userName: effectiveName,
                email: user.email || undefined,
                type: 'status_change',
                status: 'En Remisión',
                moduleContext: 'general',
                metadata: { fromModule: 'Remisión', remisionStartIso: startIso },
                startTime: new Date(),
                endTime: null
            } as any);
            if (result?.error) {
                toast({ variant: 'destructive', title: 'No se pudo iniciar remisión', description: result.error });
                return;
            }
            toast({ title: 'Remisión iniciada', description: 'El tiempo queda registrado correctamente.' });
            localStorage.setItem(`remision_start_${user.uid}`, startIso);
            setRemisionStartIso(startIso);
            await refreshPulses();
        } catch (error: any) {
            console.error("Error al iniciar remisión:", error);
            toast({ variant: 'destructive', title: 'Error al iniciar remisión', description: error?.message || 'Error desconocido' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleStopRemision = async () => {
        if (!user || isLoading) return;
        setIsLoading(true);
        try {
            const result = await createPulse({
                userId: user.uid,
                userName: effectiveName,
                email: user.email || undefined,
                type: 'status_change',
                status: 'Disponible',
                moduleContext: 'general',
                metadata: { fromModule: 'Remisión' },
                startTime: new Date(),
                endTime: null
            } as any);
            if (result?.error) {
                toast({ variant: 'destructive', title: 'No se pudo finalizar remisión', description: result.error });
                return;
            }
            toast({ title: 'Remisión finalizada', description: 'Estado actualizado a disponible.' });
            localStorage.removeItem(`remision_start_${user.uid}`);
            setRemisionStartIso('');
            await refreshPulses();
        } catch (error: any) {
            console.error("Error al finalizar remisión:", error);
            toast({ variant: 'destructive', title: 'Error al finalizar remisión', description: error?.message || 'Error desconocido' });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePause = async (reason: string) => {
        if (!user || isLoading) return;
        
        let finalReason = reason;
        if (reason === 'Otro') {
            const extra = prompt('Por favor, especifique el motivo de la pausa:');
            if (!extra || !extra.trim()) return; // Cancel if empty or aborted
            finalReason = `Otro: ${extra.trim()}`;
        }
        
        setIsLoading(true);
        try {
            const startIso = remisionStartIso || new Date().toISOString();
            const pauseResult = await createPulse({
                userId: user.uid,
                userName: effectiveName,
                email: user.email || undefined,
                type: 'pause',
                status: 'Pausado',
                reason: finalReason as any,
                moduleContext: 'general',
                startTime: new Date(),
                endTime: null,
                metadata: { fromModule: 'Remisión', remisionStartIso: startIso }
            } as any);
            if (pauseResult?.error) {
                toast({ variant: 'destructive', title: 'No se pudo registrar la pausa', description: pauseResult.error });
                return;
            }
            toast({ title: 'Pausa registrada', description: `Motivo: ${finalReason}` });
            localStorage.setItem(`remision_start_${user.uid}`, startIso);
            setRemisionStartIso(startIso);
            await refreshPulses();
        } catch (error: any) {
            console.error("Error al pausar remisión:", error);
            toast({ variant: 'destructive', title: 'Error al pausar', description: error?.message || 'Error desconocido' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleResume = async () => {
        if (!user || isLoading) return;
        setIsLoading(true);
        try {
            const startIso = remisionStartIso || new Date().toISOString();
            const result = await createPulse({
                userId: user.uid,
                userName: effectiveName,
                email: user.email || undefined,
                type: 'status_change',
                status: 'En Remisión',
                moduleContext: 'general',
                metadata: { fromModule: 'Remisión', remisionStartIso: startIso },
                startTime: new Date(),
                endTime: null
            } as any);
            if (result?.error) {
                toast({ variant: 'destructive', title: 'No se pudo reanudar', description: result.error });
                return;
            }
            toast({ title: 'Remisión reanudada', description: 'Sesión activa de nuevo.' });
            localStorage.setItem(`remision_start_${user.uid}`, startIso);
            setRemisionStartIso(startIso);
            await refreshPulses();
        } catch (error: any) {
            console.error("Error al reanudar remisión:", error);
            toast({ variant: 'destructive', title: 'Error al reanudar', description: error?.message || 'Error desconocido' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={onReturn} className="gap-2">
                        <ChevronLeft size={20} /> Volver a la Suite
                    </Button>
                    <Badge variant={isInRemision ? "default" : "secondary"} className="px-4 py-1 text-sm font-bold">
                        {isInRemision ? "SESIÓN ACTIVA" : (isRemisionPaused ? "PAUSADO" : "SIN INICIAR")}
                    </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Main Interaction Card */}
                    <Card className="shadow-lg border-2 border-indigo-100 overflow-hidden">
                        <CardHeader className="bg-indigo-600 text-white pb-8">
                            <CardTitle className="text-2xl font-bold flex items-center gap-2">
                                <Timer size={28} /> Módulo de Remisión
                            </CardTitle>
                            <CardDescription className="text-indigo-100">
                                Gestione su tiempo de remisión y registre sus pausas de forma organizada.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-8 space-y-8">
                            <div className="text-center space-y-2">
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Tiempo Transcurrido</p>
                                <p className="text-6xl font-mono font-black text-slate-800 tracking-tighter">
                                    {formatDuration(elapsedTime)}
                                </p>
                            </div>

                            <div className="flex flex-col gap-4">
                                {!isInRemision && !isRemisionPaused ? (
                                    <Button 
                                        size="lg" 
                                        className="w-full h-16 text-xl font-bold gap-3 transition-all active:scale-95 shadow-md hover:shadow-xl bg-indigo-600 hover:bg-indigo-700"
                                        onClick={handleStartRemision}
                                        disabled={isLoading}
                                    >
                                        <Play size={24} /> Iniciar Remisión
                                    </Button>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <Button 
                                            size="lg"
                                            variant="destructive"
                                            className="h-16 text-lg font-bold gap-3 transition-all active:scale-95"
                                            onClick={handleStopRemision}
                                            disabled={isLoading}
                                        >
                                            <StopCircle size={24} /> Finalizar
                                        </Button>
                                        
                                        {isRemisionPaused ? (
                                            <Button 
                                                size="lg"
                                                className="h-16 text-lg font-bold gap-3 transition-all active:scale-95 bg-emerald-600 hover:bg-emerald-700"
                                                onClick={handleResume}
                                                disabled={isLoading}
                                            >
                                                <Play size={24} /> Reanudar
                                            </Button>
                                        ) : (
                                            <Button 
                                                size="lg"
                                                variant="outline"
                                                className="h-16 text-lg font-bold gap-3 border-2 border-slate-200"
                                                disabled={true}
                                            >
                                                <Pause size={24} /> Operando...
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Pauses Card */}
                            <Card className={cn(
                        "shadow-lg transition-opacity duration-300",
                        (!isRemisionSessionActive) && "opacity-50 pointer-events-none"
                    )}>
                        <CardHeader>
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <Pause size={20} className="text-indigo-600" /> Registrar Pausa
                            </CardTitle>
                            <CardDescription>
                                Seleccione un motivo para pausar su sesión de remisión.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-3">
                            {PAUSE_REASONS.map((reason) => (
                                <Button
                                    key={reason.id}
                                    variant="outline"
                                    className="h-20 flex flex-col items-center justify-center gap-2 border-2 hover:border-indigo-300 hover:bg-indigo-50 transition-all font-bold"
                                    onClick={() => handlePause(reason.id)}
                                    disabled={isLoading || !isInRemision || isRemisionPaused}
                                >
                                    <reason.icon className={reason.color} size={24} />
                                    <span className="text-xs uppercase">{reason.label}</span>
                                </Button>
                            ))}
                        </CardContent>
                    </Card>
                </div>

                {/* Info Section */}
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 flex gap-4 items-start">
                    <CheckCircle2 className="text-indigo-600 shrink-0 mt-1" size={24} />
                    <div className="space-y-1">
                        <h4 className="font-bold text-indigo-900">Información de Sincronización</h4>
                        <p className="text-sm text-indigo-700 leading-relaxed">
                            El tiempo general en "Remisión" no detendrá su reloj de empaque ni cuenta como inactividad general. Sin embargo, **las pausas** registradas aquí sí se sincronizan automáticamente y aparecen como **justificaciones** en el módulo de Empaque.
                        </p>
                    </div>
                </div>
            </div>

            {/* Identity Selection Dialog */}
            <Dialog open={showIdentityDialog} onOpenChange={(open) => {
                if (!open && isIdentityReady) {
                    setShowIdentityDialog(false);
                }
            }}>
                <DialogContent onInteractOutside={(e) => {
                    if (!isIdentityReady) e.preventDefault();
                }}>
                    <DialogHeader>
                        <DialogTitle>Identificación de Operario</DialogTitle>
                        <DialogDescription>
                            Para asegurar que su productividad se registre correctamente, seleccione su nombre tal como aparece en el maestro de empacadores.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-6 space-y-4">
                        <div className="space-y-2">
                            <Label>Nombre en Maestro</Label>
                            <Select onValueChange={handleConfirmIdentity}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccione su nombre..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availablePackers.map(packer => (
                                        <SelectItem key={packer} value={packer}>{packer}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="text-xs text-muted-foreground italic">
                            Nombre detectado: <span className="font-bold">{userName}</span> (No coincide con el maestro).
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
