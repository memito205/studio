"use client";

import React, { useState, useRef, ChangeEvent, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import {
    ArrowLeft, UploadCloud, Loader2, GitCompareArrows, Database,
    TrendingUp, TrendingDown, Eye, Save, Star, BarChart3, Search, Trophy, Calculator, Shield,
    CreditCard, Plus, Trash2,
} from 'lucide-react';
import {
    saveMunicipios,
    saveCarrierCurrentRates,
    getCarrierCurrentRates,
    getAllCarrierRatesMetadata,
    getMunicipiosMap,
    saveCarrierProposal,
    loadCarrierProposals,
    getCarrierProposalById,
    saveCarrierScores,
    getCarrierScores,
    saveCarrierInsuranceConfig,
    getCarrierInsuranceConfig,
    saveCarrierCODConfig,
    getCarrierCODConfig,
} from '@/app/actions';
import type {
    CarrierRateRow,
    CarrierProposal,
    CarrierScoreConfig,
    CODRule,
    CODTier,
} from '@/lib/carrierProposalTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARRIERS = ['99 Minutos', 'Logicuartas', 'Envia', 'Servientrega', 'Deprisa', 'Mandar y Servir', 'Clicoh'];
const TRAYECTO_OPTIONS = ['Todos', 'Nacional', 'Regional', 'Local'];

const CRITERIA_KEYS = ['costo', 'calidad', 'novedades', 'cobertura', 'tiempoEntrega', 'soporte'] as const;
type CriteriaKey = typeof CRITERIA_KEYS[number];
const CRITERIA_LABELS: Record<CriteriaKey, string> = {
    costo: 'Costo', calidad: 'Calidad de Servicio', novedades: 'Novedades / Pérdidas',
    cobertura: 'Cobertura', tiempoEntrega: 'Tiempo de Entrega', soporte: 'Soporte',
};

const DEFAULT_WEIGHTS: Record<CriteriaKey, number> = {
    costo: 30, calidad: 25, novedades: 20, cobertura: 10, tiempoEntrega: 10, soporte: 5,
};
const DEFAULT_SCORE: Record<CriteriaKey, number> = {
    costo: 5, calidad: 5, novedades: 5, cobertura: 5, tiempoEntrega: 5, soporte: 5,
};

const fmt = (n: number) => `$${n.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;
const fmtDate = (d?: Date) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

// ---------------------------------------------------------------------------
// Helper: generate and download an Excel template
// ---------------------------------------------------------------------------
function downloadTemplate(filename: string, rows: Record<string, any>[]) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, filename);
}

const MUNICIPIOS_TEMPLATE = [
    { Codigo: '05001', Municipio: 'MEDELLIN', Departamento: 'ANTIOQUIA' },
    { Codigo: '11001', Municipio: 'BOGOTA D.C.', Departamento: 'BOGOTA D.C.' },
    { Codigo: '76001', Municipio: 'CALI', Departamento: 'VALLE DEL CAUCA' },
    { Codigo: '08001', Municipio: 'BARRANQUILLA', Departamento: 'ATLANTICO' },
    { Codigo: '13001', Municipio: 'CARTAGENA', Departamento: 'BOLIVAR' },
];

const TARIFAS_TEMPLATE = [
    { CodigoMunicipio: '05001', Flete: 8500, IVA: 1615, MargenLogisticaInversa: 500, TipoTrayecto: 'Nacional' },
    { CodigoMunicipio: '11001', Flete: 7000, IVA: 1330, MargenLogisticaInversa: 500, TipoTrayecto: 'Nacional' },
    { CodigoMunicipio: '76001', Flete: 8000, IVA: 1520, MargenLogisticaInversa: 500, TipoTrayecto: 'Nacional' },
    { CodigoMunicipio: '08001', Flete: 9000, IVA: 1710, MargenLogisticaInversa: 500, TipoTrayecto: 'Nacional' },
    { CodigoMunicipio: '13001', Flete: 9500, IVA: 1805, MargenLogisticaInversa: 700, TipoTrayecto: 'Regional' },
];

// ---------------------------------------------------------------------------
// Helper: parse an Excel file for carrier rates
// ---------------------------------------------------------------------------
type ParsedRateRow = CarrierRateRow & { _hasMargenInExcel: boolean };

function parseRatesExcel(buffer: ArrayBuffer): ParsedRateRow[] {
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    return rows.map(r => {
        const key = (k: string) => {
            const found = Object.keys(r).find(rk => rk.toLowerCase().replace(/\s/g, '') === k.toLowerCase().replace(/\s/g, ''));
            return found ? r[found] : undefined;
        };
        const flete = Number(key('flete')) || 0;
        const iva = Number(key('iva')) || 0;
        const margenRaw = key('margenlogisticainversa') ?? key('margen');
        const hasMargenInExcel = margenRaw !== undefined && margenRaw !== '' && !isNaN(Number(margenRaw));
        const margen = hasMargenInExcel ? Number(margenRaw) : 0;
        return {
            codigoMunicipio: String(key('codigomunicipio') ?? '').trim(),
            tipoTrayecto: String(key('tipotrayecto') ?? key('trayecto') ?? 'Nacional').trim(),
            flete,
            iva,
            margenLogisticaInversa: margen,
            total: flete + iva + margen,
            _hasMargenInExcel: hasMargenInExcel,
        };
    }).filter(r => r.codigoMunicipio && r.codigoMunicipio !== '0');
}

// ---------------------------------------------------------------------------
// Computed carrier score
// ---------------------------------------------------------------------------
function computeScore(
    carrier: string,
    config: CarrierScoreConfig | null
): number | null {
    if (!config?.scores?.[carrier]) return null;
    const s = config.scores[carrier];
    const w = config.criteriaWeights;
    let total = 0;
    CRITERIA_KEYS.forEach(k => { total += (s[k] || 0) * (w[k] || 0) / 100; });
    return Math.round(total * 10) / 10;
}

// ---------------------------------------------------------------------------
// Helper: Parse numerical strings safely supporting both dot and comma
// ---------------------------------------------------------------------------
const parseSafeFloat = (val: string | number | undefined | null): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    let s = val.trim();
    if (s.includes(',') && s.includes('.')) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const parsed = parseFloat(s.replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
};

// ---------------------------------------------------------------------------
// Sub-component: ScoreBadge
// ---------------------------------------------------------------------------
const ScoreBadge: React.FC<{ score: number | null }> = ({ score }) => {
    if (score === null) return null;
    const color = score >= 7 ? 'bg-green-100 text-green-800' : score >= 5 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
            <Star className="h-3 w-3" /> {score}/10
        </span>
    );
};

// ---------------------------------------------------------------------------
// Helper: Calculate COD fee based on rule
// ---------------------------------------------------------------------------
function calculateCODFee(amount: number, rule?: CODRule): number {
    if (!rule || amount <= 0) return 0;
    if (rule.type === 'simple') {
        const pct = rule.percentage || 0;
        const fee = (amount * pct) / 100;
        return Math.max(fee, rule.minFee || 0);
    }
    if (rule.type === 'tiered' && rule.tiers) {
        const tier = rule.tiers.find(t => amount >= t.min && amount <= t.max);
        if (tier) {
            return tier.feeType === 'fixed' ? tier.value : (amount * tier.value) / 100;
        }
    }
    return 0;
}

function isCODAvailable(carrier: string, codRules: Record<string, CODRule>): boolean {
    if (carrier === 'Logicuartas') return true;
    return !!codRules[carrier];
}

// ===========================================================================
// TAB 4 — Gestión de Datos Base (Admin only)
// ===========================================================================
const TabDatosBase: React.FC<{ carriersMetadata: { carrier: string; lastUpdated?: Date; count: number }[]; onRatesUploaded: () => void }> = ({ carriersMetadata, onRatesUploaded }) => {
    const { toast } = useToast();
    const [selectedCarrier, setSelectedCarrier] = useState('');
    const [margenOverride, setMargenOverride] = useState<string>('');
    const [isUploadingMunicipios, setIsUploadingMunicipios] = useState(false);
    const [isUploadingRates, setIsUploadingRates] = useState(false);
    const [insuranceRates, setInsuranceRates] = useState<Record<string, string>>({}); // % strings per carrier
    const [isSavingInsurance, setIsSavingInsurance] = useState(false);
    const [codRules, setCodRules] = useState<Record<string, CODRule>>({});
    const [isSavingCOD, setIsSavingCOD] = useState(false);
    const munRef = useRef<HTMLInputElement>(null);
    const ratesRef = useRef<HTMLInputElement>(null);

    // Load existing config on mount
    useEffect(() => {
        Promise.all([getCarrierInsuranceConfig(), getCarrierCODConfig()]).then(([ins, cod]) => {
            if (ins.success && ins.data) {
                const strMap: Record<string, string> = {};
                Object.entries(ins.data).forEach(([k, v]) => { strMap[k] = String(v); });
                setInsuranceRates(strMap);
            }
            if (cod.success && cod.data) setCodRules(cod.data);
        });
    }, []);

    const handleSaveInsurance = async () => {
        setIsSavingInsurance(true);
        try {
            const numMap: Record<string, number> = {};
            Object.entries(insuranceRates).forEach(([k, v]) => {
                const n = parseFloat(v);
                if (!isNaN(n) && n >= 0) numMap[k] = n;
            });
            const result = await saveCarrierInsuranceConfig(numMap);
            if (result.success) toast({ title: 'Tarifas de seguro guardadas' });
            else throw new Error(result.error);
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
        finally { setIsSavingInsurance(false); }
    };

    const handleSaveCOD = async () => {
        setIsSavingCOD(true);
        try {
            const result = await saveCarrierCODConfig(codRules);
            if (result.success) toast({ title: 'Reglas de COD guardadas' });
            else throw new Error(result.error);
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
        finally { setIsSavingCOD(false); }
    };

    const updateCODRule = (carrier: string, patch: Partial<CODRule>) => {
        setCodRules(prev => ({ ...prev, [carrier]: { ...(prev[carrier] || { type: 'simple' }), ...patch } }));
    };

    const addTier = (carrier: string) => {
        const current = codRules[carrier] || { type: 'simple', tiers: [] };
        const tiers = [...(current.tiers || [])];
        const lastMax = tiers.length > 0 ? tiers[tiers.length - 1].max : 0;
        tiers.push({ min: lastMax + 1, max: 99999999, feeType: 'percent', value: 3 });
        updateCODRule(carrier, { type: 'tiered', tiers });
    };

    const removeTier = (carrier: string, idx: number) => {
        const tiers = [...(codRules[carrier]?.tiers || [])];
        tiers.splice(idx, 1);
        updateCODRule(carrier, { tiers });
    };

    const updateTier = (carrier: string, idx: number, patch: Partial<CODTier>) => {
        const tiers = [...(codRules[carrier]?.tiers || [])];
        tiers[idx] = { ...tiers[idx], ...patch };
        updateCODRule(carrier, { tiers });
    };

    const handleMunicipiosUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        setIsUploadingMunicipios(true);
        try {
            const result = await saveMunicipios(await file.arrayBuffer());
            if (result.success) toast({ title: 'Municipios cargados', description: `${result.summary?.processed} municipios procesados.` });
            else throw new Error(result.error);
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
        finally { setIsUploadingMunicipios(false); if (munRef.current) munRef.current.value = ''; }
    };

    const handleRatesUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file || !selectedCarrier) return;
        setIsUploadingRates(true);
        try {
            const parsed = parseRatesExcel(await file.arrayBuffer());
            if (!parsed.length) throw new Error('No se encontraron filas válidas en el archivo.');

            // Margen logic: Excel value per row takes priority.
            // If a row has no margen in Excel, fall back to the UI field value.
            const uiMargenVal = parseFloat(margenOverride.replace(/[^0-9.]/g, ''));
            const uiFallback = !isNaN(uiMargenVal) && uiMargenVal >= 0 ? uiMargenVal : 0;

            const rates: CarrierRateRow[] = parsed.map(({ _hasMargenInExcel, ...r }) => {
                const margen = _hasMargenInExcel ? r.margenLogisticaInversa : uiFallback;
                return { ...r, margenLogisticaInversa: margen, total: r.flete + r.iva + margen };
            });

            const rowsWithExcel = parsed.filter(r => r._hasMargenInExcel).length;
            const rowsWithFallback = parsed.length - rowsWithExcel;

            const result = await saveCarrierCurrentRates(selectedCarrier, rates);
            if (result.success) {
                const detail = rowsWithFallback > 0
                    ? `${rowsWithExcel} con margen propio del Excel, ${rowsWithFallback} con margen global $${uiFallback.toLocaleString('es-CO')}.`
                    : `${rates.length} municipios, margen tomado del Excel.`;
                toast({ title: 'Tarifas guardadas', description: detail });
                onRatesUploaded();
            } else throw new Error(result.error);
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error al cargar tarifas', description: err.message }); }
        finally { setIsUploadingRates(false); if (ratesRef.current) ratesRef.current.value = ''; }
    };

    return (
        <div className="space-y-6">
            {/* Municipios */}
            <Card>
                <CardHeader>
                    <CardTitle>Base de Municipios</CardTitle>
                    <CardDescription>Excel con columnas: <code>Codigo | Municipio | Departamento</code></CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg">
                        <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" />
                        <div className="flex gap-2 mt-1">
                            <Button asChild size="sm" disabled={isUploadingMunicipios}>
                                <label htmlFor="mun-upload" className="cursor-pointer">
                                    {isUploadingMunicipios && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isUploadingMunicipios ? 'Procesando...' : 'Seleccionar archivo'}
                                </label>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => downloadTemplate('plantilla_municipios.xlsx', MUNICIPIOS_TEMPLATE)}>
                                Descargar Plantilla
                            </Button>
                        </div>
                        <input ref={munRef} id="mun-upload" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleMunicipiosUpload} />
                    </div>
                </CardContent>
            </Card>

            {/* Tarifas actuales */}
            <Card>
                <CardHeader>
                    <CardTitle>Tarifas Actuales por Transportadora</CardTitle>
                    <CardDescription>
                        Excel requerido: <code>CodigoMunicipio | Flete | IVA | TipoTrayecto</code>.<br />
                        Columna opcional: <code>MargenLogisticaInversa</code> — si se incluye, cada fila usa su propio valor (diferente por trayecto). Si no se incluye, se aplica el valor global definido abajo.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Transportadora</Label>
                            <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
                                <SelectTrigger><SelectValue placeholder="Seleccione..." /></SelectTrigger>
                                <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="margen-override">Margen Logística Inversa ($ COP por envío)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">$</span>
                                <Input
                                    id="margen-override"
                                    type="number"
                                    min={0}
                                    step={100}
                                    placeholder="Ej: 500"
                                    value={margenOverride}
                                    onChange={e => setMargenOverride(e.target.value)}
                                    className="pl-7"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">Valor en pesos que Branchos agrega por envío para cubrir devoluciones. Se aplicará a todos los municipios del archivo.</p>
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg">
                        <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" />
                        <div className="flex gap-2 mt-1">
                            <Button asChild size="sm" disabled={!selectedCarrier || isUploadingRates}>
                                <label htmlFor="rates-upload" className={selectedCarrier ? 'cursor-pointer' : 'cursor-not-allowed'}>
                                    {isUploadingRates && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isUploadingRates ? 'Guardando...' : !selectedCarrier ? 'Seleccione una transportadora primero' : 'Cargar tarifas'}
                                </label>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => downloadTemplate('plantilla_tarifas.xlsx', TARIFAS_TEMPLATE)}>
                                Descargar Plantilla
                            </Button>
                        </div>
                        <input ref={ratesRef} id="rates-upload" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleRatesUpload} disabled={!selectedCarrier} />
                    </div>
                </CardContent>
            </Card>

            {/* Insurance rates per carrier */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Tarifa de Seguro por Transportadora</CardTitle>
                    <CardDescription>
                        Porcentaje aplicado sobre el <strong>valor del producto</strong> para calcular el costo de seguro en el simulador.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {CARRIERS.map(carrier => (
                        <div key={carrier} className="flex items-center gap-3">
                            <Label className="w-36 flex-shrink-0 text-sm font-medium">{carrier}</Label>
                            <div className="relative w-36">
                                <Input
                                    type="number"
                                    min={0}
                                    max={10}
                                    step={0.01}
                                    placeholder="Ej: 0.8"
                                    value={insuranceRates[carrier] ?? ''}
                                    onChange={e => setInsuranceRates(prev => ({ ...prev, [carrier]: e.target.value }))}
                                    className="pr-6"
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {insuranceRates[carrier] ? `$${(10000 * parseSafeFloat(insuranceRates[carrier]) / 100).toLocaleString('es-CO')} por cada $10.000 de valor` : ''}
                            </span>
                        </div>
                    ))}
                    <Button onClick={handleSaveInsurance} disabled={isSavingInsurance}>
                        {isSavingInsurance && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar tarifas de seguro
                    </Button>
                </CardContent>
            </Card>

            {/* COD Commission Rules */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Tarifa de Contraentrega (COD) por Transportadora</CardTitle>
                    <CardDescription>Configura cómo cada transportadora cobra por el recaudo del dinero en destino.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {CARRIERS.map(carrier => {
                        const rule = codRules[carrier] || { type: 'simple', percentage: 0 };
                        return (
                            <div key={carrier} className="p-4 border rounded-lg space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="font-bold text-base">{carrier}</Label>
                                    <Select value={rule.type} onValueChange={v => updateCODRule(carrier, { type: v as any })}>
                                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="simple">Porcentaje Fijo</SelectItem>
                                            <SelectItem value="tiered">Escala / Rangos</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {rule.type === 'simple' ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-xs">Porcentaje de Comisión</Label>
                                            <div className="relative">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="Ej: 3,5"
                                                    value={rule.percentage ?? ''}
                                                    onChange={e => updateCODRule(carrier, { percentage: parseSafeFloat(e.target.value) })}
                                                    className="pr-6"
                                                />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs">Mínimo Cobrado (Floor)</Label>
                                            <div className="relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                                <Input
                                                    type="text"
                                                    inputMode="numeric"
                                                    placeholder="5000"
                                                    value={rule.minFee ?? ''}
                                                    onChange={e => updateCODRule(carrier, { minFee: parseSafeFloat(e.target.value) })}
                                                    className="pl-5"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow className="bg-muted/50">
                                                        <TableHead className="h-8 text-[10px]">Mínimo</TableHead>
                                                        <TableHead className="h-8 text-[10px]">Máximo</TableHead>
                                                        <TableHead className="h-8 text-[10px]">Tipo</TableHead>
                                                        <TableHead className="h-8 text-[10px]">Valor</TableHead>
                                                        <TableHead className="h-8 w-10"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {rule.tiers?.map((t, idx) => (
                                                        <TableRow key={idx}>
                                                            <TableCell><Input className="h-7 text-xs" type="text" inputMode="numeric" value={t.min} onChange={e => updateTier(carrier, idx, { min: parseSafeFloat(e.target.value) })} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs" type="text" inputMode="numeric" value={t.max} onChange={e => updateTier(carrier, idx, { max: parseSafeFloat(e.target.value) })} /></TableCell>
                                                            <TableCell>
                                                                <select className="h-7 text-xs bg-background border rounded px-1" value={t.feeType} onChange={e => updateTier(carrier, idx, { feeType: e.target.value as any })}>
                                                                    <option value="percent">%</option>
                                                                    <option value="fixed">$ Fixed</option>
                                                                </select>
                                                            </TableCell>
                                                            <TableCell><Input className="h-7 text-xs" type="text" inputMode="decimal" value={t.value} onChange={e => updateTier(carrier, idx, { value: parseSafeFloat(e.target.value) })} /></TableCell>
                                                            <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeTier(carrier, idx)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => addTier(carrier)} className="w-full text-xs h-8">
                                            <Plus className="h-3 w-3 mr-1" /> Añadir Rango
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <Button onClick={handleSaveCOD} disabled={isSavingCOD} className="w-full">
                        {isSavingCOD && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar Reglas de Contraentrega
                    </Button>
                </CardContent>
            </Card>

            {/* Status de carriers cargados */}
            {carriersMetadata.length > 0 && (
                <Card>
                    <CardHeader><CardTitle>Transportadoras con tarifas cargadas</CardTitle></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Transportadora</TableHead>
                                    <TableHead>Municipios</TableHead>
                                    <TableHead>Última actualización</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {carriersMetadata.map(m => (
                                    <TableRow key={m.carrier}>
                                        <TableCell className="font-medium">{m.carrier}</TableCell>
                                        <TableCell>{m.count}</TableCell>
                                        <TableCell>{fmtDate(m.lastUpdated)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

// ===========================================================================
// TAB — Simulador de Costos de Envío
// ===========================================================================
interface SimResult {
    carrier: string;
    flete: number;
    iva: number;
    margen: number;
    seguro: number;
    codFee: number;
    total: number;
    normalTotal: number;
    hasCODService: boolean;
}

const TabSimulador: React.FC<{ carriersMetadata: { carrier: string }[]; codRules: Record<string, CODRule> }> = ({ carriersMetadata, codRules }) => {
    const { toast } = useToast();
    const [munMap, setMunMap] = useState<Record<string, { nombre: string; departamento: string }>>({});
    const [allRates, setAllRates] = useState<Record<string, CarrierRateRow[]>>({});
    const [insuranceConfig, setInsuranceConfig] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [searchText, setSearchText] = useState('');
    const [selectedCode, setSelectedCode] = useState('');
    const [productValue, setProductValue] = useState('');
    const [isCOD, setIsCOD] = useState(false);
    const [codAmount, setCodAmount] = useState('');
    const [results, setResults] = useState<SimResult[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const availableCarriers = carriersMetadata.map(m => m.carrier);

    useEffect(() => {
        setIsLoading(true);
        Promise.all([
            Promise.all(availableCarriers.map(c => getCarrierCurrentRates(c).then(r => ({ carrier: c, rates: r.data?.rates || [] })))),
            getMunicipiosMap(),
            getCarrierInsuranceConfig(),
        ]).then(([ratesResults, munResult, insuranceResult]) => {
            const rMap: Record<string, CarrierRateRow[]> = {};
            (ratesResults as { carrier: string; rates: CarrierRateRow[] }[]).forEach(({ carrier, rates }) => { rMap[carrier] = rates; });
            setAllRates(rMap);
            if (munResult.success) setMunMap(munResult.data || {});
            if (insuranceResult.success) setInsuranceConfig(insuranceResult.data || {});
        }).catch(() => toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos.' }))
          .finally(() => setIsLoading(false));
    }, [carriersMetadata]);

    // Suggestions autocomplete
    const suggestions = searchText.length >= 2
        ? Object.entries(munMap)
            .filter(([code, info]) => {
                const q = searchText.toLowerCase();
                return info.nombre.toLowerCase().includes(q) || code.includes(q) || info.departamento.toLowerCase().includes(q);
            })
            .slice(0, 10)
        : [];

    const selectMunicipio = (code: string) => {
        const info = munMap[code];
        setSelectedCode(code);
        setSearchText(info ? `${info.nombre} (${code})` : code);
        setShowSuggestions(false);
        setResults([]);
    };

    const simulate = () => {
        if (!selectedCode) { toast({ variant: 'destructive', title: 'Selecciona un destino' }); return; }
        const val = parseSafeFloat(productValue);
        if (val <= 0) { toast({ variant: 'destructive', title: 'Ingresa el valor del producto' }); return; }

        const recaudo = isCOD ? parseSafeFloat(codAmount) : 0;

        const sim: SimResult[] = availableCarriers.map(carrier => {
            const row = (allRates[carrier] || []).find(r => r.codigoMunicipio === selectedCode);
            if (!row) return { carrier, flete: 0, iva: 0, margen: 0, seguro: 0, codFee: 0, total: 0, normalTotal: 0, hasCODService: false };
            const insurancePct = insuranceConfig[carrier] ?? 0;
            const seguro = Math.round(val * insurancePct / 100);
            const hasCODService = isCODAvailable(carrier, codRules);
            const codFee = (isCOD && hasCODService) ? calculateCODFee(recaudo, codRules[carrier]) : 0;
            const normalTotal = row.total + seguro;
            return {
                carrier,
                flete: row.flete,
                iva: row.iva,
                margen: row.margenLogisticaInversa,
                seguro,
                codFee,
                total: normalTotal + (isCOD && hasCODService ? codFee : 0),
                normalTotal,
                hasCODService,
            };
        }).filter(r => r.flete > 0 || r.seguro > 0 || (isCOD && r.hasCODService));

        const sorted = [...sim].sort((a, b) => a.total - b.total);
        setResults(sorted);
    };

    const rankColors = ['bg-green-50 dark:bg-green-950', 'bg-amber-50 dark:bg-amber-950', 'bg-orange-50 dark:bg-orange-950', ''];
    const rankBadgeColors = ['bg-green-600', 'bg-amber-500', 'bg-orange-500', 'bg-slate-400'];
    const rankTextColors = ['text-green-700 dark:text-green-400', 'text-amber-700 dark:text-amber-400', 'text-orange-600 dark:text-orange-400', 'text-muted-foreground'];

    if (isLoading) return (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="animate-spin h-6 w-6" /> Cargando datos para el simulador...
        </div>
    );

    if (!availableCarriers.length) return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <Database className="h-10 w-10" />
            <p>No hay tarifas cargadas. Carga tarifas en el Tab "Datos Base" primero.</p>
        </div>
    );

    const munInfo = selectedCode ? munMap[selectedCode] : null;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Simulador de Costos de Envío</CardTitle>
                    <CardDescription>Selecciona el destino e ingresa el valor del producto para ver la liquidación completa por cada transportadora.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Municipio autocomplete */}
                        <div className="md:col-span-2 space-y-2 relative">
                            <Label htmlFor="sim-mun">Municipio de destino</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="sim-mun"
                                    className="pl-9"
                                    placeholder="Escribe el nombre o código del municipio..."
                                    value={searchText}
                                    onChange={e => { setSearchText(e.target.value); setSelectedCode(''); setShowSuggestions(true); setResults([]); }}
                                    onFocus={() => setShowSuggestions(true)}
                                    autoComplete="off"
                                />
                            </div>
                            {showSuggestions && suggestions.length > 0 && (
                                <div className="absolute z-50 w-full bg-background border rounded-lg shadow-lg top-full mt-1 max-h-60 overflow-y-auto">
                                    {suggestions.map(([code, info]) => (
                                        <button
                                            key={code}
                                            className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm flex justify-between items-center"
                                            onMouseDown={() => selectMunicipio(code)}
                                        >
                                            <span className="font-medium">{info.nombre}</span>
                                            <span className="text-xs text-muted-foreground">{info.departamento} · {code}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Product value */}
                        <div className="space-y-2">
                            <Label htmlFor="sim-valor">Valor del producto ($ COP)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">$</span>
                                <Input
                                    id="sim-valor"
                                    type="number"
                                    min={0}
                                    step={1000}
                                    placeholder="Ej: 150000"
                                    value={productValue}
                                    onChange={e => { setProductValue(e.target.value); setResults([]); }}
                                    className="pl-7"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div className="flex items-center space-x-2 border p-3 rounded-lg">
                            <Switch id="cod-toggle" checked={isCOD} onCheckedChange={setIsCOD} />
                            <div className="grid gap-1.5 leading-none">
                                <label htmlFor="cod-toggle" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    Servicio Contraentrega (COD)
                                </label>
                                <p className="text-xs text-muted-foreground">Incluir comisión por recaudo de dinero.</p>
                            </div>
                        </div>

                        {isCOD && (
                            <div className="space-y-2">
                                <Label htmlFor="cod-amount">Monto a recaudar ($ COP)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold">$</span>
                                    <Input
                                        id="cod-amount"
                                        type="number"
                                        min={0}
                                        step={1000}
                                        placeholder="Ej: 180000"
                                        value={codAmount}
                                        onChange={e => { setCodAmount(e.target.value); setResults([]); }}
                                        className="pl-7"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <Button className="mt-6 w-full md:w-auto" onClick={simulate} disabled={!selectedCode || !productValue || (isCOD && !codAmount)}>
                        <Calculator className="mr-2 h-4 w-4" /> Calcular costos
                    </Button>
                </CardContent>
            </Card>

            {/* Results */}
            {results.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Liquidación para <span className="text-primary">{munInfo?.nombre ?? selectedCode}</span>
                            {munInfo && <span className="text-sm font-normal text-muted-foreground ml-2">— {munInfo.departamento}</span>}
                        </CardTitle>
                        <CardDescription>
                            Producto: <strong>{fmt(parseFloat(productValue))}</strong>
                            {isCOD && <> · Recaudo COD: <strong>{fmt(parseFloat(codAmount))}</strong></>}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-8">#</TableHead>
                                    <TableHead>Transportadora</TableHead>
                                    <TableHead className="text-right">Flete+IVA+Margen</TableHead>
                                    <TableHead className="text-right">Seguro</TableHead>
                                    {isCOD && <TableHead className="text-right">Recaudo COD</TableHead>}
                                    <TableHead className="text-right font-bold">TOTAL</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(() => {
                                    const minNormal = results.length > 0 ? Math.min(...results.filter(r => r.normalTotal > 0).map(r => r.normalTotal)) : Infinity;
                                    const validCOD = results.filter(r => r.hasCODService && r.total > 0);
                                    const minCOD = validCOD.length > 0 ? Math.min(...validCOD.map(r => r.total)) : Infinity;

                                    return results.map((r, idx) => {
                                        const colorIdx = Math.min(idx, 3);
                                        const insurancePct = insuranceConfig[r.carrier] ?? 0;
                                        const baseCost = r.flete + r.iva + r.margen;
                                        const isNormalWinner = r.normalTotal === minNormal;
                                        const isCODWinner = isCOD && r.hasCODService && r.total === minCOD;
                                        const isCODUnavailable = isCOD && !r.hasCODService;

                                        return (
                                            <TableRow key={r.carrier} className={rankColors[colorIdx]}>
                                                <TableCell>
                                                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold ${rankBadgeColors[colorIdx]}`}>
                                                        {idx + 1}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <div className="flex flex-col">
                                                        <span className="flex items-center gap-2">
                                                            {r.carrier}
                                                            {isNormalWinner && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50 px-1 py-0 h-4">Líder Envío</Badge>}
                                                            {isCODWinner && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200 bg-green-50 px-1 py-0 h-4">Líder COD</Badge>}
                                                            {isCODUnavailable && <Badge variant="outline" className="text-[10px] text-red-400 border-red-200 bg-red-50/50 px-1 py-0 h-4">Sin COD</Badge>}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right text-xs">{fmt(baseCost)}</TableCell>
                                                <TableCell className="text-right text-xs">
                                                    <div className="flex flex-col items-end">
                                                        <span>{r.seguro > 0 ? fmt(r.seguro) : '—'}</span>
                                                        {insurancePct > 0 && <span className="text-[10px] text-muted-foreground">({insurancePct}%)</span>}
                                                    </div>
                                                </TableCell>
                                                {isCOD && (
                                                    <TableCell className="text-right text-xs">
                                                        {isCODUnavailable ? (
                                                            <span className="text-red-400 italic">No disponible</span>
                                                        ) : (
                                                            r.codFee > 0 ? fmt(r.codFee) : '—'
                                                        )}
                                                    </TableCell>
                                                )}
                                                <TableCell className={`text-right text-sm font-bold ${rankTextColors[colorIdx]} tabular-nums`}>
                                                    {isCOD && !r.hasCODService ? '—' : fmt(r.total)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    });
                                })()}
                            </TableBody>
                        </Table>

                        {/* Cheapest savings note */}
                        {results.length >= 2 && (
                            <p className="text-xs text-muted-foreground mt-3">
                                💡 Con <strong>{results[0].carrier}</strong> ahorras <strong>{fmt(results[results.length - 1].total - results[0].total)}</strong> vs. la opción más cara ({results[results.length - 1].carrier}).
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

// ===========================================================================
// TAB 2 — Comparativo de Tarifas Actuales
// ===========================================================================
const TabComparativo: React.FC<{ carriersMetadata: { carrier: string; lastUpdated?: Date; count: number }[]; scoreConfig: CarrierScoreConfig | null; codRules: Record<string, CODRule> }> = ({ carriersMetadata, scoreConfig, codRules }) => {
    const { toast } = useToast();
    const [allRates, setAllRates] = useState<Record<string, CarrierRateRow[]>>({});
    const [munMap, setMunMap] = useState<Record<string, { nombre: string; departamento: string }>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [trayectoFilter, setTrayectoFilter] = useState('Todos');
    const [search, setSearch] = useState('');
    const [showSummary, setShowSummary] = useState(true);
    const [expandedCarriers, setExpandedCarriers] = useState<Set<string>>(new Set());
    const [simAmount, setSimAmount] = useState<string>('0');
    const [isSimulatingCOD, setIsSimulatingCOD] = useState(false);

    const availableCarriers = carriersMetadata.map(m => m.carrier);
    const simVal = isSimulatingCOD ? parseSafeFloat(simAmount) : 0;

    useEffect(() => {
        if (!availableCarriers.length) return;
        setIsLoading(true);
        Promise.all([
            // Load all carrier rates in parallel
            Promise.all(availableCarriers.map(c => getCarrierCurrentRates(c).then(r => ({ carrier: c, rates: r.data?.rates || [] })))),
            // Load municipios map
            getMunicipiosMap(),
        ])
            .then(([ratesResults, munResult]) => {
                const rMap: Record<string, CarrierRateRow[]> = {};
                (ratesResults as { carrier: string; rates: CarrierRateRow[] }[]).forEach(({ carrier, rates }) => { rMap[carrier] = rates; });
                setAllRates(rMap);
                if (munResult.success) setMunMap(munResult.data || {});
            })
            .catch(() => toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las tarifas.' }))
            .finally(() => setIsLoading(false));
    }, [carriersMetadata]);

    // Build unified list of codes
    const allCodes = Array.from(new Set(Object.values(allRates).flatMap(rates => rates.map(r => r.codigoMunicipio))));

    const getMunInfo = (code: string) => munMap[code] || { nombre: code, departamento: '' };

    const filtered = allCodes.filter(code => {
        const sampleRate = Object.values(allRates).flatMap(r => r).find(r => r.codigoMunicipio === code);
        if (trayectoFilter !== 'Todos' && sampleRate?.tipoTrayecto !== trayectoFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            const mun = getMunInfo(code);
            if (!code.toLowerCase().includes(q) && !mun.nombre.toLowerCase().includes(q) && !mun.departamento.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    // --- Trayecto summary per carrier ---
    const trayectosPresentes = Array.from(new Set(Object.values(allRates).flatMap(r => r.map(x => x.tipoTrayecto)))).sort();

    const trayectoSummary = trayectosPresentes.map(trayecto => {
        const carrierStats = availableCarriers.map(carrier => {
            const rows = (allRates[carrier] || []).filter(r => r.tipoTrayecto === trayecto);
            if (!rows.length) return { carrier, count: 0, avgTotal: null, minTotal: null, maxTotal: null };
            const totals = rows.map(r => r.total);
            return {
                carrier,
                count: rows.length,
                avgTotal: Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length),
                minTotal: Math.min(...totals),
                maxTotal: Math.max(...totals),
            };
        });
        // Find the carrier with the lowest avg for this trayecto
        const minAvg = Math.min(...carrierStats.filter(c => c.avgTotal !== null).map(c => c.avgTotal as number));
        return { trayecto, carrierStats, minAvg };
    });

    if (!availableCarriers.length) return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <Database className="h-10 w-10" />
            <p>No hay tarifas cargadas aún. Ve al Tab "Gestión de Datos Base" para cargar tarifas.</p>
        </div>
    );

    if (isLoading) return (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="animate-spin h-6 w-6" /> Cargando tarifas y municipios...
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Carrier summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {availableCarriers.map(carrier => {
                    const rates = allRates[carrier] || [];
                    const avg = rates.length ? rates.reduce((s, r) => s + r.total, 0) / rates.length : 0;
                    const score = computeScore(carrier, scoreConfig);
                    const meta = carriersMetadata.find(m => m.carrier === carrier);
                    return (
                        <Card key={carrier} className="p-3">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm truncate">{carrier}</span>
                                <ScoreBadge score={score} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{rates.length} municipios</p>
                            <p className="text-sm font-bold mt-1">{fmt(Math.round(avg))} <span className="text-xs font-normal text-muted-foreground">prom. total</span></p>
                            <p className="text-xs text-muted-foreground">Act: {fmtDate(meta?.lastUpdated)}</p>
                        </Card>
                    );
                })}
            </div>

            {/* Trayecto summary */}
            {trayectoSummary.length > 0 && (
                <Card>
                    <CardHeader className="pb-2 cursor-pointer flex flex-row items-center justify-between" onClick={() => setShowSummary(s => !s)}>
                        <CardTitle className="text-base flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" /> Resumen por Tipo de Trayecto
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">{showSummary ? 'Ocultar ▲' : 'Mostrar ▼'}</span>
                    </CardHeader>
                    {showSummary && (
                        <CardContent className="pt-0 space-y-4">
                            {trayectoSummary.map(({ trayecto, carrierStats, minAvg }) => (
                                <div key={trayecto}>
                                    <h4 className="text-sm font-semibold mb-2 text-muted-foreground">{trayecto}</h4>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Transportadora</TableHead>
                                                    <TableHead className="text-right">Municipios</TableHead>
                                                    <TableHead className="text-right">Total Mín.</TableHead>
                                                    <TableHead className="text-right">Total Prom.</TableHead>
                                                    <TableHead className="text-right">Total Máx.</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {carrierStats.map(stat => {
                                                    const isBest = stat.avgTotal !== null && stat.avgTotal === minAvg;
                                                    return (
                                                        <TableRow key={stat.carrier} className={isBest ? 'bg-green-50 dark:bg-green-950' : ''}>
                                                            <TableCell className="font-medium text-sm">
                                                                {stat.carrier}
                                                                {isBest && <span className="ml-2 text-xs text-green-600 font-semibold">★ más económico</span>}
                                                            </TableCell>
                                                            <TableCell className="text-right text-sm">{stat.count || '—'}</TableCell>
                                                            <TableCell className="text-right text-sm">{stat.minTotal !== null ? fmt(stat.minTotal) : '—'}</TableCell>
                                                            <TableCell className={`text-right text-sm font-bold ${isBest ? 'text-green-700 dark:text-green-400' : ''}`}>{stat.avgTotal !== null ? fmt(stat.avgTotal) : '—'}</TableCell>
                                                            <TableCell className="text-right text-sm">{stat.maxTotal !== null ? fmt(stat.maxTotal) : '—'}</TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    )}
                </Card>
            )}

            {/* Filters */}
            <div className="flex flex-col xl:flex-row gap-3 items-center">
                <div className="flex items-center gap-2 flex-1 w-full">
                    <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input placeholder="Buscar por código, municipio o departamento..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="flex items-center gap-3 w-full xl:w-auto">
                    <Select value={trayectoFilter} onValueChange={setTrayectoFilter}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{TRAYECTO_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>

                    <div className="flex items-center gap-2 border px-3 py-1.5 rounded-lg bg-muted/20">
                        <CreditCard className={`h-4 w-4 ${isSimulatingCOD ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="text-xs font-medium whitespace-nowrap">Simular COD:</span>
                        <Switch checked={isSimulatingCOD} onCheckedChange={setIsSimulatingCOD} />
                        {isSimulatingCOD && (
                            <div className="relative w-28">
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px]">$</span>
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    className="h-7 text-xs pl-4 pr-1"
                                    value={simAmount}
                                    onChange={e => setSimAmount(e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Detail comparison table */}
            <div className="overflow-x-auto rounded-lg border max-h-[62vh] overflow-y-auto">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-20">
                        <TableRow>
                            <TableHead className="sticky left-0 bg-background z-30 min-w-[90px]">Código</TableHead>
                            <TableHead className="min-w-[150px]">Municipio</TableHead>
                            <TableHead className="min-w-[110px]">Depto.</TableHead>
                            <TableHead className="min-w-[80px]">Trayecto</TableHead>
                            {availableCarriers.map(c => {
                                const isExpanded = expandedCarriers.has(c);
                                return isExpanded ? (
                                    <TableHead key={c} className="text-center min-w-[220px]" colSpan={isSimulatingCOD ? 5 : 4}>
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="font-bold text-xs truncate max-w-[130px]">{c}</span>
                                            <button
                                                onClick={() => setExpandedCarriers(prev => { const s = new Set(prev); s.delete(c); return s; })}
                                                className="text-xs text-muted-foreground hover:text-foreground border rounded px-1 leading-none flex-shrink-0"
                                                title="Colapsar desglose"
                                            >−</button>
                                        </div>
                                        <div className={`grid ${isSimulatingCOD ? 'grid-cols-5' : 'grid-cols-4'} text-[10px] font-normal text-muted-foreground mt-0.5 whitespace-nowrap`}>
                                            <span>Flete</span><span>IVA</span><span>Margen</span>{isSimulatingCOD && <span>COD</span>}<span className="font-semibold text-foreground">Total</span>
                                        </div>
                                    </TableHead>
                                ) : (
                                    <TableHead key={c} className="text-right min-w-[100px]">
                                        <div className="flex items-center justify-end gap-1">
                                            <span className="font-bold text-xs truncate max-w-[70px]">{c}</span>
                                            <button
                                                onClick={() => setExpandedCarriers(prev => new Set([...prev, c]))}
                                                className="text-xs text-muted-foreground hover:text-foreground border rounded px-1 leading-none flex-shrink-0"
                                                title="Ver desglose"
                                            >+</button>
                                        </div>
                                        <div className="text-xs font-normal text-muted-foreground">{isSimulatingCOD ? 'T + COD' : 'Total'}</div>
                                    </TableHead>
                                );
                            })}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.slice(0, 300).map(code => {
                            const withData = availableCarriers
                                .map(c => {
                                    const r = (allRates[c] || []).find(x => x.codigoMunicipio === code);
                                    if (!r) return null;
                                    const hasCOD = isCODAvailable(c, codRules);
                                    if (isSimulatingCOD && !hasCOD) return { c, r, effectiveTotal: Infinity, codFee: 0, noService: true };
                                    const codFee = isSimulatingCOD ? calculateCODFee(simVal, codRules[c]) : 0;
                                    return { c, r, effectiveTotal: r.total + codFee, codFee, noService: false };
                                })
                                .filter(x => x !== null) as { c: string; r: CarrierRateRow; effectiveTotal: number; codFee: number; noService: boolean }[];

                            const sorted = [...withData].filter(x => !x.noService).sort((a, b) => a.effectiveTotal - b.effectiveTotal);
                            const rankMap = new Map<string, number>();
                            sorted.forEach(({ c }, idx) => rankMap.set(c, idx + 1));

                            const sampleRow = withData[0]?.r;
                            const mun = getMunInfo(code);

                            const rankStyle = (rank: number) => {
                                if (rank === 1) return { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', badge: 'bg-green-600' };
                                if (rank === 2) return { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500' };
                                if (rank === 3) return { bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-700 dark:text-orange-400', badge: 'bg-orange-500' };
                                return { bg: '', text: 'text-muted-foreground', badge: 'bg-slate-400' };
                            };

                            return (
                                <TableRow key={code}>
                                    <TableCell className="sticky left-0 bg-background z-10 font-mono text-[10px] font-semibold">{code}</TableCell>
                                    <TableCell className="text-[10px] font-medium max-w-[120px] truncate">{mun.nombre}</TableCell>
                                    <TableCell className="text-[10px] text-muted-foreground">{mun.departamento}</TableCell>
                                    <TableCell className="text-[10px]">{sampleRow?.tipoTrayecto || '—'}</TableCell>
                                    {availableCarriers.map(c => {
                                        const data = withData.find(x => x.c === c);
                                        const rank = rankMap.get(c);
                                        const style = rank ? rankStyle(rank) : { bg: '', text: '', badge: '' };
                                        const isExpanded = expandedCarriers.has(c);
                                        const hasCOD = isCODAvailable(c, codRules);

                                        if (!data) {
                                            return isExpanded
                                                ? <TableCell key={c} colSpan={isSimulatingCOD ? 5 : 4} className="text-center text-[10px] text-muted-foreground">—</TableCell>
                                                : <TableCell key={c} className="text-center text-[10px] text-muted-foreground">—</TableCell>;
                                        }

                                        if (data.noService) {
                                             return isExpanded
                                                ? <TableCell key={c} colSpan={5} className="text-center text-[10px] text-red-400 bg-red-50/20 italic">Sin Servicio COD</TableCell>
                                                : <TableCell key={c} className="text-center text-[10px] text-red-400 bg-red-50/20 italic">Sin COD</TableCell>;
                                        }

                                        const rankBadge = rank !== undefined && withData.length > 1 ? (
                                            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] font-bold flex-shrink-0 ${style.badge}`}>
                                                {rank}
                                            </span>
                                        ) : null;

                                        if (isExpanded) {
                                            return (
                                                <TableCell key={c} colSpan={isSimulatingCOD ? 5 : 4} className={`text-[10px] ${style.bg}`}>
                                                    <div className={`grid ${isSimulatingCOD ? 'grid-cols-5' : 'grid-cols-4'} gap-1 items-center`}>
                                                        <span>{fmt(data.r.flete)}</span>
                                                        <span>{fmt(data.r.iva)}</span>
                                                        <span>{fmt(data.r.margenLogisticaInversa)}</span>
                                                        {isSimulatingCOD && <span className="italic">{fmt(data.codFee)}</span>}
                                                        <span className={`font-bold flex items-center justify-end gap-1 ${style.text}`}>
                                                            {rankBadge}
                                                            {fmt(data.effectiveTotal)}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                            );
                                        }

                                        return (
                                            <TableCell key={c} className={`text-right text-[10px] font-bold border-x ${style.bg} ${style.text}`}>
                                                <div className="flex items-center justify-end gap-1">
                                                    {rankBadge}
                                                    {fmt(data.effectiveTotal)}
                                                </div>
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                        {filtered.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4 + availableCarriers.reduce((s, c) => s + (expandedCarriers.has(c) ? 4 : 1), 0)} className="text-center text-muted-foreground py-8">
                                    Sin resultados para los filtros actuales.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                {filtered.length > 300 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 300 de {filtered.length} municipios. Usa el buscador para refinar.</p>}
            </div>
        </div>
    );
};





// ===========================================================================
// TAB — Comparativo de Recaudo COD
// ===========================================================================
const TabRecaudoCOD: React.FC = () => {
    const { toast } = useToast();
    const [codRules, setCodRules] = useState<Record<string, CODRule>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        getCarrierCODConfig().then(r => {
            if (r.success) setCodRules(r.data || {});
            else toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las reglas de COD.' });
            setIsLoading(false);
        });
    }, []);

    const testAmounts = [50000, 100000, 200000, 500000, 1000000, 2000000];

    if (isLoading) return <div className="p-10 text-center text-muted-foreground"><Loader2 className="animate-spin mx-auto mb-2" /> Cargando comparativo de recaudo...</div>;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Análisis Comparativo de Comisiones por Recaudo (COD)</CardTitle>
                    <CardDescription>Comparativa de cuánto cobra cada transportadora por recaudar diferentes montos de dinero.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="min-w-[150px]">Transportadora</TableHead>
                                    {testAmounts.map(amt => (
                                        <TableHead key={amt} className="text-right whitespace-nowrap">Recaudo {fmt(amt)}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {CARRIERS.map(carrier => {
                                    const rule = codRules[carrier];
                                    return (
                                        <TableRow key={carrier} className="hover:bg-muted/30">
                                            <TableCell className="font-semibold">
                                                {carrier}
                                                <div className="text-[10px] text-muted-foreground font-normal">
                                                    {rule?.type === 'simple'
                                                        ? `${rule.percentage}% ${rule.minFee ? `(mín. ${fmt(rule.minFee)})` : ''}`
                                                        : rule?.type === 'tiered'
                                                            ? `${rule.tiers?.length} rangos definidos`
                                                            : 'Sin configurar'}
                                                </div>
                                            </TableCell>
                                            {testAmounts.map(amt => {
                                                const fee = calculateCODFee(amt, rule);
                                                const pctOfAmt = amt > 0 ? (fee / amt) * 100 : 0;
                                                return (
                                                    <TableCell key={amt} className="text-right">
                                                        <div className="font-medium text-sm">{fee > 0 ? fmt(fee) : '—'}</div>
                                                        <div className="text-[10px] text-muted-foreground">{fee > 0 ? `${pctOfAmt.toFixed(1)}% real` : ''}</div>
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                        {CARRIERS.map(carrier => {
                            const rule = codRules[carrier];
                            if (!rule || rule.type !== 'tiered') return null;
                            return (
                                <Card key={carrier} className="bg-muted/20 border-dashed">
                                    <CardHeader className="py-3 px-4">
                                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                                            Escala de {carrier}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="py-0 px-4 pb-4">
                                        <ul className="space-y-1">
                                            {rule.tiers?.map((t, idx) => (
                                                <li key={idx} className="text-xs flex justify-between border-b border-muted py-1 last:border-0">
                                                    <span className="text-muted-foreground">{fmt(t.min)} - {fmt(t.max)}:</span>
                                                    <span className="font-medium">{t.feeType === 'fixed' ? fmt(t.value) : `${t.value}%`}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

// ===========================================================================
// TAB 3 — Ponderación de Transportadoras
// ===========================================================================
const TabPonderacion: React.FC<{ isAdmin: boolean; scoreConfig: CarrierScoreConfig | null; onSaved: (config: CarrierScoreConfig) => void }> = ({ isAdmin, scoreConfig, onSaved }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const [weights, setWeights] = useState<Record<CriteriaKey, number>>(scoreConfig?.criteriaWeights ?? DEFAULT_WEIGHTS);
    const [scores, setScores] = useState<Record<string, Record<CriteriaKey, number>>>(scoreConfig?.scores ?? {});

    useEffect(() => {
        if (scoreConfig) {
            setWeights(scoreConfig.criteriaWeights ?? DEFAULT_WEIGHTS);
            setScores(scoreConfig.scores ?? {});
        }
    }, [scoreConfig]);

    const totalWeight = CRITERIA_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);

    const getOrInitCarrier = (c: string) => scores[c] ?? { ...DEFAULT_SCORE };

    const computedRankings = CARRIERS.map(carrier => {
        const s = scores[carrier];
        if (!s) return { carrier, total: null };
        const total = CRITERIA_KEYS.reduce((sum, k) => sum + (s[k] || 0) * (weights[k] || 0) / 100, 0);
        return { carrier, total: Math.round(total * 10) / 10, scores: s };
    }).filter(x => x.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

    const handleSave = async () => {
        if (totalWeight !== 100) { toast({ variant: 'destructive', title: 'Error', description: `Los pesos deben sumar 100%. Actualmente suman ${totalWeight}%.` }); return; }
        setIsSaving(true);
        const config: CarrierScoreConfig = { criteriaWeights: weights, scores };
        const result = await saveCarrierScores(config, user?.uid || '');
        if (result.success) { toast({ title: 'Ponderación guardada' }); onSaved(config); }
        else toast({ variant: 'destructive', title: 'Error', description: result.error });
        setIsSaving(false);
    };

    return (
        <div className="space-y-6">
            {/* Rankings */}
            {computedRankings.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-500" /> Ranking de Transportadoras</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        {computedRankings.map((item, idx) => (
                            <div key={item.carrier} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">#{idx + 1} {item.carrier}</span>
                                    <span className="font-bold">{item.total}/10</span>
                                </div>
                                <Progress value={(item.total ?? 0) * 10} className="h-2" />
                                <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                                    {CRITERIA_KEYS.map(k => (
                                        <span key={k}>{CRITERIA_LABELS[k]}: {item.scores?.[k] ?? '—'}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Config (admin only) */}
            {isAdmin && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Configurar Pesos (%)</CardTitle>
                            <CardDescription className={totalWeight !== 100 ? 'text-destructive font-semibold' : 'text-green-600 font-semibold'}>
                                Total: {totalWeight}% {totalWeight !== 100 ? '— deben sumar 100%' : '✓'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {CRITERIA_KEYS.map(k => (
                                <div key={k} className="space-y-1">
                                    <Label htmlFor={`w-${k}`}>{CRITERIA_LABELS[k]}</Label>
                                    <div className="flex items-center gap-1">
                                        <Input id={`w-${k}`} type="number" min={0} max={100} value={weights[k]}
                                            onChange={e => setWeights(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                                            className="w-20"
                                        />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Scores por Transportadora (0–10)</CardTitle>
                            <CardDescription>Asigne un puntaje basado en su experiencia con cada carrier.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Transportadora</TableHead>
                                            {CRITERIA_KEYS.map(k => <TableHead key={k}>{CRITERIA_LABELS[k]}</TableHead>)}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {CARRIERS.map(carrier => {
                                            const s = getOrInitCarrier(carrier);
                                            return (
                                                <TableRow key={carrier}>
                                                    <TableCell className="font-medium">{carrier}</TableCell>
                                                    {CRITERIA_KEYS.map(k => (
                                                        <TableCell key={k}>
                                                            <Input type="number" min={0} max={10} value={s[k] ?? 5}
                                                                onChange={e => setScores(prev => ({
                                                                    ...prev,
                                                                    [carrier]: { ...getOrInitCarrier(carrier), [k]: Number(e.target.value) }
                                                                }))}
                                                                className="w-16 h-8 text-sm"
                                                            />
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button onClick={handleSave} disabled={isSaving || totalWeight !== 100}>
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Guardar Ponderación
                            </Button>
                        </CardFooter>
                    </Card>
                </>
            )}
        </div>
    );
};

// ===========================================================================
// TAB 1 — Análisis de Propuestas
// ===========================================================================
const TabAnalisis: React.FC<{ isAdmin: boolean; scoreConfig: CarrierScoreConfig | null }> = ({ isAdmin, scoreConfig }) => {
    const { user } = useAuth();
    const { toast } = useToast();

    // Form state
    const [proposalName, setProposalName] = useState('');
    const [proposalCarrier, setProposalCarrier] = useState('');
    const [proposalDate, setProposalDate] = useState('');
    const [proposalRates, setProposalRates] = useState<CarrierRateRow[]>([]);
    const [proposalFileName, setProposalFileName] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    // Comparison result state
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [comparisonRows, setComparisonRows] = useState<any[]>([]);
    const [summary, setSummary] = useState<CarrierProposal['summary'] | null>(null);

    // Saved proposals list
    const [savedProposals, setSavedProposals] = useState<any[]>([]);
    const [loadingProposals, setLoadingProposals] = useState(true);
    const [selectedProposal, setSelectedProposal] = useState<CarrierProposal | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalLoading, setModalLoading] = useState(false);

    useEffect(() => {
        loadCarrierProposals()
            .then(r => { if (r.success) setSavedProposals(r.data || []); })
            .finally(() => setLoadingProposals(false));
    }, []);

    const handleProposalFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        setProposalFileName(file.name);
        try {
            const rates = parseRatesExcel(await file.arrayBuffer());
            setProposalRates(rates);
            toast({ title: `${rates.length} municipios cargados desde el archivo.` });
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    };

    const handleGenerate = async () => {
        if (!proposalCarrier || !proposalRates.length) {
            toast({ variant: 'destructive', title: 'Faltan datos', description: 'Seleccione transportadora y cargue el archivo de propuesta.' });
            return;
        }
        setIsGenerating(true);
        try {
            const current = await getCarrierCurrentRates(proposalCarrier);
            if (!current.success || !current.data?.rates?.length) throw new Error(`No hay tarifas actuales cargadas para ${proposalCarrier}.`);

            const currentMap: Record<string, CarrierRateRow> = {};
            current.data.rates.forEach(r => { currentMap[r.codigoMunicipio] = r; });

            const rows: any[] = [];
            let ahorroTotal = 0, incrementoTotal = 0, conAhorro = 0, conIncremento = 0;

            proposalRates.forEach(prop => {
                const act = currentMap[prop.codigoMunicipio];
                if (!act) return;
                const diff = prop.total - act.total;
                const pct = act.total !== 0 ? (diff / act.total) * 100 : 0;
                if (diff < 0) { ahorroTotal += Math.abs(diff); conAhorro++; }
                else if (diff > 0) { incrementoTotal += diff; conIncremento++; }
                rows.push({ codigoMunicipio: prop.codigoMunicipio, tipoTrayecto: prop.tipoTrayecto, actual: act, propuesta: prop, diferencia: diff, diferenciaPct: pct });
            });

            setComparisonRows(rows);
            setSummary({ totalMunicipios: rows.length, ahorroTotal, incrementoTotal, municipiosConAhorro: conAhorro, municipiosConIncremento: conIncremento });
        } catch (err: any) { toast({ variant: 'destructive', title: 'Error al generar comparativo', description: err.message }); }
        finally { setIsGenerating(false); }
    };

    const handleSave = async () => {
        if (!summary || !comparisonRows.length) return;
        if (!proposalName || !proposalCarrier || !proposalDate) {
            toast({ variant: 'destructive', title: 'Faltan datos', description: 'Complete nombre, transportadora y fecha.' });
            return;
        }
        setIsSaving(true);
        const proposal: Omit<CarrierProposal, 'id'> = { name: proposalName, carrier: proposalCarrier, date: proposalDate, summary, rows: comparisonRows };
        const result = await saveCarrierProposal(proposal, user?.uid || '');
        if (result.success) {
            toast({ title: 'Propuesta guardada', description: `ID: ${result.id}` });
            const refreshed = await loadCarrierProposals();
            if (refreshed.success) setSavedProposals(refreshed.data || []);
            setComparisonRows([]); setSummary(null); setProposalName(''); setProposalDate(''); setProposalRates([]); setProposalFileName(''); setProposalCarrier('');
        } else { toast({ variant: 'destructive', title: 'Error', description: result.error }); }
        setIsSaving(false);
    };

    const handleViewProposal = async (id: string) => {
        setModalLoading(true); setIsModalOpen(true);
        const result = await getCarrierProposalById(id);
        if (result.success) setSelectedProposal(result.data || null);
        else toast({ variant: 'destructive', title: 'Error', description: result.error });
        setModalLoading(false);
    };

    const carrierScore = proposalCarrier ? computeScore(proposalCarrier, scoreConfig) : null;

    return (
        <div className="space-y-6">
            {/* Admin form */}
            {isAdmin && (
                <Card>
                    <CardHeader>
                        <CardTitle>Nueva Propuesta de Tarifas</CardTitle>
                        <CardDescription>Cargue el Excel de la propuesta y compárelo con las tarifas actuales guardadas.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>Nombre de la propuesta</Label>
                                <Input placeholder="Ej: Negociación Q2 2025" value={proposalName} onChange={e => setProposalName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Transportadora</Label>
                                <Select value={proposalCarrier} onValueChange={setProposalCarrier}>
                                    <SelectTrigger><SelectValue placeholder="Seleccione..." /></SelectTrigger>
                                    <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                </Select>
                                {carrierScore !== null && <div className="flex items-center gap-2 text-xs text-muted-foreground">Score ponderado: <ScoreBadge score={carrierScore} /></div>}
                            </div>
                            <div className="space-y-2">
                                <Label>Fecha de la propuesta</Label>
                                <Input type="date" value={proposalDate} onChange={e => setProposalDate(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                            <UploadCloud className="w-8 h-8 text-muted-foreground mb-2" />
                            {proposalFileName ? <p className="text-sm font-medium text-green-600">{proposalFileName} ({proposalRates.length} municipios)</p> : <p className="text-sm text-muted-foreground">Excel: CodigoMunicipio | Flete | IVA | MargenLogisticaInversa | TipoTrayecto</p>}
                            <div className="flex gap-2 mt-2">
                                <Button asChild size="sm" variant="outline">
                                    <label htmlFor="proposal-file" className="cursor-pointer">Seleccionar archivo</label>
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => downloadTemplate('plantilla_propuesta.xlsx', TARIFAS_TEMPLATE)}>
                                    Descargar Plantilla
                                </Button>
                            </div>
                            <input ref={fileRef} id="proposal-file" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleProposalFileChange} />
                        </div>
                        <Button onClick={handleGenerate} disabled={isGenerating || !proposalCarrier || !proposalRates.length} className="w-full">
                            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitCompareArrows className="mr-2 h-4 w-4" />}
                            {isGenerating ? 'Generando...' : 'Generar Comparativo'}
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Comparison results */}
            {summary && comparisonRows.length > 0 && (
                <div className="space-y-4">
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="p-3 text-center"><p className="text-xs text-muted-foreground">Municipios</p><p className="text-2xl font-bold">{summary.totalMunicipios}</p></Card>
                        <Card className="p-3 text-center border-green-200">
                            <p className="text-xs text-muted-foreground">Ahorro total</p>
                            <p className="text-2xl font-bold text-green-600">{fmt(Math.round(summary.ahorroTotal))}</p>
                            <p className="text-xs text-green-600">{summary.municipiosConAhorro} municipios</p>
                        </Card>
                        <Card className="p-3 text-center border-red-200">
                            <p className="text-xs text-muted-foreground">Incremento total</p>
                            <p className="text-2xl font-bold text-red-600">{fmt(Math.round(summary.incrementoTotal))}</p>
                            <p className="text-xs text-red-600">{summary.municipiosConIncremento} municipios</p>
                        </Card>
                        <Card className="p-3 text-center">
                            <p className="text-xs text-muted-foreground">Neto</p>
                            <p className={`text-2xl font-bold ${summary.incrementoTotal - summary.ahorroTotal < 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {fmt(Math.round(summary.incrementoTotal - summary.ahorroTotal))}
                            </p>
                        </Card>
                    </div>

                    {/* Detailed table */}
                    <div className="overflow-x-auto rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Municipio</TableHead>
                                    <TableHead>Trayecto</TableHead>
                                    <TableHead className="text-right">Flete Act.</TableHead>
                                    <TableHead className="text-right">Flete Prop.</TableHead>
                                    <TableHead className="text-right">IVA Act.</TableHead>
                                    <TableHead className="text-right">IVA Prop.</TableHead>
                                    <TableHead className="text-right">Margen Act.</TableHead>
                                    <TableHead className="text-right">Margen Prop.</TableHead>
                                    <TableHead className="text-right font-bold">Total Act.</TableHead>
                                    <TableHead className="text-right font-bold">Total Prop.</TableHead>
                                    <TableHead className="text-right">Δ $</TableHead>
                                    <TableHead className="text-right">Δ %</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {comparisonRows.map(row => (
                                    <TableRow key={row.codigoMunicipio}>
                                        <TableCell className="font-mono text-xs">{row.codigoMunicipio}</TableCell>
                                        <TableCell className="text-xs">{row.tipoTrayecto}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.actual.flete)}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.propuesta.flete)}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.actual.iva)}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.propuesta.iva)}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.actual.margenLogisticaInversa)}</TableCell>
                                        <TableCell className="text-right text-xs">{fmt(row.propuesta.margenLogisticaInversa)}</TableCell>
                                        <TableCell className="text-right text-xs font-semibold">{fmt(row.actual.total)}</TableCell>
                                        <TableCell className="text-right text-xs font-semibold">{fmt(row.propuesta.total)}</TableCell>
                                        <TableCell className={`text-right text-xs font-bold ${row.diferencia < 0 ? 'text-green-600' : row.diferencia > 0 ? 'text-red-600' : ''}`}>
                                            {row.diferencia < 0 ? <TrendingDown className="inline h-3 w-3 mr-0.5" /> : row.diferencia > 0 ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : null}
                                            {fmt(Math.round(Math.abs(row.diferencia)))}
                                        </TableCell>
                                        <TableCell className={`text-right text-xs ${row.diferenciaPct < 0 ? 'text-green-600' : row.diferenciaPct > 0 ? 'text-red-600' : ''}`}>
                                            {row.diferenciaPct.toFixed(1)}%
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {isAdmin && (
                        <Button onClick={handleSave} disabled={isSaving} size="lg" className="w-full">
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar Propuesta
                        </Button>
                    )}
                </div>
            )}

            {/* Saved proposals */}
            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Propuestas Guardadas</CardTitle></CardHeader>
                <CardContent>
                    {loadingProposals ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin h-4 w-4" /> Cargando...</div>
                        : savedProposals.length === 0 ? <p className="text-muted-foreground text-sm">No hay propuestas guardadas aún.</p>
                        : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nombre</TableHead>
                                        <TableHead>Transportadora</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Ahorro Neto</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {savedProposals.map((p: any) => {
                                        const neto = (p.summary?.incrementoTotal || 0) - (p.summary?.ahorroTotal || 0);
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">{p.name}</TableCell>
                                                <TableCell>{p.carrier}</TableCell>
                                                <TableCell>{p.date}</TableCell>
                                                <TableCell className={neto < 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>{fmt(Math.round(Math.abs(neto)))}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="outline" size="sm" onClick={() => handleViewProposal(p.id)}>
                                                        <Eye className="mr-1 h-3 w-3" /> Ver
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                </CardContent>
            </Card>

            {/* Modal for viewing a saved proposal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{selectedProposal?.name || 'Propuesta'}</DialogTitle>
                        <DialogDescription>{selectedProposal?.carrier} — {selectedProposal?.date}</DialogDescription>
                    </DialogHeader>
                    {modalLoading ? <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin h-6 w-6" /></div>
                        : selectedProposal && (
                            <div className="space-y-4 mt-2">
                                <div className="grid grid-cols-4 gap-3 text-center">
                                    <Card className="p-2"><p className="text-xs text-muted-foreground">Municipios</p><p className="text-xl font-bold">{selectedProposal.summary.totalMunicipios}</p></Card>
                                    <Card className="p-2"><p className="text-xs text-muted-foreground">Ahorro</p><p className="text-xl font-bold text-green-600">{fmt(Math.round(selectedProposal.summary.ahorroTotal))}</p></Card>
                                    <Card className="p-2"><p className="text-xs text-muted-foreground">Incremento</p><p className="text-xl font-bold text-red-600">{fmt(Math.round(selectedProposal.summary.incrementoTotal))}</p></Card>
                                    <Card className="p-2"><p className="text-xs text-muted-foreground">Neto</p><p className={`text-xl font-bold ${selectedProposal.summary.incrementoTotal - selectedProposal.summary.ahorroTotal < 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(Math.round(selectedProposal.summary.incrementoTotal - selectedProposal.summary.ahorroTotal))}</p></Card>
                                </div>
                                <div className="overflow-x-auto rounded border max-h-[50vh]">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Municipio</TableHead><TableHead>Trayecto</TableHead>
                                                <TableHead className="text-right">Total Act.</TableHead><TableHead className="text-right">Total Prop.</TableHead>
                                                <TableHead className="text-right">Δ $</TableHead><TableHead className="text-right">Δ %</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedProposal.rows.map(row => (
                                                <TableRow key={row.codigoMunicipio}>
                                                    <TableCell className="text-xs font-mono">{row.codigoMunicipio}</TableCell>
                                                    <TableCell className="text-xs">{row.tipoTrayecto}</TableCell>
                                                    <TableCell className="text-right text-xs">{fmt(row.actual.total)}</TableCell>
                                                    <TableCell className="text-right text-xs">{fmt(row.propuesta.total)}</TableCell>
                                                    <TableCell className={`text-right text-xs font-bold ${row.diferencia < 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(Math.round(Math.abs(row.diferencia)))}</TableCell>
                                                    <TableCell className={`text-right text-xs ${row.diferencia < 0 ? 'text-green-600' : 'text-red-600'}`}>{row.diferenciaPct.toFixed(1)}%</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

// ===========================================================================
// MAIN Export
// ===========================================================================
interface PropuestaTransportadoraProps {
    onReturn: () => void;
}

export const PropuestaTransportadora: React.FC<PropuestaTransportadoraProps> = ({ onReturn }) => {
    const { role } = useAuth();
    const isAdmin = role === 'admin';

    const [carriersMetadata, setCarriersMetadata] = useState<{ carrier: string; lastUpdated?: Date; count: number }[]>([]);
    const [scoreConfig, setScoreConfig] = useState<CarrierScoreConfig | null>(null);
    const [codRules, setCodRules] = useState<Record<string, CODRule>>({});
    const [isBootstrapping, setIsBootstrapping] = useState(true);

    useEffect(() => {
        Promise.all([
            getAllCarrierRatesMetadata(),
            getCarrierScores(),
            getCarrierCODConfig(),
        ]).then(([meta, scores, cod]) => {
            if (meta.success) setCarriersMetadata(meta.data || []);
            if (scores.success) setScoreConfig(scores.data || null);
            if (cod.success) setCodRules(cod.data || {});
        }).finally(() => setIsBootstrapping(false));
    }, []);

    const refreshMetadata = useCallback(() => {
        getAllCarrierRatesMetadata().then(r => { if (r.success) setCarriersMetadata(r.data || []); });
    }, []);

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row justify-between items-center">
                    <div>
                        <CardTitle>Propuesta de Transportadora</CardTitle>
                        <CardDescription>Gestión de tarifas, comparativos y ponderación de carriers.</CardDescription>
                    </div>
                    <Button onClick={onReturn} variant="outline">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                    </Button>
                </CardHeader>
            </Card>

            {isBootstrapping ? (
                <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
                    <Loader2 className="animate-spin h-6 w-6" /> Cargando módulo...
                </div>
            ) : (
                <Tabs defaultValue="analisis">
                    <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-6' : 'grid-cols-5'}`}>
                        <TabsTrigger value="analisis"><GitCompareArrows className="mr-1.5 h-4 w-4" /> Análisis</TabsTrigger>
                        <TabsTrigger value="comparativo"><BarChart3 className="mr-1.5 h-4 w-4" /> Comparativo</TabsTrigger>
                        <TabsTrigger value="simulador"><Calculator className="mr-1.5 h-4 w-4" /> Simulador</TabsTrigger>
                        <TabsTrigger value="recaudo"><CreditCard className="mr-1.5 h-4 w-4" /> Recaudo COD</TabsTrigger>
                        <TabsTrigger value="ponderacion"><Star className="mr-1.5 h-4 w-4" /> Ponderación</TabsTrigger>
                        {isAdmin && <TabsTrigger value="datos"><Database className="mr-1.5 h-4 w-4" /> Datos Base</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="analisis" className="mt-4">
                        <TabAnalisis isAdmin={isAdmin} scoreConfig={scoreConfig} />
                    </TabsContent>

                    <TabsContent value="comparativo" className="mt-4">
                        <TabComparativo carriersMetadata={carriersMetadata} scoreConfig={scoreConfig} codRules={codRules} />
                    </TabsContent>

                    <TabsContent value="simulador" className="mt-4">
                        <TabSimulador carriersMetadata={carriersMetadata} codRules={codRules} />
                    </TabsContent>

                    <TabsContent value="recaudo" className="mt-4">
                        <TabRecaudoCOD />
                    </TabsContent>

                    <TabsContent value="ponderacion" className="mt-4">
                        <TabPonderacion isAdmin={isAdmin} scoreConfig={scoreConfig} onSaved={setScoreConfig} />
                    </TabsContent>

                    {isAdmin && (
                        <TabsContent value="datos" className="mt-4">
                            <TabDatosBase carriersMetadata={carriersMetadata} onRatesUploaded={refreshMetadata} />
                        </TabsContent>
                    )}
                </Tabs>
            )}
        </div>
    );
};
