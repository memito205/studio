
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Search, 
  Loader2, 
  Package, 
  AlertTriangle,
  History,
  XCircle
} from 'lucide-react';
import { 
  createBagValidationSession, 
  getBagValidationSessions, 
  validateBagInSession, 
  deleteBagValidationSession,
  updateBagValidationSessionStatus
} from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import type { BagValidationSession } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';

interface BagCountingProps {
  onReturn: () => void;
}

export const BagCounting: React.FC<BagCountingProps> = ({ onReturn }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<BagValidationSession[]>([]);
  const [activeSession, setActiveSession] = useState<BagValidationSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // Creation Form States
  const [newName, setNewName] = useState('');
  const [newTotal, setNewTotal] = useState(1);
  
  // Scanner States
  const [scanInput, setScanInput] = useState('');
  const [lastScanned, setLastScanned] = useState<{ number: number; success: boolean; message?: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    setIsLoading(true);
    const result = await getBagValidationSessions();
    if (result.success && result.data) {
      setSessions(result.data.map(s => ({
          ...s,
          createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt)
      })));
    }
    setIsLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || newTotal < 1 || !user) return;
    
    setIsProcessing(true);
    const result = await createBagValidationSession(newName, newTotal, user.uid, user.displayName || 'Sistema');
    if (result.success && result.data) {
      const newS = { ...result.data, createdAt: new Date() };
      setSessions([newS, ...sessions]);
      setActiveSession(newS);
      setIsCreating(false);
      setNewName('');
      setNewTotal(1);
      toast({ title: "Sesión Creada", description: `Nueva validación "${newName}" iniciada.` });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
    }
    setIsProcessing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Está seguro de eliminar esta sesión?")) return;
    
    const result = await deleteBagValidationSession(id);
    if (result.success) {
      setSessions(sessions.filter(s => s.id !== id));
      toast({ title: "Sesión Eliminada" });
    } else {
      toast({ variant: 'destructive', title: "Error", description: result.error });
    }
  };

  const handleScan = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeSession || !scanInput) return;
    
    const bagNum = parseInt(scanInput);
    if (isNaN(bagNum)) {
      setLastScanned({ number: -1, success: false, message: "Número inválido" });
      setScanInput('');
      return;
    }

    if (bagNum < 1 || bagNum > activeSession.totalBags) {
        setLastScanned({ number: bagNum, success: false, message: "Fuera de rango" });
        setScanInput('');
        return;
    }

    setScanInput(''); // Clear immediately for faster flow
    const result = await validateBagInSession(activeSession.id, bagNum);
    
    if (result.success) {
      const isAlready = !!result.alreadyValidated;
      setLastScanned({ 
          number: bagNum, 
          success: true, 
          message: isAlready ? "Ya validada anteriormente" : "Validada correctamente" 
      });
      
      // Optimitically update UI if not already validated
      if (!isAlready) {
          setActiveSession(prev => {
              if (!prev) return null;
              const updatedBags = [...(prev.validatedBags || []), bagNum].sort((a,b) => a - b);
              return { ...prev, validatedBags: updatedBags };
          });
          // Also update in list
          setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, validatedBags: [...(s.validatedBags || []), bagNum] } : s));
      }
    } else {
      setLastScanned({ number: bagNum, success: false, message: result.error });
    }
  };

  const handleFinishSession = async () => {
      if (!activeSession) return;
      if (!confirm("¿Finalizar esta validación? Ya no se podrán agregar más bolsas.")) return;
      
      setIsProcessing(true);
      const result = await updateBagValidationSessionStatus(activeSession.id, 'completed');
      if (result.success) {
          setActiveSession({ ...activeSession, status: 'completed' });
          setSessions(sessions.map(s => s.id === activeSession.id ? { ...s, status: 'completed' } : s));
          toast({ title: "Sesión Finalizada" });
      }
      setIsProcessing(false);
  }

  // View: Scanner
  if (activeSession) {
    const validatedSet = new Set(activeSession.validatedBags || []);
    const progress = Math.round((validatedSet.size / activeSession.totalBags) * 100);
    
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center bg-card p-6 rounded-xl border shadow-sm">
            <div>
                <h2 className="text-3xl font-black text-primary">{activeSession.name}</h2>
                <div className="flex gap-2 items-center mt-2">
                    <Badge variant={activeSession.status === 'active' ? 'default' : 'secondary'} className="px-3 shrink-0">
                        {activeSession.status === 'active' ? '🟢 EN PROCESO' : '🏁 COMPLETADO'}
                    </Badge>
                    <p className="text-muted-foreground text-sm font-medium">ID: {activeSession.id.slice(-6)} · Creado el {activeSession.createdAt.toLocaleDateString()}</p>
                </div>
            </div>
            <Button variant="outline" onClick={() => setActiveSession(null)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Listado
            </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* LEFT: Scanner & Summary */}
            <div className="lg:col-span-1 space-y-6">
                <Card className="border-4 border-primary/20 shadow-xl overflow-hidden">
                    <CardHeader className="bg-primary/5 pb-4">
                        <CardTitle className="text-lg">Escáner de Bolsa</CardTitle>
                        <CardDescription>Digite o escanee el número</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-4">
                        <form onSubmit={handleScan} className="space-y-4">
                            <Input 
                                ref={scanInputRef}
                                type="text"
                                placeholder="Ej: 42"
                                className="text-5xl h-24 text-center font-black focus-visible:ring-primary border-4 rounded-2xl"
                                value={scanInput}
                                onChange={(e) => setScanInput(e.target.value)}
                                autoFocus
                                disabled={activeSession.status !== 'active'}
                            />
                            <Button 
                                className="w-full h-14 text-xl font-black uppercase tracking-wider" 
                                type="submit"
                                disabled={activeSession.status !== 'active'}
                            >
                                <CheckCircle2 className="mr-2 h-6 w-6" /> Validar
                            </Button>
                        </form>

                        {lastScanned && (
                            <div className={cn(
                                "p-5 rounded-2xl flex items-center gap-4 animate-in zoom-in-95 duration-200 shadow-sm border-2",
                                lastScanned.success ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"
                            )}>
                                {lastScanned.success ? <CheckCircle2 className="h-10 w-10 shrink-0" /> : <XCircle className="h-10 w-10 shrink-0" />}
                                <div>
                                    <p className="text-3xl font-black tabular-nums">Bolsa #{lastScanned.number}</p>
                                    <p className="text-xs font-bold uppercase tracking-tight">{lastScanned.message}</p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="shadow-lg border-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-widest font-black opacity-40">Progreso Operativo</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-2">
                        <div className="flex justify-between items-end">
                            <p className="text-6xl font-black tabular-nums">{progress}%</p>
                            <p className="text-right text-muted-foreground mb-1 leading-none">
                                <span className="text-2xl font-black text-foreground">{validatedSet.size}</span><br/>
                                <span className="text-xs font-bold">de {activeSession.totalBags}</span>
                            </p>
                        </div>
                        <div className="w-full bg-muted rounded-full h-5 overflow-hidden shadow-inner border p-1">
                            <div 
                                className={cn(
                                    "h-full rounded-full transition-all duration-1000 ease-out flex items-center justify-end pr-2",
                                    progress === 100 ? "bg-green-500" : "bg-primary"
                                )}
                                style={{ width: `${progress}%` }}
                            >
                                {progress > 15 && <div className="h-1 w-1 bg-white/40 rounded-full animate-pulse" />}
                            </div>
                        </div>

                        {activeSession.status === 'active' && validatedSet.size === activeSession.totalBags && (
                            <Button className="w-full bg-green-600 hover:bg-green-700 h-12 text-lg font-bold" onClick={handleFinishSession}>
                                <CheckCircle2 className="mr-2 h-5 w-5" /> Finalizar Conteo
                            </Button>
                        )}

                        <div className="pt-6 border-t grid grid-cols-2 gap-4">
                            <div className="bg-muted/50 p-3 rounded-lg text-center">
                                <span className="text-[10px] uppercase font-black opacity-50 block mb-1">Pendientes</span>
                                <span className="font-black text-xl tabular-nums">{activeSession.totalBags - validatedSet.size}</span>
                            </div>
                            <div className="bg-green-50 p-3 rounded-lg text-center border border-green-100">
                                <span className="text-[10px] uppercase font-black text-green-600 block mb-1">Validadas</span>
                                <span className="font-black text-xl tabular-nums text-green-600">{validatedSet.size}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* RIGHT: Visual Grid */}
            <div className="lg:col-span-3">
                <Card className="h-full shadow-lg border-2">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/10">
                        <div>
                            <CardTitle className="text-xl font-black">Grilla de Control</CardTitle>
                            <CardDescription className="font-medium text-xs uppercase tracking-tight">Seguimiento visual de bolsas</CardDescription>
                        </div>
                        <div className="flex gap-4 text-[10px] font-black uppercase tracking-widest">
                            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-green-500 rounded shadow-md"></div> Validada</div>
                            <div className="flex items-center gap-2"><div className="w-4 h-4 bg-slate-200 rounded border"></div> Pendiente</div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6">
                        <ScrollArea className="h-[calc(85vh-240px)]">
                            <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-15 xl:grid-cols-20 gap-2 pr-6">
                                {Array.from({ length: activeSession.totalBags }, (_, i) => i + 1).map(num => {
                                    const isValidated = validatedSet.has(num);
                                    return (
                                        <div 
                                            key={num}
                                            className={cn(
                                                "aspect-square rounded-lg flex items-center justify-center text-xs font-black transition-all duration-300 border-2",
                                                isValidated 
                                                    ? "bg-green-500 border-green-600 text-white shadow-md scale-105" 
                                                    : "bg-slate-100 border-slate-200 text-slate-400 hover:bg-slate-200 hover:border-slate-300 cursor-default"
                                            )}
                                        >
                                            {num}
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
      </div>
    );
  }

  // View: Main List
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center bg-card p-8 rounded-2xl border border-border shadow-md">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-primary">Conteo de Bolsas</h1>
          <p className="text-muted-foreground font-medium">Sistema de validación por lotes para control logístico.</p>
        </div>
        <div className="flex gap-3">
            <Button variant="outline" onClick={onReturn} className="h-12 px-6 font-bold">
                <ArrowLeft className="mr-2 h-5 w-5" /> Volver
            </Button>
            <Button onClick={() => setIsCreating(!isCreating)} className="h-12 px-6 font-black bg-primary hover:bg-primary/90 shadow-lg">
                <Plus className="mr-2 h-5 w-5" /> Iniciar Sesión
            </Button>
        </div>
      </div>

      {isCreating && (
        <Card className="animate-in slide-in-from-top-4 duration-500 border-4 border-primary/10 shadow-2xl overflow-hidden">
            <div className="bg-primary/5 p-4 border-b">
                <CardTitle className="text-xl font-black">Configuración de Nuevo Lote</CardTitle>
                <CardDescription className="font-bold text-xs uppercase tracking-widest opacity-60">Complete los parámetros de validación</CardDescription>
            </div>
            <CardContent className="pt-8">
                <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end max-w-5xl mx-auto pb-4">
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest opacity-70">📍 Nombre del Lote</label>
                        <Input 
                            placeholder="Ej: Despacho 001 - Cali" 
                            className="h-14 text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newName} 
                            onChange={(e) => setNewName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-black uppercase tracking-widest opacity-70">🔢 Cantidad de Bolsas</label>
                        <Input 
                            type="number" 
                            min={1} 
                            max={5000}
                            className="h-14 text-lg font-bold border-2 focus-visible:ring-primary"
                            value={newTotal} 
                            onChange={(e) => setNewTotal(parseInt(e.target.value))}
                            required
                        />
                    </div>
                    <div className="flex gap-3 pb-1">
                        <Button type="submit" className="flex-1 h-14 text-lg font-black uppercase tracking-wider shadow-xl" disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : "Crear Sesión"}
                        </Button>
                        <Button type="button" variant="ghost" className="h-14 px-6 font-bold" onClick={() => setIsCreating(false)}>Cancelar</Button>
                    </div>
                </form>
            </CardContent>
        </Card>
      )}

      <Card className="border-2 shadow-xl">
          <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="flex items-center gap-2">
                  <History className="h-6 w-6 text-primary" />
                  Sesiones Registradas
              </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-6">
                    <div className="relative">
                        <Loader2 className="h-16 w-16 animate-spin text-primary opacity-20" />
                        <Package className="h-8 w-8 text-primary absolute inset-0 m-auto animate-bounce" />
                    </div>
                    <p className="text-lg font-bold text-muted-foreground">Sincronizando con base de datos...</p>
                </div>
            ) : sessions.length === 0 ? (
                <div className="text-center py-32 space-y-6">
                    <div className="bg-muted w-24 h-24 rounded-full flex items-center justify-center mx-auto text-muted-foreground border-2 border-dashed border-muted-foreground/30">
                        <Package className="h-12 w-12" />
                    </div>
                    <div className="max-w-md mx-auto">
                        <h3 className="text-2xl font-black">No hay sesiones activas</h3>
                        <p className="text-muted-foreground font-medium mt-2">Parece que no hay procesos de conteo iniciados actualmente. ¡Comience uno nuevo!</p>
                    </div>
                    <Button onClick={() => setIsCreating(true)} variant="outline" className="h-12 px-8 font-black border-2">Crear mi primera sesión</Button>
                </div>
            ) : (
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableHead className="py-4 font-black text-xs uppercase tracking-widest pl-6">Identificador / Lote</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Fecha</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Estado</TableHead>
                            <TableHead className="font-black text-xs uppercase tracking-widest">Control de Carga</TableHead>
                            <TableHead className="text-right pr-6 font-black text-xs uppercase tracking-widest">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sessions.map(session => {
                            const validated = session.validatedBags?.length || 0;
                            const total = session.totalBags;
                            const percent = Math.round((validated / total) * 100);
                            
                            return (
                                <TableRow key={session.id} className="group hover:bg-primary/5 transition-all duration-200">
                                    <TableCell className="font-black text-xl py-6 pl-6 text-primary">{session.name}</TableCell>
                                    <TableCell className="font-bold text-muted-foreground">
                                        {session.createdAt.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </TableCell>
                                    <TableCell>
                                        <Badge 
                                            variant={session.status === 'active' ? 'default' : 'secondary'}
                                            className={cn(
                                                "font-black uppercase tracking-tighter px-3 py-1",
                                                session.status === 'active' ? "bg-primary" : "bg-slate-200 text-slate-600"
                                            )}
                                        >
                                            {session.status === 'active' ? '🟢 Activo' : '🏁 Cerrado'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-2 min-w-[240px]">
                                            <div className="flex justify-between items-baseline">
                                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Progreso</span>
                                                <span className="text-sm font-black tabular-nums">{percent}%</span>
                                            </div>
                                            <div className="w-full bg-muted rounded-full h-3 overflow-hidden shadow-inner border border-muted-foreground/10">
                                                <div 
                                                    className={cn(
                                                        "h-full transition-all duration-1000",
                                                        percent === 100 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-primary shadow-[0_0_8px_rgba(var(--primary),0.3)]"
                                                    )} 
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                            <p className="text-[10px] font-bold text-muted-foreground tracking-tight">{validated} de {total} unidades validadas</p>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right pr-6 space-x-2">
                                        <Button 
                                            variant={session.status === 'active' ? 'default' : 'outline'} 
                                            size="sm" 
                                            className={cn("font-bold px-4 h-10 shadow-sm", session.status === 'active' ? "shadow-primary/20" : "")}
                                            onClick={() => setActiveSession(session)}
                                        >
                                            <Search className="mr-2 h-4 w-4" /> Entrar
                                        </Button>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity" 
                                            onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
                </div>
            )}
          </CardContent>
      </Card>
      
      {/* Footer Info Hub */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-20 bg-primary/5 p-12 rounded-[2.5rem] border-2 border-primary/10">
          <div className="flex gap-6">
              <div className="bg-primary/20 p-4 rounded-2xl h-fit border border-primary/20 shadow-xl">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
              </div>
              <div>
                  <h4 className="font-black text-2xl tracking-tight mb-2">Validación Instantánea</h4>
                  <p className="text-muted-foreground font-medium leading-relaxed">
                      Escanear una bolsa actualiza la base de datos centralizada en milisegundos. 
                      Ideal para despachos de alto volumen donde cada segundo cuenta.
                  </p>
              </div>
          </div>
          <div className="flex gap-6">
              <div className="bg-green-100 p-4 rounded-2xl h-fit border border-green-200 shadow-xl">
                  <Package className="h-10 w-10 text-green-600" />
              </div>
              <div>
                  <h4 className="font-black text-2xl tracking-tight mb-2">Seguimiento Visual</h4>
                  <p className="text-muted-foreground font-medium leading-relaxed">
                      La grilla de control permite a los coordinadores detectar huecos en la carga 
                      de un solo vistazo, asegurando la integridad del despacho.
                  </p>
              </div>
          </div>
      </div>
    </div>
  );
};
