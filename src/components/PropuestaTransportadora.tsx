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
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import {
    ArrowLeft, UploadCloud, Loader2, GitCompareArrows, Database,
    TrendingUp, TrendingDown, Eye, Save, Star, BarChart3, Search, Trophy,
} from 'lucide-react';
import {
    saveMunicipios,
    saveCarrierCurrentRates,
    getCarrierCurrentRates,
    getAllCarrierRatesMetadata,
    saveCarrierProposal,
    loadCarrierProposals,
    getCarrierProposalById,
    saveCarrierScores,
    getCarrierScores,
    CarrierRateRow,
    CarrierProposal,
    CarrierScoreConfig,
} from '@/app/actions';

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
// Helper: parse an Excel file for carrier rates
// ---------------------------------------------------------------------------
function parseRatesExcel(buffer: ArrayBuffer): CarrierRateRow[] {
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    return rows.map(r => {
        const key = (k: string) => {
            const found = Object.keys(r).find(rk => rk.toLowerCase().replace(/\s/g, '') === k.toLowerCase().replace(/\s/g, ''));
            return found ? r[found] : 0;
        };
        const flete = Number(key('flete')) || 0;
        const iva = Number(key('iva')) || 0;
        const margen = Number(key('margenlogisticainversa')) || Number(key('margen')) || 0;
        return {
            codigoMunicipio: String(key('codigomunicipio')).trim(),
            tipoTrayecto: String(key('tipotrayecto') || key('trayecto') || 'Nacional').trim(),
            flete,
            iva,
            margenLogisticaInversa: margen,
            total: flete + iva + margen,
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

// ===========================================================================
// TAB 4 — Gestión de Datos Base (Admin only)
// ===========================================================================
const TabDatosBase: React.FC<{ carriersMetadata: { carrier: string; lastUpdated?: Date; count: number }[]; onRatesUploaded: () => void }> = ({ carriersMetadata, onRatesUploaded }) => {
    const { toast } = useToast();
    const [selectedCarrier, setSelectedCarrier] = useState('');
    const [isUploadingMunicipios, setIsUploadingMunicipios] = useState(false);
    const [isUploadingRates, setIsUploadingRates] = useState(false);
    const munRef = useRef<HTMLInputElement>(null);
    const ratesRef = useRef<HTMLInputElement>(null);

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
            const rates = parseRatesExcel(await file.arrayBuffer());
            if (!rates.length) throw new Error('No se encontraron filas válidas en el archivo.');
            const result = await saveCarrierCurrentRates(selectedCarrier, rates);
            if (result.success) {
                toast({ title: 'Tarifas guardadas', description: `${result.processedCount} municipios para ${selectedCarrier}.` });
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
                        <Button asChild size="sm" disabled={isUploadingMunicipios}>
                            <label htmlFor="mun-upload" className="cursor-pointer">
                                {isUploadingMunicipios && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {isUploadingMunicipios ? 'Procesando...' : 'Seleccionar archivo'}
                            </label>
                        </Button>
                        <input ref={munRef} id="mun-upload" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleMunicipiosUpload} />
                    </div>
                </CardContent>
            </Card>

            {/* Tarifas actuales */}
            <Card>
                <CardHeader>
                    <CardTitle>Tarifas Actuales por Transportadora</CardTitle>
                    <CardDescription>
                        Excel con columnas: <code>CodigoMunicipio | Flete | IVA | MargenLogisticaInversa | TipoTrayecto</code>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Transportadora</Label>
                        <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
                            <SelectTrigger><SelectValue placeholder="Seleccione..." /></SelectTrigger>
                            <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg">
                        <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" />
                        <Button asChild size="sm" disabled={!selectedCarrier || isUploadingRates}>
                            <label htmlFor="rates-upload" className={selectedCarrier ? 'cursor-pointer' : 'cursor-not-allowed'}>
                                {isUploadingRates && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {isUploadingRates ? 'Guardando...' : !selectedCarrier ? 'Seleccione una transportadora primero' : 'Cargar tarifas'}
                            </label>
                        </Button>
                        <input ref={ratesRef} id="rates-upload" type="file" className="hidden" accept=".xlsx,.xls" onChange={handleRatesUpload} disabled={!selectedCarrier} />
                    </div>
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
// TAB 2 — Comparativo de Tarifas Actuales
// ===========================================================================
const TabComparativo: React.FC<{ carriersMetadata: { carrier: string; lastUpdated?: Date; count: number }[]; scoreConfig: CarrierScoreConfig | null }> = ({ carriersMetadata, scoreConfig }) => {
    const { toast } = useToast();
    const [allRates, setAllRates] = useState<Record<string, CarrierRateRow[]>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [trayectoFilter, setTrayectoFilter] = useState('Todos');
    const [search, setSearch] = useState('');
    const [municipioMap, setMunicipioMap] = useState<Record<string, { nombre: string; departamento: string }>>({});

    const availableCarriers = carriersMetadata.map(m => m.carrier);

    useEffect(() => {
        if (!availableCarriers.length) return;
        setIsLoading(true);
        Promise.all(availableCarriers.map(c => getCarrierCurrentRates(c).then(r => ({ carrier: c, rates: r.data?.rates || [] }))))
            .then(results => {
                const map: Record<string, CarrierRateRow[]> = {};
                const mMap: Record<string, { nombre: string; departamento: string }> = {};
                results.forEach(({ carrier, rates }) => {
                    map[carrier] = rates;
                });
                setAllRates(map);
            })
            .catch(() => toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las tarifas.' }))
            .finally(() => setIsLoading(false));
    }, [carriersMetadata]);

    // Build a unified list of municipios across all carriers
    const allCodes = Array.from(new Set(Object.values(allRates).flatMap(rates => rates.map(r => r.codigoMunicipio))));

    const filtered = allCodes.filter(code => {
        const rateSample = Object.values(allRates).flatMap(r => r).find(r => r.codigoMunicipio === code);
        if (trayectoFilter !== 'Todos' && rateSample?.tipoTrayecto !== trayectoFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            if (!code.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    if (!availableCarriers.length) return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <Database className="h-10 w-10" />
            <p>No hay tarifas cargadas aún. Ve al Tab "Gestión de Datos Base" para cargar tarifas.</p>
        </div>
    );

    if (isLoading) return (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="animate-spin h-6 w-6" /> Cargando tarifas de todas las transportadoras...
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Summary cards */}
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
                            <p className="text-sm font-bold mt-1">{fmt(Math.round(avg))} <span className="text-xs font-normal text-muted-foreground">prom.</span></p>
                            <p className="text-xs text-muted-foreground">Act: {fmtDate(meta?.lastUpdated)}</p>
                        </Card>
                    );
                })}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-2 flex-1">
                    <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input placeholder="Buscar por código de municipio..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={trayectoFilter} onValueChange={setTrayectoFilter}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>{TRAYECTO_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="sticky left-0 bg-background z-10 min-w-[120px]">Cód. Municipio</TableHead>
                            <TableHead className="min-w-[100px]">Trayecto</TableHead>
                            {availableCarriers.map(c => (
                                <TableHead key={c} className="text-center min-w-[200px]" colSpan={4}>
                                    <div className="font-bold">{c}</div>
                                    <div className="grid grid-cols-4 text-xs font-normal text-muted-foreground mt-1">
                                        <span>Flete</span><span>IVA</span><span>Margen</span><span className="font-semibold text-foreground">Total</span>
                                    </div>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.slice(0, 200).map(code => {
                            // Find the minimum total for this municipio across all carriers
                            const totals = availableCarriers.map(c => {
                                const r = (allRates[c] || []).find(x => x.codigoMunicipio === code);
                                return r ? r.total : Infinity;
                            });
                            const minTotal = Math.min(...totals);
                            const sampleRow = Object.values(allRates).flatMap(r => r).find(r => r.codigoMunicipio === code);

                            return (
                                <TableRow key={code}>
                                    <TableCell className="sticky left-0 bg-background z-10 font-mono text-xs font-semibold">{code}</TableCell>
                                    <TableCell className="text-xs">{sampleRow?.tipoTrayecto || '—'}</TableCell>
                                    {availableCarriers.map(c => {
                                        const r = (allRates[c] || []).find(x => x.codigoMunicipio === code);
                                        const isMin = r && r.total === minTotal;
                                        return (
                                            <TableCell key={c} colSpan={4} className={`text-xs ${isMin ? 'bg-green-50 dark:bg-green-950' : ''}`}>
                                                {r ? (
                                                    <div className="grid grid-cols-4 gap-1">
                                                        <span>{fmt(r.flete)}</span>
                                                        <span>{fmt(r.iva)}</span>
                                                        <span>{fmt(r.margenLogisticaInversa)}</span>
                                                        <span className={`font-bold ${isMin ? 'text-green-700 dark:text-green-400' : ''}`}>{fmt(r.total)}</span>
                                                    </div>
                                                ) : <span className="text-muted-foreground text-center block">—</span>}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                        {filtered.length === 0 && (
                            <TableRow><TableCell colSpan={2 + availableCarriers.length * 4} className="text-center text-muted-foreground py-8">Sin resultados para los filtros actuales.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
                {filtered.length > 200 && <p className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {filtered.length} municipios. Usa el buscador para refinar.</p>}
            </div>
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
                            <Button asChild className="mt-2" size="sm" variant="outline">
                                <label htmlFor="proposal-file" className="cursor-pointer">Seleccionar archivo</label>
                            </Button>
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
    const [isBootstrapping, setIsBootstrapping] = useState(true);

    useEffect(() => {
        Promise.all([
            getAllCarrierRatesMetadata(),
            getCarrierScores(),
        ]).then(([meta, scores]) => {
            if (meta.success) setCarriersMetadata(meta.data || []);
            if (scores.success) setScoreConfig(scores.data || null);
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
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="analisis"><GitCompareArrows className="mr-1.5 h-4 w-4" /> Análisis</TabsTrigger>
                        <TabsTrigger value="comparativo"><BarChart3 className="mr-1.5 h-4 w-4" /> Comparativo</TabsTrigger>
                        <TabsTrigger value="ponderacion"><Star className="mr-1.5 h-4 w-4" /> Ponderación</TabsTrigger>
                        {isAdmin && <TabsTrigger value="datos"><Database className="mr-1.5 h-4 w-4" /> Datos Base</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="analisis" className="mt-4">
                        <TabAnalisis isAdmin={isAdmin} scoreConfig={scoreConfig} />
                    </TabsContent>

                    <TabsContent value="comparativo" className="mt-4">
                        <TabComparativo carriersMetadata={carriersMetadata} scoreConfig={scoreConfig} />
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
