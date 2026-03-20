
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { loadVerificationSessions, saveVerificationSession, updateVerificationSession } from '@/app/actions';
import { SavedVerification, VerificationItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Search, Eye, CheckCircle2, FileDown, AlertCircle } from 'lucide-react';
import { cn } from '@/components/dispatch-manager/utils/cn';
import { exportVerificationToExcel, exportToExcel } from '../utils/excel';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


const VerificationDetailDialog: React.FC<{
    session: SavedVerification | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ session, isOpen, onOpenChange }) => {
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
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item, idx) => (
                        <TableRow key={item.codigo + idx} className={cn(item.scanned && "bg-green-50 dark:bg-green-900/20", title === "No Cruzados" && "bg-red-50 dark:bg-red-900/20")}>
                            <TableCell className="font-mono">{item.codigo}</TableCell>
                            <TableCell>{item.destino}</TableCell>
                            <TableCell>{item.tftCruce || '-'}</TableCell>
                            <TableCell>{item.cantTft}</TableCell>
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
                    <div className="flex justify-between items-center">
                        <div>
                            <DialogTitle>{session.name}</DialogTitle>
                            <DialogDescription>
                                Guardado por {session.savedBy} el {format(new Date(session.createdAt), 'PPP p', { locale: es })}
                            </DialogDescription>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleExport}>
                            <FileDown className="mr-2 h-4 w-4" /> Exportar a Excel
                        </Button>
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
    const [sessions, setSessions] = useState<SavedVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSession, setSelectedSession] = useState<SavedVerification | null>(null);

    useEffect(() => {
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
        fetchSessions();
    }, [toast]);

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
            />
            <CardHeader>
                <CardTitle>Historial de Verificaciones</CardTitle>
                <CardDescription>Busca y revisa sesiones de verificación guardadas anteriormente.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
                    <Input
                        type="text"
                        placeholder="Buscar por nombre de sesión, código o TFT..."
                        className="w-full pl-10 pr-4 py-2 font-mono text-sm"
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
                                <TableRow><TableCell colSpan={7} className="text-center p-8 opacity-50">No se encontraron sesiones.</TableCell></TableRow>
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
                                            <Button variant="outline" size="sm" onClick={() => setSelectedSession(session)}>
                                                <Eye className="mr-2 h-4 w-4"/>
                                                Ver Detalles
                                            </Button>
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
