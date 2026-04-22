/** @jsxImportSource react */
"use client";

import React, { useState, useCallback, useRef, useMemo, useEffect, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, UploadCloud, Package, CheckCircle, Clock, AlertTriangle, PackageCheck, XCircle, ChevronsUpDown, Calendar as CalendarIcon, Send, ClipboardEdit, History, TimerOff, ShieldCheck, Download, FileDown, Timer, BarChart2, GaugeCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { saveEcommerceOrders, loadEcommerceOrders, getDelayedOrderLogs, upsertDelayedOrderLog, addJustificationToLog, resolveDelayedOrderLog, batchResolveDelayedOrderLogs, batchUpsertDelayedOrderLogs } from '@/app/actions';
import type { EcommerceOrder, FilterCategory, DelayedOrderLog, Justification, Filters } from '@/types';
import { excelSerialDateToJSDate, findCaseInsensitiveKey, parseFlexibleDate, calculateSlaHours, parseRobustNumber } from '@/lib/parsingUtils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateRange } from 'react-day-picker';
import { format, differenceInDays, isSameDay, startOfDay, endOfDay, startOfToday, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EcommerceCharts } from './EcommerceCharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { exportToXlsx } from '@/services/export';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, LabelList } from 'recharts';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { StatCard } from '@/components/StatCard';
import { useTheme } from 'next-themes';
import { MultiSelectFilter } from './MultiSelectFilter';


interface EcommerceDashboardProps {
  onReturn: () => void;
  holidays: Date[];
  onHolidaysChange: (dates: Date[] | undefined) => void;
  orders: EcommerceOrder[];
  logs: DelayedOrderLog[];
  isLoading: boolean;
  onRefresh: () => void;
  dateRange?: DateRange;
  onDateRangeChange: (dateRange?: DateRange) => void;
  storeFilter: string[];
  onStoreFilterChange: (stores: string[]) => void;
}

const JUSTIFICATION_REASONS = [
    "DEMORA EN LLEGAR RIM",
    "RECOGIDA FALLIDA POR TRANSPORTADORA",
    "DATOS DE GUIA INCOMPLETOS O ERRONEOS",
    "PENDIENTE DEVOLUCION DE DINERO",
    "OTRO"
];

const JustificationDialog: React.FC<{
  orderId: string | null;
  log: DelayedOrderLog | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onJustificationAdded: (updatedLog: DelayedOrderLog) => void;
}> = ({ orderId, log, isOpen, onOpenChange, onJustificationAdded }) => {
    const { user } = useAuth();
    const [selectedReason, setSelectedReason] = useState('');
    const [almacen, setAlmacen] = useState('');
    const [otherReasonText, setOtherReasonText] = useState('');
    const [bitrixTaskDate, setBitrixTaskDate] = useState<Date | undefined>();
    const [bitrixTaskId, setBitrixTaskId] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (isOpen) {
            setSelectedReason('');
            setAlmacen('');
            setOtherReasonText('');
            setBitrixTaskId('');
            const existingJustificationWithDate = log?.justifications?.slice().reverse().find(j => j.bitrixTaskCreationDate);
            setBitrixTaskDate(existingJustificationWithDate?.bitrixTaskCreationDate ? new Date(existingJustificationWithDate.bitrixTaskCreationDate) : undefined);
        }
    }, [isOpen, log]);

    const handleSave = async () => {
        if (!orderId || !user) return;
        
        let justificationText = selectedReason;
        if (selectedReason === 'OTRO') {
            justificationText = otherReasonText.trim();
        }

        if (!justificationText && !bitrixTaskDate) {
            toast({
                variant: 'destructive',
                title: 'Datos Incompletos',
                description: 'Debe seleccionar una razón, escribir una, o seleccionar la fecha de la tarea en Bitrix.',
            });
            return;
        }

        setIsSaving(true);
        const justification: Justification = {
            text: justificationText || 'Fecha de tarea CRM actualizada.',
            date: new Date(),
            userId: user.uid,
            userName: user.displayName || user.email || 'N/A',
            ...(bitrixTaskDate && { bitrixTaskCreationDate: bitrixTaskDate }),
            ...(bitrixTaskId && { bitrixTaskId: bitrixTaskId }),
            ...(selectedReason === 'DEMORA EN LLEGAR RIM' && almacen && { almacen }),
        };
        const result = await addJustificationToLog(orderId, justification);
        if (result.success && result.data) {
            onJustificationAdded(result.data);
            onOpenChange(false);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsSaving(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Justificación de Atraso para Pedido {orderId}</DialogTitle>
                    <DialogDescription>Añada una nueva justificación o revise el historial.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <h4 className="font-semibold mb-2">Historial de Justificaciones</h4>
                        <ScrollArea className="h-32 border rounded-md p-2">
                            {log?.justifications && log.justifications.length > 0 ? (
                                log.justifications.slice().reverse().map((j, index) => (
                                    <div key={index} className="text-sm p-1 border-b">
                                        <p>{j.text}{j.almacen && ` (${j.almacen})`}</p>
                                        <p className="text-xs text-muted-foreground">
                                            - {j.userName} el {format(new Date(j.date), 'dd/MM/yyyy HH:mm')}
                                        </p>
                                        {j.bitrixTaskCreationDate && (
                                            <p className="text-xs text-blue-500">
                                                Tarea Bitrix
                                                {j.bitrixTaskId ? ` #${j.bitrixTaskId}` : ''}: 
                                                {format(new Date(j.bitrixTaskCreationDate), 'dd/MM/yyyy')}
                                            </p>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground text-center pt-4">No hay justificaciones anteriores.</p>
                            )}
                        </ScrollArea>
                    </div>
                    <div>
                        <Label htmlFor="reason-select">Razón Principal</Label>
                         <Select value={selectedReason} onValueChange={setSelectedReason}>
                            <SelectTrigger id="reason-select"><SelectValue placeholder="Seleccione un motivo..."/></SelectTrigger>
                            <SelectContent>
                                {JUSTIFICATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    {selectedReason === 'DEMORA EN LLEGAR RIM' && (
                        <div>
                             <Label htmlFor="almacen-input">Almacén de Origen</Label>
                             <Input id="almacen-input" value={almacen} onChange={(e) => setAlmacen(e.target.value)} placeholder="Ej: TIENDA BELLO" />
                        </div>
                    )}
                    {selectedReason === 'OTRO' && (
                         <div>
                            <Label htmlFor="other-reason-text">Especifique la Razón</Label>
                            <Textarea id="other-reason-text" value={otherReasonText} onChange={(e) => setOtherReasonText(e.target.value)} placeholder="Detalle la razón del atraso..." />
                        </div>
                    )}
                    <div>
                        <Label htmlFor="bitrix-date">Fecha Creación Tarea (Bitrix)</Label>
                         <Popover>
                            <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                "w-full justify-start text-left font-normal mt-1",
                                !bitrixTaskDate && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {bitrixTaskDate ? format(bitrixTaskDate, "PPP", { locale: es }) : <span>Seleccione una fecha (opcional)</span>}
                            </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={bitrixTaskDate}
                                onSelect={setBitrixTaskDate}
                                initialFocus
                            />
                            </PopoverContent>
                        </Popover>
                    </div>
                     {bitrixTaskDate && (
                        <div>
                            <Label htmlFor="bitrix-task-id">Número de Tarea Bitrix (Opcional)</Label>
                            <Input id="bitrix-task-id" value={bitrixTaskId} onChange={(e) => setBitrixTaskId(e.target.value)} placeholder="Ej: 12345" />
                        </div>
                     )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const ResolveDelayedOrderDialog: React.FC<{
  orderId: string | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onResolved: () => void;
}> = ({ orderId, isOpen, onOpenChange, onResolved }) => {
  const [dispatchDate, setDispatchDate] = useState<Date | undefined>(new Date());
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleResolve = async () => {
    if (!orderId || !dispatchDate) return;
    setIsSaving(true);
    const result = await resolveDelayedOrderLog(orderId, dispatchDate);
    if (result.success) {
      toast({ title: "Pedido resuelto" });
      onResolved();
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSaving(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolver Atraso Manualmente</DialogTitle>
          <DialogDescription>
            Confirme la fecha de despacho para el pedido {orderId}. Esto lo marcará como resuelto.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label>Fecha de Despacho</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !dispatchDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dispatchDate ? format(dispatchDate, "PPP", { locale: es }) : <span>Seleccione una fecha</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={dispatchDate}
                onSelect={setDispatchDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleResolve} disabled={isSaving || !dispatchDate}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
            Confirmar Despacho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


const DelayedOrdersTable: React.FC<{
    orders: EcommerceOrder[];
    logs: Map<string, DelayedOrderLog>;
    onJustify: (orderId: string) => void;
    onResolve: (orderId: string) => void;
    holidays: Date[];
    isPrinting?: boolean;
    isReadOnly?: boolean;
}> = ({ orders, logs, onJustify, onResolve, holidays, isPrinting, isReadOnly = false }) => {
    
    if (orders.length === 0) return null;

    const delayedOrdersWithLog = orders.map(order => ({
        order,
        log: logs.get(order.id)
    })).sort((a, b) => {
        const dateA = a.order.fechaPedido ? new Date(a.order.fechaPedido).getTime() : 0;
        const dateB = b.order.fechaPedido ? new Date(b.order.fechaPedido).getTime() : 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA - dateB;
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Detalle de Pedidos con Atraso Actual</CardTitle>
                <CardDescription>Estos pedidos están actualmente marcados como atrasados según el SLA.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className={cn("border rounded-md", !isPrinting && "max-h-96 overflow-y-auto")}>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID Pedido</TableHead>
                                <TableHead>Tienda</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Fecha Pedido</TableHead>
                                <TableHead className="text-right">Días de Atraso</TableHead>
                                <TableHead className="text-right">Días Tarea CRM</TableHead>
                                <TableHead>Última Justificación</TableHead>
                                {!isReadOnly && <TableHead className="text-center print-hide">Acciones</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {delayedOrdersWithLog.map(({ order, log }) => {
                                const crmJustification = log?.justifications?.slice().reverse().find(j => j.bitrixTaskCreationDate);
                                let crmTaskDays: number | null = null;
                                if (order.fechaPedido) {
                                    const orderDate = new Date(order.fechaPedido);
                                    if (crmJustification?.bitrixTaskCreationDate) {
                                        crmTaskDays = calculateSlaHours(orderDate, new Date(crmJustification.bitrixTaskCreationDate), holidays) / 24;
                                    } else {
                                        crmTaskDays = calculateSlaHours(orderDate, new Date(), holidays) / 24;
                                    }
                                }
                                
                                const delayDays = order.fechaPedido ? calculateSlaHours(new Date(order.fechaPedido), new Date(), holidays) / 24 : null;
                                const latestJustification = log?.justifications?.slice().reverse()[0];

                                return (
                                <TableRow key={order.id}>
                                    <TableCell>{order.id}</TableCell>
                                    <TableCell>{order.tienda}</TableCell>
                                    <TableCell>{order.estado || 'N/A'}</TableCell>
                                    <TableCell>{order.fechaPedido ? format(new Date(order.fechaPedido), 'PPP', { locale: es }) : 'N/A'}</TableCell>
                                    <TableCell className="text-right font-bold text-destructive">
                                        {delayDays !== null ? delayDays.toFixed(1) : 'N/A'}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold">
                                        {crmTaskDays !== null ? crmTaskDays.toFixed(1) : 'N/A'}
                                    </TableCell>
                                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={latestJustification?.text || (log ? "SIN JUSTIFICACIÓN REGISTRADA" : 'N/A')}>
                                        {latestJustification?.text || (log ? "SIN JUSTIFICACIÓN REGISTRADA" : 'N/A')}
                                    </TableCell>
                                    {!isReadOnly && (
                                        <TableCell className="text-center space-x-2 print-hide">
                                            <Button variant="outline" size="sm" onClick={() => onJustify(order.id)}>
                                                <ClipboardEdit className="mr-2 h-4 w-4"/>
                                                Justificaciones ({log?.justifications?.length || 0})
                                            </Button>
                                            <Button variant="secondary" size="sm" onClick={() => onResolve(order.id)}>
                                                <PackageCheck className="mr-2 h-4 w-4"/>
                                                Resolver
                                            </Button>
                                        </TableCell>
                                    )}
                                </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
};


const dispatchedStatesForFilter = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
const cancelledStatesForFilter = ['cancelado', 'pendiente cancelar'];

export const EcommerceDashboard: React.FC<EcommerceDashboardProps> = ({ onReturn, holidays, onHolidaysChange, orders, logs, isLoading: isDataLoading, onRefresh, dateRange, onDateRangeChange, storeFilter, onStoreFilterChange }) => {
  const [isGenerated, setIsGenerated] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [filters, setFilters] = useState<Filters>({});
  
  const [justificationState, setJustificationState] = useState<{ isOpen: boolean; orderId: string | null; log: DelayedOrderLog | null; }>({ isOpen: false, orderId: null, log: null });
  const [resolveDialogState, setResolveDialogState] = useState<{ isOpen: boolean; orderId: string | null; }>({ isOpen: false, orderId: null });
  
  const { toast } = useToast();
  const { user, role } = useAuth();
  const isOfficeUser = role === 'office';
  
  const [newFileLoaded, setNewFileLoaded] = useState(false);
  const reportContentRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [isExporting, setIsExporting] = useState(false);
  const [analysisDate, setAnalysisDate] = useState<Date>(new Date());
  
  const formatDateForInput = (date: Date): string => {
    if (!date || isNaN(date.getTime())) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const [isManualAnalysisTriggered, setIsManualAnalysisTriggered] = useState(false);

  const isCurrentlyDelayed = useCallback((order: EcommerceOrder, referenceDate: Date): boolean => {
    // Define states that are considered "final" or not at risk of being delayed.
    const excludedStates = [
      'en transporte externo',
      'en tienda',
      'entregado',
      'cancelado',
      'pendiente pago',
      'pendiente cancelar'
    ];
    const estado = (order.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');

    // If the order is in one of the final states, it's not "currently delayed".
    if (excludedStates.includes(estado)) {
      return false;
    }
    
    // An order that has been dispatched is not "currently delayed", regardless of its status text.
    if (order.dispatchDate) return false;

    // An order without a creation date cannot be evaluated.
    if (!order.fechaPedido) return false;

    const orderDate = new Date(order.fechaPedido);

    const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48, };
    const defaultTimeLimit = 48;
    const tienda = order.tienda?.trim().toUpperCase() ?? '';
    const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
    const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
    
    const timeDiffHours = calculateSlaHours(orderDate, referenceDate, holidays);

    return timeDiffHours > limitHours;
  }, [holidays]);
  
  const generateDashboard = useCallback(async (referenceDate: Date = new Date(), forceManual = false) => {
    if (!isManualAnalysisTriggered && !forceManual) return;
    
    setIsUploading(true);
    try {
        const { data: allOrders, error: ordersError } = await loadEcommerceOrders();
        if (ordersError || !allOrders) {
            throw new Error(ordersError || "No se pudieron cargar los pedidos.");
        }
        
        const filteredOrders = allOrders.filter(o => (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');

        const activeOrders = filteredOrders.filter(o => {
            const estado = (o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
            return !['entregado', 'cancelado', 'pendiente cancelar', 'pendiente pago', 'en transporte externo', 'en transporte interno', 'en tienda'].includes(estado);
        });
        
        const upsertsToBatch: { orderId: string, detectionDate: Date, lastStatus: string }[] = [];

        for (const order of activeOrders) {
            if (isCurrentlyDelayed(order, referenceDate)) {
                upsertsToBatch.push({
                    orderId: order.id,
                    detectionDate: referenceDate,
                    lastStatus: order.estado || 'N/A'
                });
            }
        }

        if (upsertsToBatch.length > 0) {
            await batchUpsertDelayedOrderLogs(upsertsToBatch);
        }

        await onRefresh();
        setIsGenerated(true);
        setNewFileLoaded(false);
        setAnalysisDate(referenceDate);
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error al Generar Análisis', description: e.message });
    } finally {
        setIsUploading(false);
    }
}, [isCurrentlyDelayed, toast, onRefresh]);

  useEffect(() => {
    // This effect ensures that once data is loaded initially, 'isGenerated' is set to true.
    if (!isDataLoading && orders.length > 0) {
        setIsGenerated(true);
    }
  }, [isDataLoading, orders]);

  useEffect(() => {
    if (newFileLoaded) {
      generateDashboard(analysisDate);
      setNewFileLoaded(false);
    }
  }, [newFileLoaded, generateDashboard, analysisDate]);

  const handleJustificationAdded = (updatedLog: DelayedOrderLog) => {
    onRefresh(); // Trigger a full refresh to get all data again
    toast({ title: "Justificación guardada" });
  };
  
  const handleOpenJustifyDialog = (orderId: string) => {
    const log = logs.find(l => l.orderId === orderId);
    setJustificationState({ isOpen: true, orderId, log: log || null });
  };
  
  const handleOpenResolveDialog = (orderId: string) => {
    setResolveDialogState({ isOpen: true, orderId: orderId });
  };


const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setIsGenerated(false);
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

        const parsedOrders: EcommerceOrder[] = json.map(row => ({
            id: String(findCaseInsensitiveKey(row, 'PED_ID') ? row[findCaseInsensitiveKey(row, 'PED_ID')!] : ''),
            tienda: String(findCaseInsensitiveKey(row, 'NOMBRE') ? row[findCaseInsensitiveKey(row, 'NOMBRE')!] : ''),
            valorTotal: parseRobustNumber(findCaseInsensitiveKey(row, 'PED_VALOR_TOTAL') ? row[findCaseInsensitiveKey(row, 'PED_VALOR_TOTAL')!] : 0),
            transportadora: String(findCaseInsensitiveKey(row, 'TRA_NOMBRE') ? row[findCaseInsensitiveKey(row, 'TRA_NOMBRE')!] : ''),
            fechaPedido: parseFlexibleDate(findCaseInsensitiveKey(row, 'PED_FECHA') ? row[findCaseInsensitiveKey(row, 'PED_FECHA')!] : null),
            estado: String(findCaseInsensitiveKey(row, 'DESCRIPCION') ? row[findCaseInsensitiveKey(row, 'DESCRIPCION')!] : ''),
            ped_cli_env: String(findCaseInsensitiveKey(row, 'PED_CLI_ENV') ? row[findCaseInsensitiveKey(row, 'PED_CLI_ENV')!] : ''),
            cli_nombre_cto: String(findCaseInsensitiveKey(row, 'CLI_NOMBRE_CTO') ? row[findCaseInsensitiveKey(row, 'CLI_NOMBRE_CTO')!] : ''),
            ped_direccion: String(findCaseInsensitiveKey(row, 'PED_DIRECCION') ? row[findCaseInsensitiveKey(row, 'PED_DIRECCION')!] : ''),
            ped_barrio: String(findCaseInsensitiveKey(row, 'PED_BARRIO') ? row[findCaseInsensitiveKey(row, 'PED_BARRIO')!] : ''),
            ped_ciudad: String(findCaseInsensitiveKey(row, 'PED_CIUDAD') ? row[findCaseInsensitiveKey(row, 'PED_CIUDAD')!] : ''),
            ped_departamento: String(findCaseInsensitiveKey(row, 'PED_DEPARTAMENTO') ? row[findCaseInsensitiveKey(row, 'PED_DEPARTAMENTO')!] : ''),
            ped_telefono: String(findCaseInsensitiveKey(row, 'PED_TELEFONO') ? row[findCaseInsensitiveKey(row, 'PED_TELEFONO')!] : ''),
            ped_celular: String(findCaseInsensitiveKey(row, 'PED_CELULAR') ? row[findCaseInsensitiveKey(row, 'PED_CELULAR')!] : ''),
            ped_factura: String(findCaseInsensitiveKey(row, 'PED_FACTURA') ? row[findCaseInsensitiveKey(row, 'PED_FACTURA')!] : ''),
            bodega: String(findCaseInsensitiveKey(row, 'BODEGA', 'ALMACEN', 'BODEGA_ORIGEN', 'AGENCIA') ? row[findCaseInsensitiveKey(row, 'BODEGA', 'ALMACEN', 'BODEGA_ORIGEN', 'AGENCIA')!] : ''),
        })).filter(o => o.id);

        const storedOrdersResult = await loadEcommerceOrders(true); // Load EVERYTHING only for sync diffing to avoid redundant writes
        if (!storedOrdersResult.success || !storedOrdersResult.data) {
            throw new Error("No se pudo cargar el estado actual de los pedidos desde la base de datos.");
        }
        const storedOrdersMap = new Map(storedOrdersResult.data.map(o => [o.id, o]));

        const dispatchedStates = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
        const cancelledStatesForFilter = ['cancelado', 'pendiente cancelar'];

        const allProcessedOrders = parsedOrders.map(newOrder => {
            const storedOrder = storedOrdersMap.get(newOrder.id);
            const newOrderState = (newOrder.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
            
            let finalOrder = { ...newOrder };

            if (!storedOrder) {
                if (dispatchedStates.includes(newOrderState)) {
                    finalOrder.dispatchDate = analysisDate;
                }
            } else {
                const storedOrderState = (storedOrder.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
                
                const isNewDispatch = 
                    !dispatchedStates.includes(storedOrderState) &&
                    !cancelledStatesForFilter.includes(storedOrderState) &&
                    dispatchedStates.includes(newOrderState); 

                if (isNewDispatch) {
                    finalOrder.dispatchDate = analysisDate;
                } else if (storedOrder.dispatchDate) {
                    finalOrder.dispatchDate = storedOrder.dispatchDate;
                }
            }
            
            return finalOrder;
        });

        // Optimization: DIFFING (Only save if something changed)
        const ordersToSave = allProcessedOrders.filter(o => {
            const stored = storedOrdersMap.get(o.id);
            if (!stored) return true; // It's a new order

            // Compare relevant fields to detect changes
            const hasStatusChanged = (o.estado || '') !== (stored.estado || '');
            const hasTiendaChanged = (o.tienda || '') !== (stored.tienda || '');
            const hasBodegaChanged = (o.bodega || '') !== (stored.bodega || '');
            const hasValorChanged = o.valorTotal !== stored.valorTotal;
            const hasDispatchDateChanged = o.dispatchDate?.getTime() !== stored.dispatchDate?.getTime();
            const hasTransporterChanged = (o.transportadora || '') !== (stored.transportadora || '');

            return hasStatusChanged || hasTiendaChanged || hasBodegaChanged || hasValorChanged || hasDispatchDateChanged || hasTransporterChanged;
        });

        let totalProcessed = 0;
        const CHUNK_SIZE = 500; // Client-side chunking to bypass Next.js 1MB Server Action limit
        
        for (let i = 0; i < ordersToSave.length; i += CHUNK_SIZE) {
            const chunk = ordersToSave.slice(i, i + CHUNK_SIZE);
            const result = await saveEcommerceOrders(chunk);
            
            if (!result.success) {
                throw new Error(result.error || "Error en el guardado por lotes.");
            }
            
            totalProcessed += result.data?.processedCount || chunk.length;
            
            // Opcional: mostrar progreso si es muy grande
            if (ordersToSave.length > CHUNK_SIZE) {
                toast({
                    title: 'Sincronizando...',
                    description: `Procesados ${totalProcessed} de ${ordersToSave.length} pedidos.`,
                    duration: 1500,
                });
            }
        }

        toast({
            title: 'Sincronización Exitosa',
            description: `${totalProcessed} pedidos fueron procesados correctamente. Generando análisis...`
        });
        setNewFileLoaded(true);

    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error al Cargar Archivo', description: e.message });
    } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrilldown = (type: FilterCategory, value: string) => {
    setFilters(prev => {
        const currentFilterValues = prev[type] || [];
        if(currentFilterValues.includes(value)) {
            const newValues = currentFilterValues.filter(v => v !== value);
            if (newValues.length === 0) {
                const {[type]: _, ...rest} = prev;
                return rest;
            }
            return {...prev, [type]: newValues};
        } else {
            return {...prev, [type]: [...currentFilterValues, value]};
        }
    });
  };
  
  const handleStatusFilter = (statuses: string[] | null) => {
    setFilters(prev => {
        if (statuses === null) {
            const { status, ...rest } = prev;
            return rest;
        }
        return { ...prev, status: statuses };
    });
  };

  const allAvailableStores = useMemo(() => {
    const stores = new Set<string>();
    orders.forEach(o => {
        if (o.tienda) stores.add(o.tienda);
    });
    return Array.from(stores).sort();
  }, [orders]);

  const filteredData = useMemo(() => {
    if (!orders) return [];
    let dataToFilter = orders;
    
    // Date Range Filter Application
    if (dateRange?.from) {
        const fromDate = startOfDay(dateRange.from);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        
        dataToFilter = dataToFilter.filter(order => {
            if (!order.fechaPedido) return false;
            const orderDate = new Date(order.fechaPedido);
            return orderDate >= fromDate && orderDate <= toDate;
        });
    }

    const activeFilterKeys = Object.keys(filters).filter(k => k !== 'date' && k !== 'status') as (keyof Omit<Filters, 'date' | 'status'>)[];
    
    return dataToFilter.filter(order => {
        const statusFilter = filters.status;
        let statusMatch = true;
        
        const dispatchedStates = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
        const cancelledStates = ['cancelado', 'pendiente cancelar'];
        const nonPendingStates = [...dispatchedStates, ...cancelledStates, 'pendiente pago'];
        const estado = (order.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');

        if (statusFilter && statusFilter.length > 0) {
            if (statusFilter.includes('delayed')) {
                statusMatch = isCurrentlyDelayed(order, analysisDate);
            } else {
                statusMatch = statusFilter.some((s: string) => estado.includes(s));
            }
        }
        if (!statusMatch) return false;

        if (storeFilter && storeFilter.length > 0) {
            if (!order.tienda || !storeFilter.includes(order.tienda)) return false;
        }

        if (activeFilterKeys.length === 0) return true;

        return activeFilterKeys.every(key => {
            const filterValues = filters[key as keyof typeof filters];
            if (!filterValues || filterValues.length === 0) return true;
            const orderValue = order[key as keyof EcommerceOrder];
            return orderValue ? filterValues.includes(String(orderValue)) : false;
        });
    });
  }, [orders, dateRange, filters, isCurrentlyDelayed, analysisDate, storeFilter]);
  
  const summaryData = useMemo(() => {
    if (!filteredData) return { totalOrders: 0, pendingOrders: 0, dispatchedOrders: 0, cancelledOrders: 0, delayedOrders: [], pendingPercentage: 0, dispatchedPercentage: 0, cancelledPercentage: 0, delayedPercentage: 0, historicalOnTimeRate: 100, pendingSlaComplianceRate: 100, globalSlaComplianceRate: 0 };
    const total = filteredData.length;
    
    const dispatchedStates = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
    const allDispatchedOrders = filteredData.filter(o => {
        if(o.dispatchDate) return true;
        const estado = (o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
        if (dispatchedStates.includes(estado)) {
            return true;
        }
        return false;
    });

    const onTimeDispatchedOrders = allDispatchedOrders.filter(o => !isCurrentlyDelayed(o, new Date(o.dispatchDate!)));
    const historicalOnTimeRate = allDispatchedOrders.length > 0 ? (onTimeDispatchedOrders.length / allDispatchedOrders.length) * 100 : 100;
    
    const cancelledStates = ['cancelado', 'pendiente cancelar'];
    const cancelledOrders = filteredData.filter(o => cancelledStates.includes((o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' '))).length;
    
    const nonPendingStates = [...dispatchedStates, ...cancelledStates, 'pendiente pago'];
    const pendingOrders = filteredData.filter(o => {
        const estado = (o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
        return !nonPendingStates.includes(estado) && !o.dispatchDate;
    });
    
    const pendingOrdersCount = pendingOrders.length;
    
    const delayedOrders = pendingOrders.filter(order => isCurrentlyDelayed(order, analysisDate));
    
    const pendingSlaComplianceRate = pendingOrdersCount > 0 ? ((pendingOrdersCount - delayedOrders.length) / pendingOrdersCount) * 100 : 100;
    
    const globalSlaComplianceRate = total > 0 ? ((total - delayedOrders.length) / total) * 100 : 0;


    return {
      totalOrders: total,
      pendingOrders: pendingOrdersCount,
      dispatchedOrders: allDispatchedOrders.length,
      cancelledOrders,
      delayedOrders,
      pendingPercentage: total > 0 ? (pendingOrdersCount / total) * 100 : 0,
      dispatchedPercentage: total > 0 ? (allDispatchedOrders.length / total) * 100 : 0,
      cancelledPercentage: total > 0 ? (cancelledOrders / total) * 100 : 0,
      delayedPercentage: pendingOrdersCount > 0 ? (delayedOrders.length / pendingOrdersCount) * 100 : 0,
      historicalOnTimeRate,
      pendingSlaComplianceRate,
      globalSlaComplianceRate,
    };
  }, [filteredData, isCurrentlyDelayed, analysisDate]);
  
  const logMap = useMemo(() => new Map(logs.map(log => [log.orderId, log])), [logs]);

  const delayedByStore = useMemo(() => {
    if (summaryData.delayedOrders.length === 0) return [];
    
    const storeMap = new Map<string, number>();
    summaryData.delayedOrders.forEach(order => {
        const store = order.tienda || 'Sin Tienda';
        storeMap.set(store, (storeMap.get(store) || 0) + 1);
    });
    
    return Array.from(storeMap.entries())
        .map(([name, value]) => ({ 
            name, 
            value,
            percentage: (value / summaryData.delayedOrders.length) * 100
        }))
        .sort((a,b) => b.value - a.value);
  }, [summaryData.delayedOrders]);

  
  const filteredOrderIds = useMemo(() => new Set(filteredData.map(o => o.id)), [filteredData]);

  const delayJustifications = useMemo(() => {
    const reasonCount = new Map<string, number>();
    const defaultReason = "SIN JUSTIFICACIÓN REGISTRADA";
    let totalLogsCount = 0;
    
    logs.forEach(log => {
      if (!filteredOrderIds.has(log.orderId)) return;
      totalLogsCount++;
      if (log.justifications && log.justifications.length > 0) {
        const latestJustification = log.justifications[log.justifications.length - 1];
        const reasonText = latestJustification.text.trim() || defaultReason;
        reasonCount.set(reasonText, (reasonCount.get(reasonText) || 0) + 1);
      } else {
        reasonCount.set(defaultReason, (reasonCount.get(defaultReason) || 0) + 1);
      }
    });

    return Array.from(reasonCount.entries()).map(([reason, count]) => ({
        name: reason,
        count: count,
        percentage: totalLogsCount > 0 ? (count / totalLogsCount) * 100 : 0,
    })).sort((a,b) => b.count - a.count);
  }, [logs, filteredOrderIds]);

  const currentDelayJustifications = useMemo(() => {
    const reasonCount = new Map<string, number>();
    const defaultReason = "SIN JUSTIFICACIÓN REGISTRADA";

    summaryData.delayedOrders.forEach(order => {
        const log = logMap.get(order.id);
        if (log && log.justifications && log.justifications.length > 0) {
            const latestJustification = log.justifications[log.justifications.length - 1];
            const reasonText = latestJustification.text.trim() || defaultReason;
            reasonCount.set(reasonText, (reasonCount.get(reasonText) || 0) + 1);
        } else {
            reasonCount.set(defaultReason, (reasonCount.get(defaultReason) || 0) + 1);
        }
    });

    const totalOrders = summaryData.delayedOrders.length;

    return Array.from(reasonCount.entries()).map(([reason, count]) => ({
        name: reason,
        count: count,
        percentage: totalOrders > 0 ? (count / totalOrders) * 100 : 0,
    })).sort((a,b) => b.count - a.count);
  }, [summaryData.delayedOrders, logMap]);
  
  const delayedTrendByDay = useMemo(() => {
    const dayStats = new Map<string, Set<string>>();
    logs.forEach(log => {
        if (!filteredOrderIds.has(log.orderId)) return;
        if (log.detectionDates) {
            log.detectionDates.forEach(d => {
                const dayKey = format(startOfDay(new Date(d)), 'yyyy-MM-dd');
                if (!dayStats.has(dayKey)) dayStats.set(dayKey, new Set());
                dayStats.get(dayKey)!.add(log.orderId);
            });
        }
    });

    return Array.from(dayStats.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, orderIds]) => {
        return {
          date: day,
          name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
          "Pedidos Atrasados": orderIds.size
        };
      });
  }, [logs, filteredOrderIds]);

  const totalJustifiedLogs = useMemo(() => delayJustifications.reduce((sum, item) => sum + item.count, 0), [delayJustifications]);
  
  const getComplianceColor = (compliance: number): string => {
    if (compliance >= 95) return 'text-green-500';
    if (compliance >= 85) return 'text-amber-500';
    return 'text-red-500';
  };

  const handleBarClick = (data: any) => {
    if (data && data.activePayload) {
        const storeName = data.activePayload[0].payload.name;
        // setStoreFilter(prev => prev === storeName ? null : storeName);
    }
  };

  const renderJustificationLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (!props.payload || props.payload.percentage === undefined || props.payload.percentage === null) {
        return null;
    }
    const percentage = props.payload.percentage.toFixed(1);
    return (
        <text x={x + width + 5} y={y + props.height / 2} dy={4} fill="currentColor" fontSize={12} textAnchor="start">
            {`${value} (${percentage}%)`}
        </text>
    );
  };
  
  const storePerformance = useMemo(() => {
    if (!filteredData) return [];
  
    const dispatchedStates = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
    const cancelledStates = ['cancelado', 'pendiente cancelar'];
    const nonPendingStates = [...dispatchedStates, ...cancelledStates, 'pendiente pago'];
  
    const pendingOrders = filteredData.filter(o => {
      const estado = (o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
      return !nonPendingStates.includes(estado) && !o.dispatchDate;
    });
  
    const storeMap = new Map<string, { total: number; delayed: number }>();
  
    pendingOrders.forEach(order => {
      const store = order.tienda || 'Sin Tienda';
      const entry = storeMap.get(store) || { total: 0, delayed: 0 };
      entry.total++;
      if (isCurrentlyDelayed(order, analysisDate)) {
        entry.delayed++;
      }
      storeMap.set(store, entry);
    });
  
    return Array.from(storeMap.entries())
      .map(([tienda, data]) => ({
        tienda,
        ...data,
        sla: data.total > 0 ? ((data.total - data.delayed) / data.total) * 100 : 100,
      }))
      .sort((a, b) => b.delayed - a.delayed);
  }, [filteredData, isCurrentlyDelayed, analysisDate]);
  
    const handleExportPdf = async () => {
        const input = reportContentRef.current;
        if (!input) return;
        setIsExporting(true);
        
        const originalTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        document.documentElement.classList.remove('dark');
        
        await new Promise(resolve => setTimeout(resolve, 200));

        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const margin = 15;
        let currentY = margin;

        const addPageIfNeeded = (elementHeight: number) => {
          if (currentY + elementHeight > pdf.internal.pageSize.getHeight() - margin) {
            pdf.addPage();
            currentY = margin;
          }
        };

        const addElementToPdf = async (selector: string, title: string) => {
          const element = input.querySelector<HTMLElement>(selector);
          if (element) {
            pdf.setFontSize(14);
            addPageIfNeeded(15);
            pdf.text(title, pdfWidth / 2, currentY, { align: 'center' });
            currentY += 15;

            await new Promise(resolve => setTimeout(resolve, 100));
            
            const canvas = await html2canvas(element, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
            const contentWidth = pdfWidth - margin * 2;
            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const imgHeight = (canvas.height * contentWidth) / canvas.width;
            
            addPageIfNeeded(imgHeight + 5);
            pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight);
            currentY += imgHeight + 10;
          }
        };

        pdf.setFontSize(20);
        pdf.text("Análisis de Pedidos Ecommerce", pdfWidth / 2, currentY, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text(format(analysisDate, "PPP p", { locale: es }), pdfWidth / 2, currentY + 8, { align: 'center' });
        currentY += 20;

        await addElementToPdf('.pdf-section-overview-stats', 'Resumen General');
        await addElementToPdf('.pdf-section-delayed-trend', 'Tendencia de Atrasos');
        await addElementToPdf('.pdf-section-justification-charts', 'Motivos de Atraso');
        await addElementToPdf('.pdf-section-delayed-table', 'Detalle de Pedidos Atrasados');
        await addElementToPdf('.pdf-section-charts', 'Análisis Específico (Estados, Transportadoras)');
        await addElementToPdf('.pdf-section-store-sla', 'Salud de Pedidos (SLA)');
        await addElementToPdf('.pdf-section-delayed-by-store', 'Atrasos por Tienda');
        
        pdf.save(`Reporte_Ecommerce_${format(analysisDate, "yyyy-MM-dd")}.pdf`);
        toast({ title: "Éxito", description: "El reporte en PDF ha sido generado." });

        if (originalTheme === 'dark') document.documentElement.classList.add('dark');
        setIsExporting(false);
    }

  return (
    <>
       <JustificationDialog
          isOpen={justificationState.isOpen}
          onOpenChange={(isOpen) => setJustificationState(prev => ({...prev, isOpen}))}
          orderId={justificationState.orderId}
          log={justificationState.log}
          onJustificationAdded={handleJustificationAdded}
        />
        <ResolveDelayedOrderDialog
          isOpen={resolveDialogState.isOpen}
          onOpenChange={(isOpen) => setResolveDialogState({ isOpen, orderId: null })}
          orderId={resolveDialogState.orderId}
          onResolved={onRefresh}
        />
        <div className="space-y-8" ref={reportContentRef}>
            <Card className="print-hide">
                 <CardHeader className="flex flex-row justify-between items-center">
                  <div>
                    <CardTitle>Análisis de Pedidos Ecommerce</CardTitle>
                    <CardDescription>
                      {isGenerated ? `Mostrando datos actualizados al ${analysisDate ? format(analysisDate, 'PPP p', {locale: es}) : 'ahora'}.` : 'Sincronice sus pedidos y genere el análisis para gestionar atrasos y medir la eficiencia.'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={handleExportPdf} variant="outline" disabled={isExporting}>
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}
                        Exportar PDF
                    </Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                    "w-[260px] justify-start text-left font-normal",
                                    !dateRange && "text-muted-foreground"
                                )}
                                >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                    dateRange.to ? (
                                    <>
                                        {format(dateRange.from, "LLL dd, y", { locale: es })} -{" "}
                                        {format(dateRange.to, "LLL dd, y", { locale: es })}
                                    </>
                                    ) : (
                                    format(dateRange.from, "LLL dd, y", { locale: es })
                                    )
                                ) : (
                                    <span>Seleccione un rango</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange?.from}
                                selected={dateRange}
                                onSelect={onDateRangeChange}
                                numberOfMonths={2}
                                locale={es}
                            />
                        </PopoverContent>
                    </Popover>
                    <MultiSelectFilter
                        title="Tiendas"
                        options={allAvailableStores.map(store => ({ label: store, value: store }))}
                        selectedValues={new Set(storeFilter)}
                        onSelectionChange={(selected) => onStoreFilterChange(Array.from(selected))}
                    />

                    {role === 'admin' && (
                        <Popover>
                            <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {holidays.length > 0 ? `${holidays.length} festivos marcados` : "Marcar Festivos"}
                            </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="multiple"
                                selected={holidays}
                                onSelect={onHolidaysChange}
                                initialFocus
                                locale={es}
                            />
                            </PopoverContent>
                        </Popover>
                    )}
                    <Button onClick={onReturn} variant="outline">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver a Dashboards
                    </Button>
                  </div>
                </CardHeader>
            </Card>

            {!isOfficeUser && (
                <Card className="print-hide">
                    <CardHeader>
                        <CardTitle>Sincronización y Análisis</CardTitle>
                        <CardDescription>
                            Sincronice sus pedidos para actualizar la base de datos y genere el análisis para visualizar métricas.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-4 items-end">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="analysis-date">Corte de Análisis</Label>
                            <Input
                                id="analysis-date"
                                type="datetime-local"
                                value={formatDateForInput(analysisDate)}
                                onChange={(e) => setAnalysisDate(new Date(e.target.value))}
                                className="w-[260px]"
                            />
                        </div>
                        
                        <Button
                            onClick={() => {
                                setIsManualAnalysisTriggered(true);
                                generateDashboard(analysisDate, true);
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold"
                            disabled={isUploading || isDataLoading}
                        >
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GaugeCircle className="mr-2 h-4 w-4" />}
                            GENERAR ANÁLISIS
                        </Button>

                        <div className="flex h-10 border-l border-slate-700 mx-2" />

                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={handleFileUpload}
                            className="hidden"
                            ref={fileInputRef}
                        />
                        <Button 
                            onClick={() => fileInputRef.current?.click()} 
                            variant="outline" 
                            disabled={isUploading}
                        >
                            <RefreshCw className={`mr-2 h-4 w-4 ${isUploading ? 'animate-spin' : ''}`} />
                            SINCRONIZAR EXCEL
                        </Button>
                    </CardContent>
                </Card>
            )}

            {isDataLoading && !isGenerated && (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-12 w-12 animate-spin text-primary"/>
                    <p className="ml-4 text-muted-foreground">Analizando datos...</p>
                </div>
            )}
            
            {!isDataLoading && isGenerated && (
              <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 pdf-section-overview-stats">
                      <StatCard title="Total Pedidos (Filtro)" value={summaryData.totalOrders.toLocaleString()} icon={<Package />} onClick={() => handleStatusFilter(null)} isActive={!filters.status} />
                      <StatCard title="Pedidos Pendientes" value={summaryData.pendingOrders.toLocaleString()} subtitle={`${summaryData.pendingPercentage.toFixed(1)}% del total`} icon={<Clock />} color="text-amber-500" onClick={() => handleStatusFilter(['pending'])} isActive={filters.status?.includes('pending') || false}/>
                      <StatCard title="Pedidos Despachados" value={summaryData.dispatchedOrders.toLocaleString()} subtitle={`${summaryData.dispatchedPercentage.toFixed(1)}% del total`} icon={<CheckCircle />} color="text-green-500" onClick={() => handleStatusFilter(dispatchedStatesForFilter)} isActive={filters.status?.[0] === dispatchedStatesForFilter[0]}/>
                      <StatCard title="Pedidos Cancelados" value={summaryData.cancelledOrders.toLocaleString()} subtitle={`${summaryData.cancelledPercentage.toFixed(1)}% del total`} icon={<XCircle />} color="text-destructive" onClick={() => handleStatusFilter(cancelledStatesForFilter)} isActive={filters.status?.includes('cancelado') || false}/>
                      <StatCard title="Pedidos con Atraso" value={summaryData.delayedOrders.length.toString()} subtitle={`${summaryData.delayedPercentage.toFixed(1)}% de los pendientes`} icon={<AlertTriangle />} color="text-destructive" onClick={() => handleStatusFilter(['delayed'])} isActive={filters.status?.includes('delayed') || false} />
                      <StatCard title="Cumplimiento SLA (Pendientes)" value={`${summaryData.pendingSlaComplianceRate.toFixed(1)}%`} icon={<ShieldCheck />} color={getComplianceColor(summaryData.pendingSlaComplianceRate)} subtitle="De los pedidos pendientes, % dentro de SLA."/>
                      <StatCard title="Cumplimiento SLA (Global)" value={`${summaryData.globalSlaComplianceRate.toFixed(1)}%`} icon={<ShieldCheck />} color={getComplianceColor(summaryData.globalSlaComplianceRate)} subtitle="Del total de pedidos filtrados, % sin atraso." />
                  </div>
                  
                  <div className="pdf-section-delayed-trend">
                      <Card>
                          <CardHeader>
                              <CardTitle>Tendencia de Pedidos Atrasados</CardTitle>
                              <CardDescription>Evolución diaria del número de pedidos únicos que entraron en estado de atraso en cada fecha.</CardDescription>
                          </CardHeader>
                          <CardContent className="h-[350px]">
                              {delayedTrendByDay.length > 0 ? (
                                  <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={delayedTrendByDay}>
                                          <CartesianGrid strokeDasharray="3 3" />
                                          <XAxis dataKey="name" />
                                          <YAxis allowDecimals={false} />
                                          <Tooltip />
                                          <Legend />
                                          <Bar dataKey="Pedidos Atrasados" fill="hsl(var(--destructive))" >
                                              <LabelList dataKey="Pedidos Atrasados" position="top" style={{ fontSize: '10px' }} />
                                          </Bar>
                                      </BarChart>
                                  </ResponsiveContainer>
                              ) : (
                                  <div className="flex items-center justify-center h-full bg-muted/50 rounded-md">
                                      <p className="text-muted-foreground">No hay datos de atrasos para mostrar la tendencia.</p>
                                  </div>
                              )}
                          </CardContent>
                      </Card>
                  </div>

                  <div className="grid grid-cols-1 gap-8 pdf-section-justification-charts">
                    <Card>
                        <CardHeader>
                            <CardTitle>Principales Motivos de Atraso (Histórico)</CardTitle>
                            <CardDescription>Causas registradas para todos los pedidos que han estado atrasados.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px]">
                            {delayJustifications.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={delayJustifications} layout="vertical" margin={{ left: 150, right: 50 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" allowDecimals={false} />
                                        <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} interval={0} />
                                        <Tooltip formatter={(value: number, name: string, props: any) => [`${value} (${(props.payload?.percentage ?? 0).toFixed(1)}%)`, 'Ocurrencias']} />
                                        <Bar dataKey="count" name="Ocurrencias" fill="hsl(var(--chart-4))">
                                            <LabelList content={renderJustificationLabel} />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full bg-muted/50 rounded-md">
                                    <p className="text-muted-foreground">No hay justificaciones registradas para los filtros actuales.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Principales Motivos de Atraso (Actuales)</CardTitle>
                            <CardDescription>Causas registradas solo para los pedidos actualmente atrasados.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-[350px]">
                            {currentDelayJustifications.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={currentDelayJustifications} layout="vertical" margin={{ left: 150, right: 50 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" allowDecimals={false} />
                                        <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} interval={0} />
                                        <Tooltip formatter={(value: number, name: string, props: any) => [`${value} (${(props.payload?.percentage ?? 0).toFixed(1)}%)`, 'Ocurrencias']} />
                                        <Bar dataKey="count" name="Ocurrencias" fill="hsl(var(--chart-5))">
                                            <LabelList content={renderJustificationLabel} />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full bg-muted/50 rounded-md">
                                    <p className="text-muted-foreground">No hay justificaciones para los atrasos actuales.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                  </div>
                  
                  <div className="pdf-section-delayed-table">
                    <DelayedOrdersTable 
                        orders={summaryData.delayedOrders}
                        logs={logMap} 
                        onJustify={handleOpenJustifyDialog}
                        onResolve={handleOpenResolveDialog}
                        holidays={holidays}
                        isPrinting={isExporting}
                        isReadOnly={isOfficeUser}
                    />
                  </div>

                  {filteredData && filteredData.length > 0 && (
                      <div className="mt-8 pdf-section-charts">
                          <EcommerceCharts 
                              orders={filteredData}
                              onDrilldown={handleDrilldown}
                              totalOrders={filteredData.length}
                              isPrinting={isExporting}
                          />
                      </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="pdf-section-store-sla">
                        <Card>
                            <CardHeader>
                                <CardTitle>Salud de Pedidos Pendientes (SLA)</CardTitle>
                                <CardDescription>Mide el estado actual de los pedidos que aún no se han despachado, comparando el total de pendientes contra cuántos de ellos ya incumplieron su SLA.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Tienda</TableHead>
                                            <TableHead className="text-right">Pedidos Pendientes</TableHead>
                                            <TableHead className="text-right">Atrasados (de los pendientes)</TableHead>
                                            <TableHead className="text-right">Cumplimiento Actual</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {storePerformance.map(store => (
                                            <TableRow key={store.tienda} onClick={() => handleDrilldown('tienda', store.tienda)} className="cursor-pointer hover:bg-muted/50">
                                                <TableCell>{store.tienda}</TableCell>
                                                <TableCell className="text-right">{store.total}</TableCell>
                                                <TableCell className="text-right text-destructive font-semibold">{store.delayed}</TableCell>
                                                <TableCell className={cn("text-right font-bold text-lg", getComplianceColor(store.sla))}>
                                                    {store.sla.toFixed(1)}%
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                    <div className="pdf-section-delayed-by-store">
                        <Card>
                            <CardHeader>
                                <CardTitle>Participación de Atrasos por Tienda</CardTitle>
                                <CardDescription>Distribución de los pedidos actualmente atrasados por cada tienda.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Tienda</TableHead>
                                            <TableHead className="text-right">Pedidos Atrasados</TableHead>
                                            <TableHead className="text-right">% Participación</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {delayedByStore.map(item => (
                                            <TableRow key={item.name} onClick={() => handleDrilldown('tienda', item.name)} className="cursor-pointer hover:bg-muted/50">
                                                <TableCell className="font-medium">{item.name}</TableCell>
                                                <TableCell className="text-right">{item.value.toLocaleString()}</TableCell>
                                                <TableCell className="text-right">{item.percentage.toFixed(1)}%</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                  </div>
              </div>
            )}
        </div>
    </>
  );
};

    