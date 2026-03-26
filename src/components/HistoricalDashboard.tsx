"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { ProcessedReportData, ReportSummary } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calendar as CalendarIcon, Download, Loader2, Info, Eye, BarChart2, Clock, Search, Filter, Package, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isSameDay, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { es } from 'date-fns/locale';
import { exportToXlsx } from '@/services/export';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { StatCard } from '@/components/StatCard';
import { loadHistoricalReports, consolidateDailyReports, previewConsolidatedReport, loadFullReportSnapshots, deleteHistoricalReportsForDay } from '@/app/actions';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, LineChart, Line, AreaChart, Area, ComposedChart, PieChart, Pie, Cell, LabelList } from 'recharts';

interface HistoricalDashboardProps {
  onReturnToMain: () => void;
  onConsolidate: (snapshotIds: string[]) => Promise<{ success: boolean; error?: string; consolidatedReportId?: string }>;
  theme: 'light' | 'dark';
}

type DailyGroup = {
  date: string;
  consolidated?: ReportSummary;
  snapshots: ReportSummary[];
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a855f7', '#ec4899', '#f43f5e', '#14b8a6'];
const PIE_COLORS = ['#3b82f6', '#f43f5e', '#f59e0b', '#10b981'];

export const HistoricalDashboard: React.FC<HistoricalDashboardProps> = ({ onReturnToMain, onConsolidate, theme }) => {
  const { toast } = useToast();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 30), to: new Date() });

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [view, setView] = useState<'main' | 'snapshots'>('main');
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set());
  
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Trends State
  const [trendsData, setTrendsData] = useState<ProcessedReportData[]>([]);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<string>('all');
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedProductType, setSelectedProductType] = useState<string>('all');
  const [selectedSpecificDay, setSelectedSpecificDay] = useState<string>('all');

  const handleQuery = useCallback(async () => {
    if (!dateRange?.from) {
        toast({ variant: 'destructive', title: 'Fecha de inicio requerida' });
        return;
    }
    const endDate = dateRange.to || dateRange.from;

    setIsLoading(true);
    setHasSearched(true);
    
    // Use yyyy-MM-dd format to avoid timezone shifts during transmission
    const result = await loadHistoricalReports({ 
        startDate: format(dateRange.from, 'yyyy-MM-dd'), 
        endDate: format(endDate, 'yyyy-MM-dd') 
    });
    
    if (result.data) {
        setReports(result.data);
    } else {
        toast({ variant: 'destructive', title: 'Error al consultar', description: result.error });
        setReports([]);
    }
    setIsLoading(false);
  }, [dateRange, toast]);

  // Auto-load on mount and when dateRange changes (automatic filtering)
  useEffect(() => {
    // Only trigger if we have at least a 'from' date. 
    // If it's a range, we might want to wait for 'to' but react-day-picker 
    // updates 'from' first. For better UX, we can debounce or just fire if 'from' is set.
    if (dateRange?.from) {
        handleQuery();
    }
  }, [dateRange, handleQuery]);

  const availableDays = useMemo(() => {
     const days = new Set<string>();
     reports.forEach(r => {
        const d = new Date(r.reportDate);
        if (!isNaN(d.getTime())) days.add(format(d, 'yyyy-MM-dd'));
     });
     return Array.from(days).sort((a, b) => b.localeCompare(a));
  }, [reports]);

  const filteredReports = useMemo(() => {
     if (selectedSpecificDay === 'all') return reports;
     return reports.filter(r => {
         const d = new Date(r.reportDate);
         return !isNaN(d.getTime()) && format(d, 'yyyy-MM-dd') === selectedSpecificDay;
     });
  }, [reports, selectedSpecificDay]);

  const dailyGroups = useMemo(() => {
    const groups: Record<string, DailyGroup> = {};
    
    filteredReports.forEach(report => {
      // Use local date string instead of ISO to avoid UTC day-shift errors
      const dateObj = new Date(report.reportDate);
      const dateKey = isNaN(dateObj.getTime()) ? 'Invalid' : format(dateObj, 'yyyy-MM-dd');
      if (dateKey === 'Invalid') return;
      
      if (!groups[dateKey]) {
        groups[dateKey] = { date: dateKey, snapshots: [] };
      }
      const group = groups[dateKey]!;
      if (report.isConsolidated) {
        group.consolidated = report;
      } else {
        group.snapshots.push(report);
      }
    });
    return Object.values(groups)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredReports]);

  const handleLoadTrends = async () => {
    if (dailyGroups.length === 0) return;
    setIsLoadingTrends(true);
    
    // Optimization: Check if we can build trends from the summaries we already have
    const summariesWithData = reports.filter(r => r.packerProductivity && r.packerProductivity.length > 0);
    
    // DEDUPLICATION: Group by reportDate and pick the latest snapshotCreatedAt
    const groupedSummaries: Record<string, any> = {};
    summariesWithData.forEach(s => {
        const dateStr = s.reportDate instanceof Date ? s.reportDate.toISOString().split('T')[0] : String(s.reportDate).split('T')[0];
        const currentLatest = groupedSummaries[dateStr];
        if (!currentLatest || new Date(s.snapshotCreatedAt).getTime() > new Date(currentLatest.snapshotCreatedAt).getTime()) {
            groupedSummaries[dateStr] = s;
        }
    });
    
    const finalSummaries = Object.values(groupedSummaries);

    if (finalSummaries.length > 0 && finalSummaries.length >= Math.min(dailyGroups.length, 5)) {
        // We have enough enriched summaries to show trends instantly
        console.log("Loading trends from enriched summaries...");
        setTrendsData(finalSummaries.map(s => ({
            ...s,
            reportDate: s.reportDate instanceof Date ? s.reportDate.toISOString() : s.reportDate,
        } as any)).sort((a,b) => new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime()));
        setSelectedSpecificDay('all');
        setIsLoadingTrends(false);
        return;
    }

    // Fallback: load full snapshots if summaries are old/light
    const snapshotIds = dailyGroups.map(g => {
        if (g.consolidated) return g.consolidated.id;
        if (g.snapshots.length === 0) return null;
        const sortedDesc = [...g.snapshots].sort((a, b) => new Date(b.snapshotCreatedAt).getTime() - new Date(a.snapshotCreatedAt).getTime());
        return sortedDesc[0].id;
    }).filter(Boolean) as string[];

    const result = await loadFullReportSnapshots(snapshotIds);
    if (result.data) {
        setTrendsData(result.data.sort((a,b) => new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime()));
    } else {
        toast({ variant: 'destructive', title: 'Error cargando tendencias', description: result.error });
    }
    setSelectedSpecificDay('all');
    setIsLoadingTrends(false);
  };

  const handleSnapshotSelection = (id: string) => {
    setSelectedSnapshots(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
  };

  const handleDeleteDay = async (dateStr: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente todos los registros del día ${dateStr}? Esta acción no se puede deshacer.`)) {
          return;
      }

      setIsLoading(true);
      try {
          const result = await deleteHistoricalReportsForDay(dateStr);
          if (result.success) {
              toast({ title: 'Registros eliminados', description: `Se han borrado los datos del día ${dateStr}.` });
              handleQuery(); // Refresh list
          } else {
              toast({ variant: 'destructive', title: 'Error al eliminar', description: result.error });
          }
      } catch (error) {
          toast({ variant: 'destructive', title: 'Error', description: 'Ocurrió un error inesperado al intentar borrar.' });
      } finally {
          setIsLoading(false);
      }
  };

  const availableOperators = useMemo(() => {
     const opSet = new Set<string>();
     trendsData.forEach(d => {
         d.packerProductivity?.forEach(p => opSet.add(p.packerName));
     });
     return Array.from(opSet).sort();
  }, [trendsData]);

  const availableBrands = useMemo(() => {
     const brandSet = new Set<string>();
     trendsData.forEach(d => {
         d.brandProductivity?.forEach(b => brandSet.add((b as any).brandName || 'Sin Marca'));
     });
     return Array.from(brandSet).sort();
  }, [trendsData]);

  const availableProductTypes = useMemo(() => {
     const typeSet = new Set<string>();
     trendsData.forEach(d => {
         d.productTypeProductivity?.forEach(p => typeSet.add((p as any).productType || (p as any).category || 'Desconocido'));
     });
     return Array.from(typeSet).sort();
  }, [trendsData]);


  const quickStats = useMemo(() => {
     let hoyVolumen = 0; let hoyCumplimiento = 0;
     let acumVolumen = 0; let acumCumplimiento = 0; let acumDias = 0;

     if (trendsData.length > 0) {
         const latestDateData = trendsData[trendsData.length - 1]; // Already sorted by asc
         
         const filterDetail = (detail: any) => {
             const opMatch = selectedOperator === 'all' || detail.packerName === selectedOperator;
             const brandMatch = selectedBrand === 'all' || (detail.brandName || detail.marca) === selectedBrand;
             const typeMatch = selectedProductType === 'all' || (detail.productType || detail.category) === selectedProductType;
             return opMatch && brandMatch && typeMatch;
         };

         if (selectedOperator === 'all' && selectedBrand === 'all' && selectedProductType === 'all') {
             hoyVolumen = latestDateData.packerProductivity?.reduce((s,p)=>s+p.totalQuantity,0) || 0;
             hoyCumplimiento = latestDateData.overallCompliance || 0;
         } else {
             const matches = latestDateData.packerBrandProductivityDetail?.filter(filterDetail) || [];
             hoyVolumen = matches.reduce((s, m) => s + m.totalQuantity, 0);
             const avgComp = matches.length > 0 ? matches.reduce((s, m) => s + (m.compliance || 0), 0) / matches.length : 0;
             hoyCumplimiento = avgComp;
         }
         
         trendsData.forEach(d => {
             if (selectedOperator === 'all' && selectedBrand === 'all' && selectedProductType === 'all') {
                 acumVolumen += d.packerProductivity?.reduce((s,p)=>s+p.totalQuantity,0) || 0;
                 acumCumplimiento += d.overallCompliance || 0;
                 acumDias++;
             } else {
                 const matches = d.packerBrandProductivityDetail?.filter(filterDetail) || [];
                 if (matches.length > 0) {
                    acumVolumen += matches.reduce((s, m) => s + m.totalQuantity, 0);
                    acumCumplimiento += matches.reduce((s, m) => s + (m.compliance || 0), 0) / matches.length;
                    acumDias++;
                 }
             }
         });
     }
     
     return {
         hoyVolumen: hoyVolumen.toLocaleString('es-CO'),
         hoyCumplimiento: hoyCumplimiento.toFixed(1) + '%',
         acumVolumen: acumVolumen.toLocaleString('es-CO'),
         acumCumplimiento: acumDias > 0 ? (acumCumplimiento / acumDias).toFixed(1) + '%' : '0%'
     };
  }, [trendsData, selectedOperator, selectedBrand, selectedProductType]);

  // ---- Advanced Analytical Math Models ----

   const volumeTrendData = useMemo(() => {
       const filterDetail = (detail: any) => {
           const opMatch = selectedOperator === 'all' || detail.packerName === selectedOperator;
           const brandMatch = selectedBrand === 'all' || (detail.brandName || detail.marca) === selectedBrand;
           const typeMatch = selectedProductType === 'all' || (detail.productType || detail.category) === selectedProductType;
           return opMatch && brandMatch && typeMatch;
       };

       return trendsData.map(d => {
           let totalUnits = 0;
           let complianceVal = 0;

           if (selectedOperator === 'all' && selectedBrand === 'all' && selectedProductType === 'all') {
               totalUnits = d.packerProductivity?.reduce((sum, p) => sum + p.totalQuantity, 0) || 0;
               complianceVal = d.overallCompliance || 0;
           } else {
               const matches = d.packerBrandProductivityDetail?.filter(filterDetail) || [];
               totalUnits = matches.reduce((sum, m) => sum + m.totalQuantity, 0);
               complianceVal = matches.length > 0 ? matches.reduce((s, m) => s + (m.compliance || 0), 0) / matches.length : 0;
           }

           const dateStr = d.reportDate instanceof Date ? format(d.reportDate, 'yyyy-MM-dd') : (d.reportDate as any).split('T')[0];
           return {
               date: format(new Date(dateStr + 'T00:00:00'), 'dd MMM', { locale: es }),
               unidades: totalUnits,
               cumplimiento: Number(complianceVal.toFixed(1))
           };
       });
   }, [trendsData, selectedOperator, selectedBrand, selectedProductType]);

  const brandPieData = useMemo(() => {
     const brands: Record<string, number> = {};
     
     const filterDetail = (detail: any) => {
         const opMatch = selectedOperator === 'all' || detail.packerName === selectedOperator;
         const typeMatch = selectedProductType === 'all' || (detail.productType || detail.category) === selectedProductType;
         return opMatch && typeMatch;
     };

     trendsData.forEach(d => {
         d.packerBrandProductivityDetail?.filter(filterDetail).forEach(b => {
            const label = b.brandName?.trim() || 'Sin Marca';
            if (selectedBrand !== 'all' && label !== selectedBrand) return;
            if (!brands[label]) brands[label] = 0;
            brands[label] += b.totalQuantity;
         });
     });
     const total = Object.values(brands).reduce((sum, v) => sum + v, 0);
     return Object.entries(brands).map(([name, value]) => ({ 
         name, 
         value,
         percent: total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%'
     })).sort((a,b) => b.value - a.value);
   }, [trendsData, selectedOperator, selectedBrand, selectedProductType]);

  const productPieData = useMemo(() => {
     const products: Record<string, number> = {};

     const filterDetail = (detail: any) => {
         const opMatch = selectedOperator === 'all' || detail.packerName === selectedOperator;
         const brandMatch = selectedBrand === 'all' || (detail.brandName || detail.marca) === selectedBrand;
         return opMatch && brandMatch;
     };

     trendsData.forEach(d => {
         d.packerBrandProductivityDetail?.filter(filterDetail).forEach(b => {
            let label = b.productType?.trim() || 'Desconocido';
            if (label === 'NO CLASIFICADO') label = 'Otros / No Def.';
            
            if (selectedProductType !== 'all' && label !== selectedProductType) return;
            
            if (!products[label]) products[label] = 0;
            products[label] += b.totalQuantity;
         });
     });
     const total = Object.values(products).reduce((sum, v) => sum + v, 0);
     return Object.entries(products).map(([name, value]) => ({ 
         name, 
         value,
         percent: total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%'
     })).sort((a,b) => b.value - a.value);
   }, [trendsData, selectedOperator, selectedBrand, selectedProductType]);

  const hourlyTrendData = useMemo(() => {
      const hoursMap: Record<number, { units: number, productiveMinutes: number, validCount: number }> = {};
      
      trendsData.forEach(d => {
          if (selectedOperator === 'all') {
             d.packerHourlyPerformance?.forEach(packerGroup => {
                 Object.entries(packerGroup.hourlyDetails).forEach(([hourStr, details]) => {
                     const hour = parseInt(hourStr);
                     if (details.units > 0 || details.productiveMinutes > 0) {
                         if (!hoursMap[hour]) hoursMap[hour] = { units: 0, productiveMinutes: 0, validCount: 0 };
                         hoursMap[hour].units += details.units;
                         hoursMap[hour].productiveMinutes += details.productiveMinutes;
                         hoursMap[hour].validCount++;
                     }
                 });
             });
          } else {
             const operatorData = d.packerHourlyPerformance?.find(p => p.packerName === selectedOperator);
             if (operatorData) {
                 Object.entries(operatorData.hourlyDetails).forEach(([hourStr, details]) => {
                     const hour = parseInt(hourStr);
                     if (details.units > 0 || details.productiveMinutes > 0) {
                         if (!hoursMap[hour]) hoursMap[hour] = { units: 0, productiveMinutes: 0, validCount: 0 };
                         hoursMap[hour].units += details.units;
                         hoursMap[hour].productiveMinutes += details.productiveMinutes;
                         hoursMap[hour].validCount++;
                     }
                 });
             }
          }
      });
      
      return Object.entries(hoursMap).map(([hourStr, data]) => {
          const u = data.units / (data.validCount || 1);
          return {
              hour: `${hourStr}:00`,
              unitsAvg: Number(u.toFixed(0)),
          };
      }).sort((a,b) => parseInt(a.hour) - parseInt(b.hour));
  }, [trendsData, selectedOperator]);

  const deadTimeTrendData = useMemo(() => {
      const reasons: Record<string, number> = {};
      trendsData.forEach(d => {
          // New architecture: use summary fallback
          if (d.deadTimeSummary || d.microPausesSummary) {
              const allSummaries = [...(d.deadTimeSummary || []), ...(d.microPausesSummary || [])];
              allSummaries.forEach(s => {
                  const reasonLabel = s.type || 'Sin justificar';
                  if (!reasons[reasonLabel]) reasons[reasonLabel] = 0;
                  reasons[reasonLabel] += (s.totalMinutes / 60) || 0;
              });
          } else {
              // Legacy/Detailed fallback
              const allPauses = [...(d.deadTimeReport || []), ...(d.microPausesReport || [])]
              const reportToUse = selectedOperator === 'all' 
                   ? allPauses 
                   : allPauses.filter(dt => dt.packerName === selectedOperator);
                   
              reportToUse.forEach(dt => {
                  let reasonLabel = dt.justification?.trim() || dt.status?.trim() || 'Desconocido/Sin justificar';
                  if (reasonLabel.toLowerCase().includes('excedente')) {
                     reasonLabel = 'No Justificado';
                  }
                  if (!reasons[reasonLabel]) reasons[reasonLabel] = 0;
                  reasons[reasonLabel] += (dt.duration / 60) || 0;
              });
          }
      });
      return Object.entries(reasons)
          .map(([reason, horas]) => ({ reason, horas: Number(horas.toFixed(2)) }))
          .sort((a,b) => b.horas - a.horas)
          .slice(0, 10);
  }, [trendsData, selectedOperator]);

  const topPackersData = useMemo(() => {
      const packerStats: Record<string, { totalUnits: number, days: number, totalHours: number, totalCompliance: number }> = {};
      trendsData.forEach(d => {
          d.packerProductivity?.forEach(p => {
              if (!packerStats[p.packerName]) packerStats[p.packerName] = { totalUnits: 0, days: 0, totalHours: 0, totalCompliance: 0 };
              packerStats[p.packerName].totalUnits += p.totalQuantity;
              packerStats[p.packerName].days += 1;
              packerStats[p.packerName].totalHours += p.hoursWorked;
              packerStats[p.packerName].totalCompliance += (p.compliance || 0);
          });
      });
      return Object.entries(packerStats)
          .map(([name, stats]) => ({ 
              name, 
              unidadesTotales: stats.totalUnits,
              horasTotales: Number(stats.totalHours.toFixed(2)),
              promedioCumplimiento: Number((stats.totalCompliance / stats.days).toFixed(1)),
              uphPromedio: stats.totalHours > 0 ? Number((stats.totalUnits / stats.totalHours).toFixed(1)) : 0
          }))
          .sort((a, b) => b.promedioCumplimiento - a.promedioCumplimiento);
  }, [trendsData]);

  const snapshotsForSelectedDay = useMemo(() => {
    if (!selectedDate) return [];
    const group = dailyGroups.find(g => isSameDay(new Date(g.date + "T00:00:00"), selectedDate));
    return group ? [...group.snapshots].sort((a,b) => new Date(b.snapshotCreatedAt).getTime() - new Date(a.snapshotCreatedAt).getTime()) : [];
  }, [selectedDate, dailyGroups]);

  const handlePreview = () => {
      setIsPreviewModalOpen(true);
  };
  
  const renderMainView = () => (
    <Card className="border-none shadow-none bg-transparent">
      <CardHeader className="px-0 pt-0">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
                <CardTitle className="text-3xl font-bold">Dashboard Histórico</CardTitle>
                <CardDescription className="text-base text-muted-foreground mt-1">
                    Centro de comando analítico a largo plazo. 
                </CardDescription>
            </div>
            <Button onClick={onReturnToMain} variant="outline" className="h-10 hover:bg-muted transition-colors"><ArrowLeft className="mr-2 h-4 w-4" /> Volver</Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                 <StatCard title="Volumen (Último Día)" value={quickStats.hoyVolumen} icon={<Package className="h-4 w-4 text-blue-500" />} />
                 <StatCard title="Volumen Acumulado" value={quickStats.acumVolumen} icon={<BarChart2 className="h-4 w-4 text-emerald-500" />} />
                 <StatCard title="Efectividad (Último Día)" value={quickStats.hoyCumplimiento} icon={<Clock className="h-4 w-4 text-amber-500" />} />
                 <StatCard title="Efectividad Acumulada" value={quickStats.acumCumplimiento} icon={<Search className="h-4 w-4 text-purple-500" />} />
             </div>
             <div className="flex flex-wrap items-end gap-6 mb-8 p-6 border rounded-2xl bg-card shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
             <div className="flex flex-col gap-2 min-w-[280px]">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Rango de Carga (Servidor)</Label>
                <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button id="date" variant={"outline"} className={cn("w-full justify-start text-left font-medium bg-background h-10 border-muted-foreground/20 hover:border-primary/50 transition-all", !dateRange && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4 text-primary opacity-70" />
                          {dateRange?.from ? (dateRange.to ? (<span>{format(dateRange.from, "LLL dd, y", { locale: es })} - {format(dateRange.to, "LLL dd, y", { locale: es })}</span>) : (format(dateRange.from, "LLL dd, y", { locale: es }))) : (<span>Seleccione un rango</span>)}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 border-muted shadow-2xl rounded-2xl overflow-hidden" align="start">
                        <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} locale={es} className="p-3"/>
                      </PopoverContent>
                    </Popover>
                    <Button onClick={handleQuery} disabled={isLoading} className="h-10 px-6 font-bold shadow-md hover:shadow-lg transition-all active:scale-95" size="icon">
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}
                    </Button>
                </div>
             </div>

             <div className="flex flex-col gap-2 min-w-[280px]">
                 <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Filtro de Día (Visualización)</Label>
                 <Select value={selectedSpecificDay} onValueChange={setSelectedSpecificDay}>
                     <SelectTrigger className="h-10 bg-background border-muted-foreground/20 font-medium hover:border-primary/50 transition-all">
                         <div className="flex items-center gap-2">
                             <Clock className="w-4 h-4 text-blue-500" />
                             <SelectValue placeholder="Elegir día específico..." />
                         </div>
                     </SelectTrigger>
                     <SelectContent className="max-h-[300px] rounded-xl shadow-2xl border-muted">
                         <SelectItem value="all" className="font-bold">🏢 Todos los días cargados</SelectItem>
                         <div className="h-px bg-muted my-1" />
                         {availableDays.map(day => (
                             <SelectItem key={day} value={day} className="py-2.5">
                                 {format(new Date(day + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                             </SelectItem>
                         ))}
                     </SelectContent>
                 </Select>
             </div>
          </div>
          
          {isLoading ? (
             <div className="flex justify-center flex-col gap-3 items-center h-64 opacity-50"><Loader2 className="h-10 w-10 animate-spin text-primary" /><span className="font-semibold tracking-wide">Recopilando de la BBDD...</span></div>
          ) : reports.length === 0 && hasSearched ? (
             <div className="flex justify-center items-center h-48 border border-dashed rounded-xl bg-muted/20">
                <p className="text-muted-foreground font-medium flex items-center gap-2"><Info className="h-5 w-5"/> No hay reportes procesados en las fechas marcadas.</p>
             </div>
          ) : reports.length > 0 ? (
             <Tabs defaultValue="list" className="w-full" onValueChange={(val) => val === 'trends' && trendsData.length === 0 && handleLoadTrends()}>
               <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                   <TabsList className="bg-muted p-1 rounded-lg">
                     <TabsTrigger value="list" className="rounded-md px-6 data-[state=active]:shadow-sm"><Clock className="mr-2 h-4 w-4"/> Archivo Diario</TabsTrigger>
                     <TabsTrigger value="trends" className="rounded-md px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all"><BarChart2 className="mr-2 h-4 w-4"/> Inteligencia y Tendencias</TabsTrigger>
                   </TabsList>
                                 <div className="flex flex-wrap items-center gap-2 bg-background border rounded-lg p-1.5 shadow-sm">
                         <Filter className="h-4 w-4 text-muted-foreground ml-2" />
                         <Select value={selectedOperator} onValueChange={setSelectedOperator}>
                             <SelectTrigger className="w-[180px] border-none shadow-none focus:ring-0 h-8 font-medium">
                                 <SelectValue placeholder="Operario" />
                             </SelectTrigger>
                             <SelectContent className="rounded-lg shadow-xl">
                                 <SelectItem value="all" className="font-bold">🏭 Todos los Operarios</SelectItem>
                                 {availableOperators.map(op => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                             </SelectContent>
                         </Select>
                         
                         <div className="w-px h-4 bg-border mx-1" />
                         
                         <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                             <SelectTrigger className="w-[150px] border-none shadow-none focus:ring-0 h-8 font-medium">
                                 <SelectValue placeholder="Marca" />
                             </SelectTrigger>
                             <SelectContent className="rounded-lg shadow-xl">
                                 <SelectItem value="all" className="font-bold">🏷️ Todas las Marcas</SelectItem>
                                 {availableBrands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                             </SelectContent>
                         </Select>
                         
                         <div className="w-px h-4 bg-border mx-1" />
                         
                         <Select value={selectedProductType} onValueChange={setSelectedProductType}>
                             <SelectTrigger className="w-[180px] border-none shadow-none focus:ring-0 h-8 font-medium">
                                 <SelectValue placeholder="Tipo Producto" />
                             </SelectTrigger>
                             <SelectContent className="rounded-lg shadow-xl">
                                 <SelectItem value="all" className="font-bold">📦 Todos los Tipos</SelectItem>
                                 {availableProductTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                             </SelectContent>
                         </Select>
                    </div>
               </div>
               
               <TabsContent value="list" className="animate-in slide-in-from-bottom-2 duration-300">
                <Card className="rounded-xl overflow-hidden shadow-sm border-muted/60">
                <Table>
                    <TableHeader className="bg-muted/40">
                        <TableRow>
                            <TableHead className="font-semibold py-4">Fecha Operativa</TableHead>
                            <TableHead className="font-semibold">Versión</TableHead>
                            <TableHead className="font-semibold text-right">Cumplimiento General</TableHead>
                            <TableHead className="font-semibold text-right">Operarios</TableHead>
                            <TableHead className="font-semibold text-right">Unidades Procesadas</TableHead>
                            <TableHead className="font-semibold text-right">Horas Netas</TableHead>
                            {isAdmin && <TableHead className="font-semibold text-center w-12">Acción</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {dailyGroups.map(group => {
                            const reportToShow = group.consolidated || group.snapshots[0];
                            if (!reportToShow) return null;
                            const isExcellent = reportToShow.overallCompliance >= 95;
                            const isWarning = reportToShow.overallCompliance < 80;
                            return (
                            <TableRow key={group.date} className="cursor-pointer hover:bg-muted/30 transition-colors group" onClick={() => { setSelectedDate(new Date(group.date + 'T00:00:00')); setView('snapshots'); setSelectedSnapshots(new Set()); }}>
                                <TableCell className="font-bold py-4 flex items-center gap-2">
                                     {format(new Date(group.date + 'T00:00:00'), 'PP', { locale: es })}
                                     <ArrowLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all text-primary rotate-180 ml-2" />
                                </TableCell>
                                <TableCell>
                                  {group.consolidated ? (
                                      <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">Consolidado Definitivo</Badge>
                                  ) : (
                                      <Badge variant="secondary" className="font-normal">{group.snapshots.length} Guardado(s)</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                     <span className={cn("font-bold px-2 py-0.5 rounded-md", isExcellent ? "text-emerald-500 bg-emerald-50" : isWarning ? "text-red-500 bg-red-50" : "text-amber-500 bg-amber-50")}>
                                         {reportToShow.overallCompliance.toFixed(1)}%
                                     </span>
                                </TableCell>
                                <TableCell className="text-right font-medium">{reportToShow.operatorCount}</TableCell>
                                <TableCell className="text-right font-bold text-foreground/80">{reportToShow.totalQuantity.toLocaleString()}</TableCell>
                                <TableCell className="text-right">{reportToShow.totalHours?.toFixed(1) || 'N/A'}h</TableCell>
                                {isAdmin && (
                                    <TableCell className="text-center">
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                                            onClick={(e) => handleDeleteDay(group.date, e)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        )})}
                    </TableBody>
                </Table>
                </Card>
               </TabsContent>
               
               <TabsContent value="trends" className="space-y-6">
                   {isLoadingTrends ? (
                       <div className="flex justify-center flex-col items-center h-64">
                           <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
                           <p className="text-muted-foreground font-medium">Modelando cálculos matemáticos desde la nube...</p>
                       </div>
                   ) : trendsData.length > 0 ? (
                       <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-500">
                            {/* DUAL COMPLIANCE CHART */}
                            <Card className="overflow-hidden shadow-sm border-muted/60">
                                <CardHeader className="bg-gradient-to-r from-blue-500/10 to-transparent">
                                  <CardTitle className="flex items-center justify-between text-xl">
                                      Evolución Diaria: Volumen vs Cumplimiento
                                      {selectedOperator !== 'all' && <Badge variant="outline" className="text-primary border-primary">Filtro: {selectedOperator}</Badge>}
                                  </CardTitle>
                                  <CardDescription>Muestra tus Unidades Físicas totales (Sombra Azul) vs la Tasa de Cumplimiento Lograda (Línea Naranja).</CardDescription>
                                </CardHeader>
                                <CardContent className="h-[400px] pt-4">
                                 <ResponsiveContainer width="100%" height="100%">
                                     <ComposedChart data={volumeTrendData}>
                                         <defs>
                                             <linearGradient id="colorUnidades" x1="0" y1="0" x2="0" y2="1">
                                             <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                             <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                             </linearGradient>
                                         </defs>
                                         <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                                         <XAxis dataKey="date" tick={{fontSize: 12, fill: '#888'}} axisLine={false} tickLine={false} dy={10} />
                                         <YAxis yAxisId="left" tickFormatter={(v: any) => v.toLocaleString('es-CO')} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                         <YAxis yAxisId="right" orientation="right" domain={[0, 'dataMax + 20']} tickFormatter={(v: any) => `${v}%`} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                         <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} />
                                         <Legend wrapperStyle={{paddingTop: '20px'}} />
                                         <Bar yAxisId="left" dataKey="unidades" name="Unidades Físicas" fill="url(#colorUnidades)" radius={[4, 4, 0, 0]}>
                                             <LabelList dataKey="unidades" position="top" fill="#3b82f6" fontSize={11} formatter={(v: any) => v > 0 ? v.toLocaleString('es-CO') : ''} />
                                         </Bar>
                                         <Line yAxisId="right" type="monotone" dataKey="cumplimiento" name="Tasa Cumplimiento (%)" stroke="#f59e0b" strokeWidth={4} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}}>
                                             <LabelList dataKey="cumplimiento" position="bottom" fill="#f59e0b" fontSize={12} formatter={(v: any) => v + '%'} />
                                         </Line>
                                     </ComposedChart>
                                 </ResponsiveContainer>
                                </CardContent>
                            </Card>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* BRAND PIE CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg">Distribución por Marca</CardTitle>
                                        <CardDescription>Mercancía procesada total.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 flex-grow relative pb-0">
                                        {brandPieData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                 <PieChart>
                                                     <Pie data={brandPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" >
                                                         {brandPieData.map((entry, index) => (
                                                             <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                         ))}
                                                         <LabelList dataKey="name" position="outside" fontSize={11} fill="#888" stroke="none" />
                                                     </Pie>
                                                     <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(value: any) => value.toLocaleString('es-CO')} />
                                                 </PieChart>
                                             </ResponsiveContainer>
                                        ) : (
                                             <div className="flex h-full items-center justify-center bg-muted/20 rounded-lg text-muted-foreground text-sm">Sin datos</div>
                                        )}
                                    </CardContent>
                                </Card>
                                
                                {/* CATEGORY PIE CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg">Mix de Categorías</CardTitle>
                                        <CardDescription>Ropa vs Calzado.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 flex-grow relative pb-0">
                                        {productPieData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                 <PieChart>
                                                     <Pie data={productPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" >
                                                         {productPieData.map((entry, index) => (
                                                             <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                         ))}
                                                         <LabelList dataKey="name" position="outside" fontSize={11} fill="#888" stroke="none" />
                                                     </Pie>
                                                     <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(value: any) => value.toLocaleString('es-CO')} />
                                                 </PieChart>
                                             </ResponsiveContainer>
                                        ) : (
                                             <div className="flex h-full items-center justify-center bg-muted/20 rounded-lg text-muted-foreground text-sm">Sin datos</div>
                                        )}
                                    </CardContent>
                                </Card>
                                
                                {/* PRODUCTIVITY HEATMAP / HOURLY CHART */}
                                <Card className="md:col-span-2 shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg text-indigo-500">Carga por Hora</CardTitle>
                                        <CardDescription>Unidades Promedio Empacadas.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 pb-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                             <BarChart data={hourlyTrendData}>
                                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                                 <XAxis dataKey="hour" tick={{fill: '#888', fontSize: 11}} axisLine={false} tickLine={false} dy={5} />
                                                 <YAxis hide={true} />
                                                 <RechartsTooltip cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(v: any) => [`${v} UPH Promedio`, 'Carga']} />
                                                 <Bar dataKey="unitsAvg" fill="#6366f1" radius={[4, 4, 0, 0]} name="Promedio">
                                                     <LabelList dataKey="unitsAvg" position="top" fill="#6366f1" fontSize={11} formatter={(v: any) => v > 0 ? v : ''} />
                                                 </Bar>
                                             </BarChart>
                                         </ResponsiveContainer>
                                    </CardContent>
                                </Card>

                                {/* DEAD TIMES / FUGAS DE TIEMPO CHART */}
                                <Card className="md:col-span-2 shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg flex items-center text-rose-500">Radar de Fugas Acum.</CardTitle>
                                        <CardDescription>Suma de paralizaciones.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 pb-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                             <BarChart data={deadTimeTrendData} layout="vertical" margin={{ left: 15 }}>
                                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1} horizontal={false} />
                                                 <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                                 <YAxis dataKey="reason" type="category" width={85} tick={{ fontSize: 11, fill: '#555', fontWeight: 500 }} axisLine={false} tickLine={false} />
                                                 <RechartsTooltip cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(v) => [`${v} Horas`, 'Tiempo']} />
                                                 <Bar dataKey="horas" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={20} name="Horas Muertas">
                                                     <LabelList dataKey="horas" position="right" fill="#f43f5e" fontSize={10} formatter={(v) => v + 'h'} />
                                                 </Bar>
                                             </BarChart>
                                         </ResponsiveContainer>
                                    </CardContent>
                                </Card>
                            </div>
                            
                            {/* THE TRUE MATRIX: OPERATOR BREAKDOWN */}

                           {selectedOperator === 'all' && (
                           <Card className="xl:col-span-2 shadow-sm border-muted/60 overflow-hidden">
                               <CardHeader className="bg-muted/10">
                                   <CardTitle className="text-xl">Matriz de Rendimiento Humano</CardTitle>
                                   <CardDescription>Auditoría profunda cruzando horas y efectividad.</CardDescription>
                               </CardHeader>
                               <CardContent className="p-0">
                                  <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-transparent">
                                            <TableRow>
                                                <TableHead className="font-bold py-4 pl-6">Operario Top</TableHead>
                                                <TableHead className="text-right font-bold text-xs uppercase tracking-wider">Unidades</TableHead>
                                                <TableHead className="text-right font-bold text-xs uppercase tracking-wider">Horas Base</TableHead>
                                                <TableHead className="text-right font-bold text-xs uppercase tracking-wider">UPH Prom.</TableHead>
                                                <TableHead className="text-right font-bold text-xs uppercase tracking-wider pr-6">% Cumplimiento</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {topPackersData.map((op, idx) => (
                                                <TableRow key={op.name} className="group">
                                                    <TableCell className="font-semibold pl-6 flex items-center gap-3">
                                                        <span className={cn("flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white", idx === 0 ? "bg-amber-400" : idx === 1 ? "bg-slate-300 text-slate-700" : idx === 2 ? "bg-orange-800/80" : "bg-muted text-muted-foreground")}>{idx + 1}</span>
                                                        {op.name}
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-foreground/80">{op.unidadesTotales.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-medium text-muted-foreground">{op.horasTotales}h</TableCell>
                                                    <TableCell className="text-right font-semibold">{op.uphPromedio}</TableCell>
                                                    <TableCell className="text-right pr-6">
                                                        <span className={cn("px-2.5 py-1 rounded-md text-sm font-bold", op.promedioCumplimiento >= 100 ? "bg-emerald-100 text-emerald-700" : op.promedioCumplimiento >= 90 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
                                                            {op.promedioCumplimiento}%
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                  </div>
                               </CardContent>
                           </Card>
                           )}
                       </div>
                   ) : (
                       <div className="flex flex-col items-center justify-center p-16 border border-dashed rounded-xl bg-muted/10 gap-4 mt-8">
                           <BarChart2 className="h-16 w-16 text-muted-foreground opacity-20" />
                           <p className="text-lg text-muted-foreground font-medium">Haga clic abajo para inyectar la fuerza analítica a este reporte</p>
                           <Button onClick={handleLoadTrends} size="lg" className="mt-2 font-bold px-8 shadow-md hover:-translate-y-1 transition-all">Generar Dashboards</Button>
                       </div>
                   )}
               </TabsContent>
             </Tabs>
          ) : (
             <div className="flex items-center justify-center h-48 rounded-xl border border-dashed bg-muted/10 mt-6">
                <p className="text-muted-foreground font-medium text-lg">Defina las fechas y lance la búsqueda.</p>
             </div>
          )}
      </CardContent>
    </Card>
  );

  const renderSnapshotsView = () => (
     <Card className="border-none shadow-none">
        <CardHeader className="px-0">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 border-b border-border pb-6">
                <div>
                    <CardTitle className="text-3xl font-bold flex items-center">
                        <ArrowLeft className="mr-4 h-6 w-6 cursor-pointer text-muted-foreground hover:text-foreground transition-colors" onClick={() => setView('main')} />
                        Auditoría Diaria
                    </CardTitle>
                    <CardDescription className="text-base mt-2">Detalle de guardados del día {selectedDate ? format(selectedDate, "PPP", { locale: es }) : ''}.</CardDescription>
                </div>
                {isAdmin && (
                    <div className="flex items-center gap-2">
                        <Button onClick={handlePreview} disabled={isPreviewing || selectedSnapshots.size < 1} className="shadow-sm">
                            {isPreviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Eye className="mr-2 h-4 w-4" />}
                            Ver Espejo Técnico
                        </Button>
                    </div>
                )}
            </div>
        </CardHeader>
        <CardContent className="px-0 pt-6">
          {snapshotsForSelectedDay.length > 0 ? (
            <div className="rounded-xl overflow-hidden border">
            <Table>
                <TableHeader className="bg-muted/40">
                    <TableRow>
                        {isAdmin && <TableHead className="w-12 text-center">Sel.</TableHead>}
                        <TableHead className="font-semibold">Sello de Tiempo</TableHead>
                        <TableHead className="font-semibold text-right">Efectividad General</TableHead>
                        <TableHead className="font-semibold text-right">Fuerza Laboral</TableHead>
                        <TableHead className="font-semibold text-right">Salida (Unidades)</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {snapshotsForSelectedDay.map((report) => (
                        <TableRow key={report.id} data-state={selectedSnapshots.has(report.id) ? "selected" : undefined} className="group hover:bg-muted/20">
                            {isAdmin && (
                                <TableCell className="text-center">
                                    <Checkbox
                                        checked={selectedSnapshots.has(report.id)}
                                        onCheckedChange={() => handleSnapshotSelection(report.id)}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                </TableCell>
                            )}
                            <TableCell className="font-bold text-foreground">
                                {new Date(report.snapshotCreatedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </TableCell>
                            <TableCell className="text-right font-bold text-primary">{report.overallCompliance.toFixed(1)}%</TableCell>
                            <TableCell className="text-right">
                               <Badge variant="outline" className="bg-background">{report.operatorCount} Ops</Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold">{report.totalQuantity.toLocaleString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">No hay registros salvados.</p>
          )}
        </CardContent>
      </Card>
  )

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-6 duration-700 ease-out fill-mode-both">
        {view === 'main' ? renderMainView() : renderSnapshotsView()}

        <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl">Espejo Técnico de Auditoría</DialogTitle>
                    <DialogDescription className="text-sm">
                        La data profunda ha sido optimizada para garantizar la máxima velocidad del servidor en meses posteriores.
                    </DialogDescription>
                </DialogHeader>
                <div className="p-6 bg-muted/20 border-border border rounded-xl flex flex-col items-center justify-center gap-4">
                    <Eye className="w-12 h-12 text-muted-foreground opacity-50" />
                    <p className="text-center font-medium text-muted-foreground">La previsualización en vivo no permite retroceso granular en esta versión ultraligera.</p>
                </div>
            </DialogContent>
        </Dialog>
    </div>
  );
};
