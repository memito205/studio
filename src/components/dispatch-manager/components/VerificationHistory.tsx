"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { loadVerificationSessions, deleteVerificationSession } from '@/app/actions';
import { SavedVerification, VerificationItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Search, Eye, FileDown, Trash2, FileText } from 'lucide-react';
import { cn } from '@/components/dispatch-manager/utils/cn';
import { exportVerificationToExcel } from '../utils/excel';
import {
  downloadStoreSummaryPdfs,
  verificationItemsToSummaryRows,
} from '../utils/storeSummaryPdf';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth-context';


const VerificationDetailDialog: React.FC<{
    session: SavedVerification | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onExportStorePdfs: (session: SavedVerification) => Promise<void>;
    isExportingPdfs: boolean;
}> = ({ session, isOpen, onOpenChange, onExportStorePdfs, isExportingPdfs }) => {
    if (!session) return null;

    const handleExport = () => {
        const matchedData = (session.results || []).map(item => ({...item, 'Estado Cruce': 'CRUZADO'}));
        const unmatchedData = (session.unmatchedResults || []).map(item => ({...item, 'Estado Cruce': 'NO CRUZADO'}));
        const dataToExport = [...matchedData, ...unmatchedData];
        
        exportVerificationToExcel(dataToExport, `Verificacion_${session.name.replace(/\s+/g, '_')}`);
    };

    const renderTable = (items: VerificationItem[], title: string) => (
        <ScrollArea className="h-full">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{title}</TableHead>
                        <TableHead>Destino</TableHead>
                        <TableHead>TFT Cruce</TableHead>
                        <TableHead>Cant.</TableHead>
                        <TableHead>Marca</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item, idx) => (
                        <TableRow key={item.codigo + idx} className={cn(item.scanned && "bg-green-50 dark:bg-green-900/20", title === "No Cruzados" && "bg-red-50 dark:bg-red-900/20")}>
                            <TableCell className="">{item.codigo}</TableCell>
                            <TableCell>{item.destino}</TableCell>
                            <TableCell>{item.tftCruce || '-'}</TableCell>
                            <TableCell>{item.cantTft}</TableCell>
                            <TableCell>{item.marca || '-'}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </ScrollArea>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <div className="flex justify-between items-center gap-2 flex-wrap">
                        <div>
                            <DialogTitle>{session.name}</DialogTitle>
                            <DialogDescription>
                                Guardado por {session.savedBy} el {format(new Date(session.createdAt), 'PPP p', { locale: es })}
                            </DialogDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isExportingPdfs || (session.results?.length || 0) === 0}
                                onClick={() => onExportStorePdfs(session)}
                            >
                                {isExportingPdfs
                                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    : <FileText className="mr-2 h-4 w-4" />}
                                PDF por tienda
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleExport}>
                                <FileDown className="mr-2 h-4 w-4" /> Exportar a Excel
                            </Button>
                        </div>
                    </div>
                </DialogHeader>
                <Tabs defaultValue="cruzados" className="flex-grow flex flex-col">
                    <TabsList className="w-full grid grid-cols-2">
                        <TabsTrigger value="cruzados">
                            Resultados Cruzados ({session.results.length})
                        </TabsTrigger>
                        <TabsTrigger value="no_cruzados">
                            No Cruzados ({session.unmatchedResults?.length || 0})
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="cruzados" className="flex-grow overflow-hidden mt-4">
                        {renderTable(session.results, 'Código')}
                    </TabsContent>
                    <TabsContent value="no_cruzados" className="flex-grow overflow-hidden mt-4">
                        {renderTable(session.unmatchedResults || [], 'Código Sin Cruce')}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

const VerificationHistory: React.FC = () => {
    const { toast } = useToast();
    const { role } = useAuth();
    const isAdmin = role === 'admin';
    const [sessions, setSessions] = useState<SavedVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSession, setSelectedSession] = useState<SavedVerification | null>(null);
    const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);

    const fetchSessions = async () => {
        setIsLoading(true);
        const { data, error } = await loadVerificationSessions();
        if (error) {
            toast({ variant: 'destructive', title: 'Error', description: `Error al cargar el historial: ${error}`});
        } else {
            setSessions(data || []);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        fetchSessions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleExportStorePdfs = async (session: SavedVerification) => {
        if (!session.results?.length) {
            toast({
                variant: 'destructive',
                title: 'Sin datos',
                description: 'Esta sesión no tiene resultados cruzados para el resumen.',
            });
            return;
        }
        setExportingPdfId(session.id || session.name);
        const result = await downloadStoreSummaryPdfs(
            verificationItemsToSummaryRows(session.results),
            { sessionName: session.name }
        );
        setExportingPdfId(null);
        if (result.success) {
            toast({
                title: 'PDF por tienda',
                description:
                    result.storeCount === 1
                        ? `Se descargó ${result.fileName}.`
                        : `Se descargó ZIP con ${result.storeCount} PDF(s): ${result.fileName}.`,
            });
        } else {
            toast({
                variant: 'destructive',
                title: 'Error al generar PDF',
                description: result.error,
            });
        }
    };

    const handleDelete = async (session: SavedVerification) => {
        if (!session.id) return;
        setDeletingId(session.id);
        const result = await deleteVerificationSession(session.id);
        setDeletingId(null);
        if (!result.success) {
            toast({
                variant: 'destructive',
                title: 'No se pudo eliminar',
                description: result.error || 'Error desconocido',
            });
            return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        if (selectedSession?.id === session.id) setSelectedSession(null);
        toast({ title: 'Verificación eliminada', description: `Se eliminó “${session.name}”.` });
    };

    const filteredSessions = useMemo(() => {
        if (!searchTerm) return sessions;
        const lowerCaseSearch = searchTerm.toLowerCase();
        return sessions.filter(session => 
            session.name.toLowerCase().includes(lowerCaseSearch) ||
            session.results.some(item => item.codigo.toLowerCase().includes(lowerCaseSearch) || (item.tftCruce && item.tftCruce.toLowerCase().includes(lowerCaseSearch)))
        );
    }, [sessions, searchTerm]);

    return (
        <Card className="mt-6">
            <VerificationDetailDialog
                isOpen={!!selectedSession}
                onOpenChange={() => setSelectedSession(null)}
                session={selectedSession}
                onExportStorePdfs={handleExportStorePdfs}
                isExportingPdfs={!!selectedSession && exportingPdfId === (selectedSession.id || selectedSession.name)}
            />
            <CardHeader>
                <CardTitle>Historial de Verificaciones</CardTitle>
                <CardDescription>Busca, revisa o elimina sesiones de verificación guardadas.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
                    <Input
                        type="text"
                        placeholder="Buscar por nombre de sesión, código o TFT..."
                        className="w-full pl-10 pr-4 py-2  text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="overflow-auto border rounded-lg h-[60vh]">
                    <Table>
                        <TableHeader className="sticky top-0 bg-secondary">
                            <TableRow>
                                <TableHead>Nombre Sesión</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Guardado Por</TableHead>
                                <TableHead>Total</TableHead>
                                <TableHead>Escaneados</TableHead>
                                <TableHead>Pendientes</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={7} className="text-center p-8"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></TableCell></TableRow>
                            ) : filteredSessions.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="h-24 text-center opacity-50">No se encontraron sesiones.</TableCell></TableRow>
                            ) : (
                                filteredSessions.map(session => (
                                    <TableRow key={session.id} className="hover:bg-muted/50">
                                        <TableCell className="font-bold">{session.name}</TableCell>
                                        <TableCell>{format(new Date(session.createdAt), 'dd/MM/yyyy HH:mm')}</TableCell>
                                        <TableCell>{session.savedBy}</TableCell>
                                        <TableCell>{session.stats.total}</TableCell>
                                        <TableCell className="text-green-600">{session.stats.scanned}</TableCell>
                                        <TableCell className="text-orange-600">{session.stats.pending}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2 flex-wrap">
                                                <Button variant="outline" size="sm" onClick={() => setSelectedSession(session)}>
                                                    <Eye className="mr-2 h-4 w-4"/>
                                                    Ver
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={exportingPdfId === (session.id || session.name) || !session.results?.length}
                                                    onClick={() => handleExportStorePdfs(session)}
                                                >
                                                    {exportingPdfId === (session.id || session.name)
                                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        : <FileText className="mr-2 h-4 w-4" />}
                                                    PDF tiendas
                                                </Button>
                                                {isAdmin && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                                                                disabled={deletingId === session.id}
                                                            >
                                                                {deletingId === session.id
                                                                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                    : <Trash2 className="mr-2 h-4 w-4" />}
                                                                Eliminar
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>¿Eliminar verificación?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Se eliminará permanentemente la sesión “{session.name}” del historial. Esta acción no se puede deshacer.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                    onClick={() => handleDelete(session)}
                                                                >
                                                                    Eliminar
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};

export default VerificationHistory;
