"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { 
    AlertCircle, 
    CheckCircle2, 
    Clock, 
    FilePlus, 
    LayoutDashboard, 
    Search,
    ChevronLeft,
    TrendingUp,
    Users,
    Store,
    PieChart as PieChartIcon,
    Upload
} from 'lucide-react';
import { 
    saveTransferNovelty, 
    getTransferNovelties, 
    updateTransferNoveltyStatus,
    listTransferDailyTfCounts,
    upsertTransferDailyTfCounts,
    applyFechaTfFromMatches,
} from '@/app/transfer-novelty-actions';
import { loadOperatorMappings } from '@/app/actions';
import { TransferNovelty, TransferNoveltyStatus, TransferNoveltyType } from '@/types';
import { format, parse, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { findCaseInsensitiveKey, parseFlexibleDate, parseRobustNumber } from '@/lib/parsingUtils';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    Legend, 
    ResponsiveContainer, 
    LineChart, 
    Line,
    PieChart,
    Pie,
    Cell
} from 'recharts';

function toValidDate(input: unknown): Date | null {
    if (input == null || input === '') return null;
    if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? null : input;
    }
    if (typeof input === 'object' && input !== null && typeof (input as { toDate?: () => Date }).toDate === 'function') {
        try {
            const d = (input as { toDate: () => Date }).toDate();
            return Number.isNaN(d.getTime()) ? null : d;
        } catch {
            return null;
        }
    }
    const sec =
        typeof input === 'object' && input !== null
            ? (input as { seconds?: number; _seconds?: number }).seconds ??
              (input as { _seconds?: number })._seconds
            : undefined;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
        const d = new Date(sec * 1000);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(input as string | number);
    return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateSafe(input: unknown, fmt: string, fallback = '—'): string {
    const d = toValidDate(input);
    if (!d) return fallback;
    try {
        return format(d, fmt, { locale: es });
    } catch {
        return fallback;
    }
}

/** Clave calendario AAAA-MM-DD: respeta cadenas ya guardadas y evita desfases por UTC en ISO. */
const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

function calendarKeyFromNoveltyField(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
        const s = value.trim();
        if (ISO_YMD.test(s)) return s;
    }
    const d = toValidDate(value);
    if (!d) return null;
    return format(d, 'yyyy-MM-dd');
}

/** Día en que la tienda reportó la novedad (no usa `createdAt` si ya hay fecha de reporte). */
function noveltyReportDateKey(n: TransferNovelty): string | null {
    const k = calendarKeyFromNoveltyField(n.fechaReporteTienda);
    if (k) return k;
    return calendarKeyFromNoveltyField(n.createdAt);
}

function noveltyTfDateKey(n: TransferNovelty): string | null {
    return calendarKeyFromNoveltyField(n.fechaTf);
}

/** Para cruzar con totales TF diarios: día operativo de la TF; si falta, día de reporte de novedad. */
function noveltyOperationalDayKey(n: TransferNovelty): string | null {
    return noveltyTfDateKey(n) ?? noveltyReportDateKey(n);
}

function parseTfDailyExcelRows(json: unknown[]): { dateKey: string; totalTfs: number }[] {
    const merged = new Map<string, number>();
    for (const raw of json) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const dateCol =
            findCaseInsensitiveKey(row, 'fecha', 'date', 'dia', 'día', 'fecha_dia', 'fecha dia') ||
            findCaseInsensitiveKey(row, 'Fecha');
        const totalCol =
            findCaseInsensitiveKey(
                row,
                'total_tf',
                'total_tfs',
                'total_tf_dia',
                'total',
                'tfs',
                'tf',
                'cantidad_tf',
                'transferencias',
                'num_tf',
                'cuenta_tf',
                'tf_del_dia'
            ) || findCaseInsensitiveKey(row, 'Total');
        if (!dateCol || !totalCol) continue;
        const dateRaw = row[dateCol];
        const parsedDate =
            dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())
                ? dateRaw
                : parseFlexibleDate(String(dateRaw ?? ''));
        if (!parsedDate || Number.isNaN(parsedDate.getTime())) continue;
        const dateKey = format(parsedDate, 'yyyy-MM-dd');
        const numRaw = row[totalCol];
        const totalTfs = Math.max(
            0,
            Math.floor(parseRobustNumber(String(numRaw ?? '')) || Number(numRaw) || 0)
        );
        merged.set(dateKey, totalTfs);
    }
    return [...merged.entries()].map(([dateKey, totalTfs]) => ({ dateKey, totalTfs }));
}

/** Excel: columnas TF + fecha (opcional almacén para desambiguar). */
function parseTfFechaMapRows(json: unknown[]): { numeroTF: string; fechaKey: string; almacen?: string }[] {
    const out: { numeroTF: string; fechaKey: string; almacen?: string }[] = [];
    for (const raw of json) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const tfCol =
            findCaseInsensitiveKey(
                row,
                'numero_tf',
                'numerotf',
                'numero tf',
                'n_tf',
                'n tf',
                'tf',
                'transfer',
                'remision',
                'remisión'
            ) || findCaseInsensitiveKey(row, 'TF');
        const fechaCol =
            findCaseInsensitiveKey(row, 'fecha_tf', 'fecha tf', 'fecha_transfer', 'fecha', 'date', 'dia', 'día') ||
            findCaseInsensitiveKey(row, 'Fecha');
        const almCol = findCaseInsensitiveKey(row, 'almacen', 'tienda', 'destino', 'bodega', 'sucursal');
        if (!tfCol || !fechaCol) continue;
        const tfVal = String(row[tfCol] ?? '').trim();
        if (!tfVal) continue;
        const dateRaw = row[fechaCol];
        const parsedDate =
            dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())
                ? dateRaw
                : parseFlexibleDate(String(dateRaw ?? ''));
        if (!parsedDate || Number.isNaN(parsedDate.getTime())) continue;
        const fechaKey = format(parsedDate, 'yyyy-MM-dd');
        const almRaw = almCol ? String(row[almCol] ?? '').trim() : '';
        out.push({ numeroTF: tfVal, fechaKey, ...(almRaw ? { almacen: almRaw } : {}) });
    }
    return out;
}

type EffDailyPoint = {
    dateKey: string;
    name: string;
    efectividad: number;
    totalTfs: number;
    novedades: number;
};

function TfEffectDailyTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: { payload: EffDailyPoint }[];
}) {
    if (!active || !payload?.[0]) return null;
    const p = payload[0].payload;
    return (
        <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
            <p className="font-medium">{p.dateKey}</p>
            <p>Total TF del día: {p.totalTfs}</p>
            <p>Novedades (día operativo): {p.novedades}</p>
            <p className="text-muted-foreground text-[11px] mt-1">
                Cuenta por fecha TF si está informada; si no, por fecha de reporte.
            </p>
            <p className="mt-1 font-semibold">Efectividad: {p.efectividad}%</p>
        </div>
    );
}

interface TransferNoveltiesProps {
    onBack: () => void;
}

export const TransferNovelties: React.FC<TransferNoveltiesProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState('register');
    const [novelties, setNovelties] = useState<TransferNovelty[]>([]);
    const [operators, setOperators] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const [manageOpen, setManageOpen] = useState(false);
    const [selectedNovelty, setSelectedNovelty] = useState<TransferNovelty | null>(null);
    const [manageForm, setManageForm] = useState({
        tfLegalizacion: '',
        comentariosAdmin: '',
        estado: 'Reportado' as TransferNoveltyStatus,
        fechaReporteTienda: '',
        fechaTf: '',
    });
    const [tfDailyStats, setTfDailyStats] = useState<{ dateKey: string; totalTfs: number }[]>([]);
    const [importingTf, setImportingTf] = useState(false);
    const [importingTfMap, setImportingTfMap] = useState(false);
    const [overwriteTfMap, setOverwriteTfMap] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        numeroTF: '',
        packerId: '',
        tipo: 'Faltante' as TransferNoveltyType,
        cantidad: 0,
        codigoUnidad: '',
        fechaEntregaTienda: '',
        fechaReporteTienda: format(new Date(), 'yyyy-MM-dd'),
        fechaTf: format(new Date(), 'yyyy-MM-dd'),
        almacen: '',
        justificacion: ''
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [noveltiesRes, operatorsRes] = await Promise.all([
                getTransferNovelties(),
                loadOperatorMappings()
            ]);

            if (noveltiesRes.data) setNovelties(noveltiesRes.data);
            if (operatorsRes.data) setOperators(operatorsRes.data);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadTfDaily = useCallback(async () => {
        const to = format(new Date(), 'yyyy-MM-dd');
        const from = format(subDays(new Date(), 500), 'yyyy-MM-dd');
        const res = await listTransferDailyTfCounts(from, to);
        if (res.success && res.data) {
            setTfDailyStats(res.data);
        } else if (res.error) {
            console.warn('[TransferNovelties] TF diarios:', res.error);
        }
    }, []);

    useEffect(() => {
        if (activeTab !== 'dashboard') return;
        void loadTfDaily();
    }, [activeTab, loadTfDaily]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!formData.numeroTF || !formData.packerId || !formData.almacen) {
            toast({ variant: 'destructive', title: 'Faltan campos', description: 'Por favor completa los campos obligatorios.' });
            return;
        }

        setIsLoading(true);
        try {
            const result = await saveTransferNovelty({
                ...formData,
                packerName: operators[formData.packerId] || 'Desconocido',
                estado: 'Reportado',
                fechaEntregaTienda: parse(formData.fechaEntregaTienda, 'yyyy-MM-dd', new Date()),
                fechaReporteTienda: parse(formData.fechaReporteTienda, 'yyyy-MM-dd', new Date()),
                fechaTf: parse(formData.fechaTf, 'yyyy-MM-dd', new Date()),
                enTiempo: true // Will be recalculated by server
            });

            if (result.success) {
                toast({ title: 'Novedad registrada', description: 'La novedad ha sido guardada exitosamente.' });
                setFormData({
                    numeroTF: '',
                    packerId: '',
                    tipo: 'Faltante',
                    cantidad: 0,
                    codigoUnidad: '',
                    fechaEntregaTienda: '',
                    fechaReporteTienda: format(new Date(), 'yyyy-MM-dd'),
                    fechaTf: format(new Date(), 'yyyy-MM-dd'),
                    almacen: '',
                    justificacion: ''
                });
                loadData();
                setActiveTab('manage');
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    // Dashboard Data Calculations
    const stats = useMemo(() => {
        const total = novelties.length;
        const enTiempoCount = novelties.filter((n) => !!n.enTiempo).length;
        const onTimePercentage = total > 0 ? (enTiempoCount / total) * 100 : 0;

        const novByDayReport: Record<string, number> = {};
        const novByDayTf: Record<string, number> = {};
        const novByOperationalDay: Record<string, number> = {};
        for (const n of novelties) {
            const kr = noveltyReportDateKey(n);
            if (kr) novByDayReport[kr] = (novByDayReport[kr] || 0) + 1;
            const kt = noveltyTfDateKey(n);
            if (kt) novByDayTf[kt] = (novByDayTf[kt] || 0) + 1;
            const ko = noveltyOperationalDayKey(n);
            if (ko) novByOperationalDay[ko] = (novByOperationalDay[ko] || 0) + 1;
        }

        const unionDaily = new Set([...Object.keys(novByDayReport), ...Object.keys(novByDayTf)]);
        const trendsDual = [...unionDaily]
            .sort((a, b) => a.localeCompare(b))
            .slice(-21)
            .map((dateKey) => ({
                name: format(parse(dateKey, 'yyyy-MM-dd', new Date()), 'dd MMM', { locale: es }),
                dateKey,
                porFechaReporte: novByDayReport[dateKey] ?? 0,
                porFechaTf: novByDayTf[dateKey] ?? 0,
            }));

        const novByMonthReport: Record<string, number> = {};
        for (const n of novelties) {
            const k = noveltyReportDateKey(n);
            if (!k) continue;
            const mk = k.slice(0, 7);
            novByMonthReport[mk] = (novByMonthReport[mk] || 0) + 1;
        }
        const novByMonthTf: Record<string, number> = {};
        for (const n of novelties) {
            const k = noveltyTfDateKey(n);
            if (!k) continue;
            const mk = k.slice(0, 7);
            novByMonthTf[mk] = (novByMonthTf[mk] || 0) + 1;
        }
        const monthKeys = new Set([...Object.keys(novByMonthReport), ...Object.keys(novByMonthTf)]);
        const monthlyTrendsDual = [...monthKeys]
            .sort((a, b) => a.localeCompare(b))
            .slice(-18)
            .map((key) => ({
                name: format(parse(`${key}-01`, 'yyyy-MM-dd', new Date()), 'MMM yyyy', { locale: es }),
                key,
                porReporte: novByMonthReport[key] ?? 0,
                porTf: novByMonthTf[key] ?? 0,
            }));

        const tfMap = Object.fromEntries(tfDailyStats.map((x) => [x.dateKey, x.totalTfs]));
        const dailyEffectivenessRaw: {
            dateKey: string;
            name: string;
            efectividad: number;
            totalTfs: number;
            novedades: number;
        }[] = [];
        for (const dateKey of Object.keys(tfMap).sort()) {
            const tot = tfMap[dateKey];
            if (!tot || tot <= 0) continue;
            const nov = novByOperationalDay[dateKey] || 0;
            const eff = ((tot - nov) / tot) * 100;
            dailyEffectivenessRaw.push({
                dateKey,
                name: format(parse(dateKey, 'yyyy-MM-dd', new Date()), 'dd/MM', { locale: es }),
                efectividad: Math.max(0, Math.min(100, Math.round(eff * 10) / 10)),
                totalTfs: tot,
                novedades: nov,
            });
        }
        const dailyEffectivenessChart = dailyEffectivenessRaw.slice(-45);

        const monthTfAgg: Record<string, { tf: number; nov: number }> = {};
        for (const row of dailyEffectivenessRaw) {
            const mk = row.dateKey.slice(0, 7);
            if (!monthTfAgg[mk]) monthTfAgg[mk] = { tf: 0, nov: 0 };
            monthTfAgg[mk].tf += row.totalTfs;
            monthTfAgg[mk].nov += row.novedades;
        }
        const monthEffDailyAvg: Record<string, { sum: number; n: number }> = {};
        for (const row of dailyEffectivenessRaw) {
            const mk = row.dateKey.slice(0, 7);
            if (!monthEffDailyAvg[mk]) monthEffDailyAvg[mk] = { sum: 0, n: 0 };
            monthEffDailyAvg[mk].sum += row.efectividad;
            monthEffDailyAvg[mk].n += 1;
        }
        const monthlyEffectiveness = Object.entries(monthTfAgg)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-18)
            .map(([key, v]) => {
                const effAgg = v.tf > 0 ? ((v.tf - v.nov) / v.tf) * 100 : 0;
                const avg = monthEffDailyAvg[key];
                const promedioDias = avg && avg.n > 0 ? Math.round((avg.sum / avg.n) * 10) / 10 : 0;
                return {
                    name: format(parse(`${key}-01`, 'yyyy-MM-dd', new Date()), 'MMM yyyy', { locale: es }),
                    efectividadAgregada: Math.max(0, Math.min(100, Math.round(effAgg * 10) / 10)),
                    efectividadPromedioDias: promedioDias,
                    totalTfs: v.tf,
                    novedades: v.nov,
                    diasConTf: avg?.n ?? 0,
                };
            });

        const packerData = novelties.reduce((acc: Record<string, number>, curr) => {
            const name = curr.packerName || 'Otro';
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});
        const packerChart = Object.entries(packerData)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const mixData = [
            { name: 'Sobrantes', value: novelties.filter((n) => n.tipo === 'Sobrante').length, color: '#10b981' },
            { name: 'Faltantes', value: novelties.filter((n) => n.tipo === 'Faltante').length, color: '#ef4444' },
        ];

        return {
            total,
            onTimePercentage,
            trendsDual,
            monthlyTrendsDual,
            dailyEffectivenessChart,
            monthlyEffectiveness,
            packerChart,
            mixData,
        };
    }, [novelties, tfDailyStats]);

    const openManageDialog = (n: TransferNovelty) => {
        setSelectedNovelty(n);
        setManageForm({
            tfLegalizacion: (n.tfLegalizacion || '').trim(),
            comentariosAdmin: (n.comentariosAdmin || '').trim(),
            estado: n.estado || 'Reportado',
            fechaReporteTienda: calendarKeyFromNoveltyField(n.fechaReporteTienda) || '',
            fechaTf: calendarKeyFromNoveltyField(n.fechaTf) || '',
        });
        setManageOpen(true);
    };

    const handleSaveManage = async () => {
        if (!selectedNovelty?.id) return;
        const tf = manageForm.tfLegalizacion.trim();
        if (manageForm.estado === 'Justificado' && !tf) {
            toast({
                variant: 'destructive',
                title: 'TF de carga / legalización',
                description:
                    'Para cerrar como Justificado debe indicar el número de TF con el que se gestionó la mercancía (sobrante o faltante).',
            });
            return;
        }
        if (!manageForm.fechaReporteTienda.trim()) {
            toast({
                variant: 'destructive',
                title: 'Fecha de reporte',
                description: 'Indique la fecha de reporte de la novedad en tienda.',
            });
            return;
        }
        setIsLoading(true);
        try {
            const res = await updateTransferNoveltyStatus(selectedNovelty.id, {
                tfLegalizacion: tf,
                comentariosAdmin: manageForm.comentariosAdmin.trim(),
                estado: manageForm.estado,
                fechaReporteTienda: manageForm.fechaReporteTienda.trim(),
                fechaTf: manageForm.fechaTf.trim() ? manageForm.fechaTf.trim() : null,
            });
            if (!res.success) {
                throw new Error('error' in res && res.error ? String(res.error) : 'No se pudo guardar');
            }
            toast({ title: 'Gestión guardada', description: 'Los datos de la novedad fueron actualizados.' });
            setManageOpen(false);
            setSelectedNovelty(null);
            await loadData();
        } catch (e: unknown) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: e instanceof Error ? e.message : 'Error al guardar',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const tfGestionHint =
        selectedNovelty?.tipo === 'Sobrante'
            ? 'Sobrante: indique el TF con el que se envió o legalizó el exceso (la transferencia donde “viajó” el sobrante).'
            : 'Faltante: indique el TF con el que la tienda carga o reporta la mercancia faltante / reposición.';

    const handleTfDailyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportingTf(true);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array', cellDates: true });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet) as unknown[];
            const rows = parseTfDailyExcelRows(json);
            if (rows.length === 0) {
                throw new Error(
                    'No se detectaron filas. Incluya columnas reconocibles: Fecha (o Fecha día) y Total TF / Total / TFs / Transferencias.'
                );
            }
            const res = await upsertTransferDailyTfCounts(rows);
            if (!res.success) {
                throw new Error(res.error || 'Error al guardar');
            }
            toast({
                title: 'Totales TF importados',
                description: `Se guardaron ${res.upserted ?? rows.length} días. Efectividad = (TF del día − novedades ese día) / TF del día.`,
            });
            await loadTfDaily();
        } catch (err: unknown) {
            toast({
                variant: 'destructive',
                title: 'Importación TF diarios',
                description: err instanceof Error ? err.message : 'Error',
            });
        } finally {
            setImportingTf(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleTfFechaMapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportingTfMap(true);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array', cellDates: true });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet) as unknown[];
            const rows = parseTfFechaMapRows(json);
            if (rows.length === 0) {
                throw new Error(
                    'No se detectaron filas. Use columnas: TF (numero_tf, tf, …) y Fecha / fecha_tf. Opcional: almacén/tienda para desambiguar.'
                );
            }
            const res = await applyFechaTfFromMatches(rows, { overwriteExisting: overwriteTfMap });
            if (!res.success) {
                throw new Error(res.error || 'Error al aplicar fechas');
            }
            toast({
                title: 'Fechas TF aplicadas',
                description: `Se actualizaron ${res.updated ?? 0} novedades. Las gráficas por fecha TF y la efectividad usarán esos días.`,
            });
            await loadData();
        } catch (err: unknown) {
            toast({
                variant: 'destructive',
                title: 'Importación TF → fecha',
                description: err instanceof Error ? err.message : 'Error',
            });
        } finally {
            setImportingTfMap(false);
            if (e.target) e.target.value = '';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Novedades de Transferencias</h1>
                    <p className="text-muted-foreground text-sm">Registro y control de sobrantes y faltantes de mercancía.</p>
                </div>
                <Button variant="outline" onClick={onBack}>
                    <ChevronLeft className="mr-2 h-4 w-4" /> Volver a Suite
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 md:w-[400px]">
                    <TabsTrigger value="register">Registro</TabsTrigger>
                    <TabsTrigger value="manage">Gestión</TabsTrigger>
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                </TabsList>

                <TabsContent value="register" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FilePlus className="h-5 w-5 text-primary" />
                                Nueva Novedad
                            </CardTitle>
                            <CardDescription>Completa los datos reportados por la tienda.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="numeroTF">Número de TF *</Label>
                                        <Input 
                                            id="numeroTF" 
                                            name="numeroTF" 
                                            value={formData.numeroTF}
                                            onChange={handleInputChange}
                                            placeholder="Ej: TF00123" 
                                            required
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="almacen">Almacén que Reporta *</Label>
                                        <Input 
                                            id="almacen" 
                                            name="almacen" 
                                            value={formData.almacen}
                                            onChange={handleInputChange}
                                            placeholder="Nombre de la tienda" 
                                            required
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="packerId">Empacador Responsable *</Label>
                                        <Select 
                                            onValueChange={(val) => setFormData(prev => ({...prev, packerId: val}))}
                                            value={formData.packerId}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Seleccionar empacador" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(operators).map(([id, name]) => (
                                                    <SelectItem key={id} value={id}>{name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="tipo">Tipo de Novedad</Label>
                                        <Select 
                                            onValueChange={(val) => setFormData(prev => ({...prev, tipo: val as TransferNoveltyType}))}
                                            value={formData.tipo}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Faltante">Faltante</SelectItem>
                                                <SelectItem value="Sobrante">Sobrante</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label htmlFor="cantidad">Cantidad</Label>
                                            <Input 
                                                id="cantidad" 
                                                name="cantidad" 
                                                type="number"
                                                value={formData.cantidad}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="codigoUnidad">Código Unidad Empaque</Label>
                                            <Input 
                                                id="codigoUnidad" 
                                                name="codigoUnidad" 
                                                value={formData.codigoUnidad}
                                                onChange={handleInputChange}
                                                placeholder="Bolsa/Caja ID" 
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div className="grid gap-2">
                                            <Label htmlFor="fechaEntregaTienda">Fecha Entrega Tienda</Label>
                                            <Input 
                                                id="fechaEntregaTienda" 
                                                name="fechaEntregaTienda" 
                                                type="date"
                                                value={formData.fechaEntregaTienda}
                                                onChange={handleInputChange}
                                                required
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="fechaReporteTienda">Fecha reporte novedad</Label>
                                            <Input 
                                                id="fechaReporteTienda" 
                                                name="fechaReporteTienda" 
                                                type="date"
                                                value={formData.fechaReporteTienda}
                                                onChange={handleInputChange}
                                                required
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="fechaTf">Fecha de la TF (operativa)</Label>
                                            <Input
                                                id="fechaTf"
                                                name="fechaTf"
                                                type="date"
                                                value={formData.fechaTf}
                                                onChange={handleInputChange}
                                                required
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Día en que se realizó o aplica la transferencia; alinea tendencias y efectividad con
                                                el archivo de TF diarios. Si coincide con el reporte, use la misma fecha.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="justificacion">Comentarios Iniciales</Label>
                                        <Input 
                                            id="justificacion" 
                                            name="justificacion" 
                                            value={formData.justificacion}
                                            onChange={handleInputChange}
                                            placeholder="Detalle de la novedad..." 
                                        />
                                    </div>
                                    <Button type="submit" className="w-full mt-2" disabled={isLoading}>
                                        {isLoading ? "Guardando..." : "Registrar Novedad"}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="manage" className="mt-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle>Historico de Novedades</CardTitle>
                                <CardDescription>
                                    Cada fila es una novedad reportada. Use <strong>Gestionar</strong> para registrar el TF con el
                                    que se cargó el sobrante o el faltante y avanzar el estado hasta <strong>Justificado</strong>.
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={loadData}>Actualizar</Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>TF gestión</TableHead>
                                        <TableHead>Fecha reporte</TableHead>
                                        <TableHead>Fecha TF</TableHead>
                                        <TableHead>TF / Almacén</TableHead>
                                        <TableHead>Tipo / Cant</TableHead>
                                        <TableHead>Empacador</TableHead>
                                        <TableHead>SLA</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {novelties.map((n) => (
                                        <TableRow key={n.id}>
                                            <TableCell className="font-mono text-xs max-w-[100px] truncate" title={n.tfLegalizacion || ''}>
                                                {n.tfLegalizacion?.trim() ? n.tfLegalizacion : '—'}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {formatDateSafe(n.fechaReporteTienda, 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {formatDateSafe(n.fechaTf, 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{n.numeroTF}</div>
                                                <div className="text-xs text-muted-foreground">{n.almacen}</div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={n.tipo === 'Faltante' ? 'destructive' : 'success'} className="mr-2">
                                                    {n.tipo}
                                                </Badge>
                                                <span className="font-bold">{n.cantidad}</span>
                                            </TableCell>
                                            <TableCell className="text-sm">{n.packerName}</TableCell>
                                            <TableCell>
                                                {n.enTiempo ? (
                                                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">En Tiempo</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">Vencido</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">{n.estado}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => openManageDialog(n)}>
                                                    Gestionar
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {novelties.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                                                No hay novedades registradas.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="dashboard" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Total Novedades <TrendingUp className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">{stats.total}</div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    SLA Cumplimiento <Clock className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">{stats.onTimePercentage.toFixed(1)}%</div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Top Empacador <Users className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-xl font-bold truncate">
                                    {stats.packerChart[0]?.name || 'N/A'}
                                </div>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-4">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                                    Tipo Predominante <PieChartIcon className="h-4 w-4" />
                                </CardTitle>
                                <div className="text-2xl font-bold">
                                    {stats.mixData[0].value === stats.mixData[1].value
                                        ? 'Empate'
                                        : stats.mixData[0].value > stats.mixData[1].value
                                          ? 'Sobrante'
                                          : 'Faltante'}
                                </div>
                            </CardHeader>
                        </Card>
                    </div>

                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle className="text-base">Datos para efectividad y fechas TF</CardTitle>
                            <CardDescription>
                                <strong>Totales TF diarios:</strong> una fila por día (fecha + total TF).{' '}
                                <strong>Mapeo TF → fecha:</strong> opcional; rellena el campo <em>Fecha de la TF</em> en
                                novedades existentes según el número de TF (y almacén si lo incluye en el archivo).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    id="tf-daily-upload"
                                    type="file"
                                    accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    className="hidden"
                                    onChange={(e) => void handleTfDailyFile(e)}
                                    disabled={importingTf || importingTfMap}
                                />
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={importingTf || importingTfMap}
                                    onClick={() => document.getElementById('tf-daily-upload')?.click()}
                                    className="inline-flex items-center gap-2"
                                >
                                    <Upload className="h-4 w-4" />
                                    {importingTf ? 'Importando…' : 'Importar Excel de TF diarios'}
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                    {tfDailyStats.length > 0
                                        ? `${tfDailyStats.length} días con totales TF en Firestore.`
                                        : 'Sin totales TF; la efectividad aparece tras importar.'}
                                </span>
                            </div>
                            <div className="border-t pt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                                <input
                                    id="tf-fecha-map-upload"
                                    type="file"
                                    accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    className="hidden"
                                    onChange={(e) => void handleTfFechaMapFile(e)}
                                    disabled={importingTf || importingTfMap}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={importingTf || importingTfMap}
                                    onClick={() => document.getElementById('tf-fecha-map-upload')?.click()}
                                    className="inline-flex items-center gap-2"
                                >
                                    <Upload className="h-4 w-4" />
                                    {importingTfMap ? 'Aplicando…' : 'Importar mapeo TF → fecha'}
                                </Button>
                                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="rounded border border-input"
                                        checked={overwriteTfMap}
                                        onChange={(e) => setOverwriteTfMap(e.target.checked)}
                                    />
                                    Sobrescribir <span className="font-mono">fechaTf</span> ya guardada
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Efectividad diaria/mensual: <span className="font-mono">(TF − novedades) / TF</span> usando el{' '}
                                <strong>día operativo</strong> (fecha TF si existe; si no, fecha de reporte). Las fechas de
                                registro se guardan con medianoche local para evitar correr un día en el gráfico.
                            </p>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Métricas por Empacador (Top 5)</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.packerChart} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis type="number" />
                                        <YAxis dataKey="name" type="category" width={100} />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Mix de Novedades</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[300px] flex items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={stats.mixData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {stats.mixData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Tendencia mensual de novedades</CardTitle>
                                <CardDescription>
                                    Barras por mes: según <strong>fecha de reporte</strong> (azul) y según{' '}
                                    <strong>fecha de la TF</strong> (violeta), cuando está informada.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                {stats.monthlyTrendsDual.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de novedades.</p>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={stats.monthlyTrendsDual}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={56} />
                                            <YAxis allowDecimals={false} />
                                            <Tooltip />
                                            <Legend />
                                            <Bar dataKey="porReporte" fill="#6366f1" name="Por fecha reporte" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="porTf" fill="#8b5cf6" name="Por fecha TF" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Efectividad diaria (TF)</CardTitle>
                                <CardDescription>
                                    Últimos días con total TF importado. Cada punto:{' '}
                                    <span className="font-mono">(TF − novedades) / TF</span> donde las novedades se cuentan por{' '}
                                    <strong>día operativo</strong> (fecha TF si existe; si no, fecha de reporte).
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                {stats.dailyEffectivenessChart.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-8 text-center">
                                        Importe totales TF por día para comparar con las novedades y ver la curva diaria.
                                    </p>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={stats.dailyEffectivenessChart}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="name" />
                                            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                                            <Tooltip content={<TfEffectDailyTooltip />} />
                                            <Line
                                                type="monotone"
                                                dataKey="efectividad"
                                                name="Efectividad"
                                                stroke="#0ea5e9"
                                                strokeWidth={2}
                                                dot={{ r: 3 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-base">Tendencia diaria de novedades</CardTitle>
                                <CardDescription>
                                    Hasta 21 días con actividad: línea <strong>azul</strong> por fecha de reporte en tienda; línea{' '}
                                    <strong>naranja</strong> por fecha de la TF (solo novedades con ese campo o rellenado por
                                    importación).
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                {stats.trendsDual.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-8 text-center">Sin novedades para graficar.</p>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={stats.trendsDual}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="name" />
                                            <YAxis allowDecimals={false} />
                                            <Tooltip />
                                            <Legend />
                                            <Line
                                                type="monotone"
                                                dataKey="porFechaReporte"
                                                name="Por fecha reporte"
                                                stroke="#3b82f6"
                                                strokeWidth={2}
                                                dot={{ r: 3 }}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="porFechaTf"
                                                name="Por fecha TF"
                                                stroke="#f97316"
                                                strokeWidth={2}
                                                dot={{ r: 3 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-base">Efectividad mensual</CardTitle>
                                <CardDescription>
                                    <span className="font-mono text-foreground">Verde</span>:{' '}
                                    <span className="font-mono">(Σ TF − Σ novedades) / Σ TF</span> del mes (solo días con total TF
                                    importado). <span className="font-mono text-foreground">Ámbar</span>: promedio simple del % diario
                                    de esos mismos días.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="h-[300px]">
                                {stats.monthlyEffectiveness.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-8 text-center">
                                        Sin días con total TF; importe el Excel de TF diarios.
                                    </p>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={stats.monthlyEffectiveness}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={52} />
                                            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                                            <Tooltip
                                                content={({ active, payload }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const p = payload[0].payload as {
                                                        totalTfs?: number;
                                                        novedades?: number;
                                                        diasConTf?: number;
                                                        efectividadAgregada?: number;
                                                        efectividadPromedioDias?: number;
                                                    };
                                                    return (
                                                        <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
                                                            <p className="font-medium">{payload[0].payload.name}</p>
                                                            <p>Σ mes — TF: {p.totalTfs ?? 0}, novedades: {p.novedades ?? 0}</p>
                                                            <p>Agregada: {p.efectividadAgregada ?? 0}%</p>
                                                            <p>
                                                                Prom. días ({p.diasConTf ?? 0} días): {p.efectividadPromedioDias ?? 0}%
                                                            </p>
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Legend />
                                            <Bar
                                                dataKey="efectividadAgregada"
                                                fill="#14b8a6"
                                                name="Agregada (Σ mes)"
                                                radius={[4, 4, 0, 0]}
                                            />
                                            <Bar
                                                dataKey="efectividadPromedioDias"
                                                fill="#f59e0b"
                                                name="Promedio % diarios"
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Gestionar novedad</DialogTitle>
                        <DialogDescription>
                            {selectedNovelty ? (
                                <>
                                    <span className="block mt-2">
                                        TF reportado: <strong>{selectedNovelty.numeroTF}</strong> · {selectedNovelty.almacen} ·{' '}
                                        <Badge variant={selectedNovelty.tipo === 'Faltante' ? 'destructive' : 'success'}>
                                            {selectedNovelty.tipo}
                                        </Badge>{' '}
                                        <span className="font-mono">({selectedNovelty.cantidad})</span>
                                    </span>
                                    <span className="block text-xs text-muted-foreground mt-2">{tfGestionHint}</span>
                                </>
                            ) : null}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="tfLegalizacion">TF de carga / legalización</Label>
                            <Input
                                id="tfLegalizacion"
                                value={manageForm.tfLegalizacion}
                                onChange={(e) => setManageForm((p) => ({ ...p, tfLegalizacion: e.target.value }))}
                                placeholder="Ej: 63120"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="comentariosAdmin">Notas de gestión</Label>
                            <Textarea
                                id="comentariosAdmin"
                                rows={3}
                                value={manageForm.comentariosAdmin}
                                onChange={(e) => setManageForm((p) => ({ ...p, comentariosAdmin: e.target.value }))}
                                placeholder="Acuerdos con tienda, observaciones de bodega, etc."
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="dlgFechaReporte">Fecha reporte novedad</Label>
                                <Input
                                    id="dlgFechaReporte"
                                    type="date"
                                    value={manageForm.fechaReporteTienda}
                                    onChange={(e) => setManageForm((p) => ({ ...p, fechaReporteTienda: e.target.value }))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="dlgFechaTf">Fecha de la TF</Label>
                                <Input
                                    id="dlgFechaTf"
                                    type="date"
                                    value={manageForm.fechaTf}
                                    onChange={(e) => setManageForm((p) => ({ ...p, fechaTf: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">Vacío quita la fecha TF en Firestore.</p>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Estado</Label>
                            <Select
                                value={manageForm.estado}
                                onValueChange={(val) =>
                                    setManageForm((p) => ({ ...p, estado: val as TransferNoveltyStatus }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Reportado">Reportado</SelectItem>
                                    <SelectItem value="En Justificación">En justificación</SelectItem>
                                    <SelectItem value="Justificado">Justificado (cerrado)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                <strong>Justificado</strong> exige el TF de carga/legalización arriba.
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setManageOpen(false)} disabled={isLoading}>
                            Cancelar
                        </Button>
                        <Button type="button" onClick={() => void handleSaveManage()} disabled={isLoading}>
                            {isLoading ? 'Guardando…' : 'Guardar gestión'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
