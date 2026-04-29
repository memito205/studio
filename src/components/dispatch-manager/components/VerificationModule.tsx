
"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Upload, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  ScanLine, 
  Trash2,
  PackageCheck,
  XCircle,
  FileDown,
  Save,
  Loader2,
  PlayCircle,
  ArrowLeft
} from 'lucide-react';
import type { VerificationItem, SavedVerification } from '@/types';
import { parseVerificationExcel, exportVerificationToExcel } from '@/components/dispatch-manager/utils/excel';
import { cn } from '@/components/dispatch-manager/utils/cn';
import { saveVerificationSession, loadVerificationSessions, updateVerificationSession } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


const SaveVerificationDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (name: string) => Promise<void>;
    isLoading: boolean;
}> = ({ isOpen, onOpenChange, onSave, isLoading }) => {
    const [name, setName] = useState('');
    
    const handleSaveClick = async () => {
        if (name.trim()) {
            await onSave(name.trim());
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Guardar Sesión de Verificación</DialogTitle>
                    <DialogDescription>
                        Asigne un nombre descriptivo a esta verificación para guardarla en el historial.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Label htmlFor="session-name">Nombre de la Sesión</Label>
                    <Input
                        id="session-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Verificación Despacho 28/07"
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSaveClick} disabled={isLoading || !name.trim()}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ScanningInterface: React.FC<{
  session: SavedVerification;
  onBack: () => void;
}> = ({ session, onBack }) => {
  const [data, setData] = useState<VerificationItem[]>(session.results);
  const [scanInput, setScanInput] = useState('');
  const [lastScanStatus, setLastScanStatus] = useState<{
    type: 'success' | 'error' | 'duplicate';
    message: string;
    code: string;
  } | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('saved');
  const debounceTimer = useRef<NodeJS.Timeout>();

  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  const [filters, setFilters] = useState({ codigo: '', destino: '', tft: '', status: 'all' });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stats = useMemo(() => {
    const total = data.length;
    const scanned = data.filter(item => item.scanned).length;
    const pending = total - scanned;
    return { total, scanned, pending, isComplete: total > 0 && pending === 0 };
  }, [data]);
  
  const saveProgress = useCallback(async (isFinalizing: boolean) => {
    setIsSaving(true);
    setSaveStatus('saving');
    
    const newStatus = isFinalizing ? 'completed' : session.status === 'pending' ? 'in-progress' : session.status;
    
    const result = await updateVerificationSession(session.id, {
        results: data,
        stats,
        status: newStatus,
    });

    if (result.success) {
        if (isFinalizing) {
            toast({ title: "Verificación Finalizada", description: `La sesión ha sido completada.` });
            onBack();
        } else {
            setSaveStatus('saved');
        }
    } else {
        setSaveStatus('error');
        toast({ variant: 'destructive', title: "Error al Guardar", description: result.error });
    }
    setIsSaving(false);
  }, [data, onBack, session.id, session.status, stats, toast]);

  useEffect(() => {
    if (saveStatus === 'idle') {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        saveProgress(false);
      }, 3000);
    }
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [data, saveStatus, saveProgress]);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim().toUpperCase().replace(/['\/]/g, '-');
    if (!code) return;

    const index = data.findIndex(item => item.codigo.toUpperCase() === code);

    if (index === -1) {
      setLastScanStatus({ type: 'error', message: '¡CÓDIGO NO ENCONTRADO!', code });
    } else if (data[index].scanned) {
      setLastScanStatus({ type: 'duplicate', message: '¡CÓDIGO YA ESCANEADO!', code });
      toast({
        title: "Código Duplicado",
        description: `La etiqueta "${code}" ya fue escaneada anteriormente.`,
        variant: 'default',
      });
    } else {
      const newData = [...data];
      newData[index] = { ...newData[index], scanned: true, scanTime: new Date() };
      setData(newData);
      setLastScanStatus({ type: 'success', message: '¡CÓDIGO VALIDADO!', code });
      setSaveStatus('idle'); // Trigger auto-save
    }
    setScanInput('');
  };
  
  const summaryByDestination = useMemo(() => {
    const summary: Record<string, { total: number; scanned: number; pending: number }> = {};
    data.forEach(item => {
        const dest = item.destino || 'N/A';
        if (!summary[dest]) {
            summary[dest] = { total: 0, scanned: 0, pending: 0 };
        }
        summary[dest].total++;
        if (item.scanned) {
            summary[dest].scanned++;
        } else {
            summary[dest].pending++;
        }
    });
    return Object.entries(summary).map(([destino, stats]) => ({ destino, ...stats })).sort((a,b) => b.total - a.total);
  }, [data]);
  
   const filteredData = useMemo(() => {
    return data.filter(item => {
        const statusMatch = filters.status === 'all' || (filters.status === 'scanned' && item.scanned) || (filters.status === 'pending' && !item.scanned);
        const codigoMatch = !filters.codigo || item.codigo.toLowerCase().includes(filters.codigo.toLowerCase());
        const destinoMatch = !filters.destino || item.destino.toLowerCase().includes(filters.destino.toLowerCase());
        const tftMatch = !filters.tft || (item.tftCruce && item.tftCruce.toLowerCase().includes(filters.tft.toLowerCase()));
        return statusMatch && codigoMatch && destinoMatch && tftMatch;
    });
  }, [data, filters]);

  const handleFinalize = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveProgress(true);
  };
  
  const renderSaveStatus = () => {
    switch (saveStatus) {
        case 'saving':
            return <span className="flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin"/> Guardando...</span>;
        case 'saved':
            return <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3"/> Progreso guardado</span>;
        case 'error':
            return <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3"/> Error al guardar</span>;
        case 'idle':
            return <span className="flex items-center gap-1 text-orange-500">Cambios sin guardar...</span>
        default:
            return null;
    }
  };

  return (
     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-6">
            <Button onClick={onBack} variant="outline" className="justify-start">
                <ArrowLeft className="mr-2 h-4 w-4"/> Volver a la Lista de Sesiones
            </Button>
          <Card>
            <CardHeader>
                <CardTitle>Escáner de Códigos</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleScan}>
                <Input ref={inputRef} type="text" value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Pistolear código..." className="w-full  text-xl focus:outline-none" autoComplete="off" />
                </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
                <CardTitle>Progreso: {session.name}</CardTitle>
                {session.originalStats && (
                  <div className="text-[10px] text-muted-foreground mt-1 bg-muted/50 p-2 border border-border">
                    <span className="font-bold">PLANIFICACIÓN:</span> {session.filteredStats?.totalTFs} / {session.originalStats?.totalTFs} TFs seleccionadas 
                    ({session.filteredStats?.totalUnits} / {session.originalStats?.totalUnits} unidades)
                  </div>
                )}
                 <div className="text-xs text-muted-foreground  mt-2 h-4">{renderSaveStatus()}</div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-sm font-medium text-muted-foreground">Total</span><p className="text-2xl font-bold">{stats.total}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Escaneados</span><p className="text-2xl font-bold text-green-600">{stats.scanned}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Pendientes</span><p className="text-2xl font-bold text-orange-600">{stats.pending}</p></div>
                  <div><span className="text-sm font-medium text-muted-foreground">Completado</span><p className="text-2xl font-bold">{stats.total > 0 ? Math.round((stats.scanned / stats.total) * 100) : 0}%</p></div>
                </div>
                <div className="flex flex-col gap-2 mt-6">
                    <Button onClick={handleFinalize} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PackageCheck size={14} className="mr-2"/>} Finalizar Verificación
                    </Button>
                </div>
            </CardContent>
          </Card>
           {lastScanStatus && (
                <div className={cn("p-4 border-l-4 rounded-md", lastScanStatus.type === 'success' && "bg-green-50 border-green-600 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300", lastScanStatus.type === 'error' && "bg-red-50 border-red-600 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300", lastScanStatus.type === 'duplicate' && "bg-orange-50 border-orange-600 text-orange-800 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-300")}>
                    <p className="font-bold text-sm uppercase">{lastScanStatus.message}</p>
                    <p className=" text-xs mt-1 opacity-70">Código: {lastScanStatus.code}</p>
                </div>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Resumen por Destino</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-48">
                        <Table>
                            <TableHeader><TableRow><TableHead>Destino</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Leídos</TableHead><TableHead className="text-right">Faltan</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {summaryByDestination.map(dest => (
                                    <TableRow key={dest.destino}>
                                        <TableCell>{dest.destino}</TableCell>
                                        <TableCell className="text-right">{dest.total}</TableCell>
                                        <TableCell className="text-right text-green-600">{dest.scanned}</TableCell>
                                        <TableCell className="text-right text-orange-600">{dest.pending}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
        <Card className="lg:col-span-2 flex flex-col h-[calc(100vh-14rem)]">
          <CardHeader>
            <CardTitle>Lista de Verificación</CardTitle>
            <CardDescription className="flex justify-between items-center">
                <span>{stats.scanned} / {stats.total} LISTOS</span>
                <div className="flex gap-2">
                    <Input 
                        placeholder="Filtrar por Código..." 
                        value={filters.codigo} 
                        onChange={(e) => setFilters(prev => ({...prev, codigo: e.target.value}))}
                        className="max-w-[150px] h-8 text-xs"
                    />
                    <Input 
                        placeholder="Filtrar por Destino..." 
                        value={filters.destino} 
                        onChange={(e) => setFilters(prev => ({...prev, destino: e.target.value}))}
                        className="max-w-[150px] h-8 text-xs"
                    />
                    <Select value={filters.status} onValueChange={(val) => setFilters(prev => ({...prev, status: val as 'all' | 'scanned' | 'pending'}))}>
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los Estados</SelectItem>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="scanned">Escaneado</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden p-0">
            <ScrollArea className="h-full">
            <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10"><TableRow><TableHead>Estado</TableHead><TableHead>Código</TableHead><TableHead>Destino</TableHead><TableHead>TFT</TableHead><TableHead>Cant.</TableHead></TableRow></TableHeader>
                <TableBody>
                    {filteredData.map((item, idx) => (
                    <TableRow key={item.codigo + idx} className={cn(item.scanned && "bg-green-100/50 dark:bg-green-900/20")}>
                        <TableCell>{item.scanned ? <Badge variant="success">LISTO</Badge> : <Badge variant="outline">PENDIENTE</Badge>}</TableCell>
                        <TableCell className=" text-xs font-bold">{item.codigo}</TableCell>
                        <TableCell className="text-xs">{item.destino}</TableCell>
                        <TableCell className=" text-xs opacity-60">{item.tftCruce}</TableCell>
                        <TableCell className="text-center font-medium">{item.cantTft}</TableCell>
                    </TableRow>
                    ))}
                </TableBody>
            </Table>
            </ScrollArea>
          </CardContent>
        </Card>
    </div>
  );
};

const SupervisorView: React.FC<{
    sessions: SavedVerification[];
    onSelectSession: (session: SavedVerification) => void;
}> = ({ sessions, onSelectSession }) => {
    const pendingSessions = sessions.filter(s => s.status !== 'completed');
    return (
        <Card>
            <CardHeader>
                <CardTitle>Sesiones de Verificación Pendientes</CardTitle>
                <CardDescription>Seleccione una sesión para iniciar o continuar con el pistoleo.</CardDescription>
            </CardHeader>
            <CardContent>
                {pendingSessions.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No hay verificaciones pendientes.</p>
                ) : (
                    <Table>
                        <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Fecha Creación</TableHead><TableHead>Estado</TableHead><TableHead>Progreso</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                            {pendingSessions.map(session => (
                                <TableRow key={session.id}>
                                    <TableCell>{session.name}</TableCell>
                                    <TableCell>{format(new Date(session.createdAt), 'dd/MM/yyyy')}</TableCell>
                                    <TableCell><Badge variant={session.status === 'in-progress' ? 'default' : 'secondary'}>{session.status}</Badge></TableCell>
                                    <TableCell>{session.stats.scanned} / {session.stats.total}</TableCell>
                                    <TableCell><Button onClick={() => onSelectSession(session)}><PlayCircle className="mr-2 h-4 w-4"/> Iniciar/Continuar</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
};

const AdminView: React.FC<{
    sessions: SavedVerification[];
    fetchSessions: () => void;
}> = ({ sessions, fetchSessions }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isUploading, setIsUploading] = useState(false);
    const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
    const [parsedDataForSave, setParsedDataForSave] = useState<VerificationItem[] | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const items = await parseVerificationExcel(file);
            const normalizedItems = items.map(item => ({ ...item, codigo: item.codigo.replace(/'/g, '-') }));
            setParsedDataForSave(normalizedItems);
            setIsSaveDialogOpen(true);
        } catch (error) {
            console.error('Error parsing verification excel:', error);
            toast({ variant: 'destructive', title: 'Error al procesar el archivo' });
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveVerification = async (name: string) => {
        if (!user || !parsedDataForSave) return;
        setIsSaving(true);
        const stats = {
            total: parsedDataForSave.length,
            scanned: 0,
            pending: parsedDataForSave.length,
        };
        const sessionData: Omit<SavedVerification, 'id'> = {
            name,
            createdAt: new Date(),
            savedById: user.uid,
            savedBy: user.displayName || user.email || 'Desconocido',
            results: parsedDataForSave,
            unmatchedResults: [], // Admin creates from a list, so no unmatched
            stats: stats,
            status: 'pending',
        };
        const result = await saveVerificationSession(sessionData);
        if (result.success) {
            toast({ title: 'Éxito', description: 'Sesión de verificación creada.' });
            fetchSessions();
            setIsSaveDialogOpen(false);
            setParsedDataForSave(null);
        } else {
            toast({ variant: 'destructive', title: 'Error al guardar', description: result.error });
        }
        setIsSaving(false);
    };

    return (
        <>
            <SaveVerificationDialog 
                isOpen={isSaveDialogOpen}
                onOpenChange={setIsSaveDialogOpen}
                onSave={handleSaveVerification}
                isLoading={isSaving}
            />
            <div className="p-12 border-2 border-dashed border-border rounded-2xl bg-card text-center">
                <h2 className="text-xl font-bold mb-2">Cargar Nueva Lista de Verificación</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">Suba un archivo Excel para crear una nueva sesión de verificación pendiente para los supervisores.</p>
                <label className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground cursor-pointer text-sm font-semibold rounded-md">
                    <Upload size={18} /> SELECCIONAR EXCEL
                    <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleUpload} disabled={isUploading} />
                </label>
            </div>
        </>
    );
};


export default function VerificationModule() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const isSupervisor = role === 'supervisor';
  
  const [sessions, setSessions] = useState<SavedVerification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<SavedVerification | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await loadVerificationSessions();
    if (error) alert(`Error al cargar sesiones: ${error}`);
    else setSessions(data || []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);
  
  if (isLoading) {
    return <div className="p-8 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto"/></div>;
  }

  if (activeSession) {
    return <ScanningInterface session={activeSession} onBack={() => { setActiveSession(null); fetchSessions(); }} />;
  }
  
  if (isAdmin) {
    return <AdminView sessions={sessions} fetchSessions={fetchSessions} />;
  }

  if (isSupervisor) {
    return <SupervisorView sessions={sessions} onSelectSession={setActiveSession} />;
  }

  return <p className="text-center opacity-50 p-8">Módulo de Verificación no disponible para su rol.</p>;
}

    