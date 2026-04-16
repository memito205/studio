/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Truck, GaugeCircle, CheckCircle, AlertCircle, FileDown, Filter, Calendar as CalendarIcon, ShieldCheck, Timer, Package, TimerOff, PackageCheck, ClipboardEdit, History, BarChart2, Search, Edit, Database } from 'lucide-react';
import { SubModuleCard } from './SubModuleCard';
import dynamic from 'next/dynamic';
import type { EcommerceOrder, DelayedOrderLog, Filters, FilterCategory } from '@/types';
import { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/use-toast';
import { loadEcommerceOrders, getDelayedOrderLogs, updateEcommerceOrderDispatchDate, batchUpdateEcommerceOrderDispatchDates, saveHolidays, loadHolidays } from '@/app/actions';
import { calculateSlaHours } from '@/lib/parsingUtils';
import { isSameDay, startOfDay, endOfDay, format, startOfToday, differenceInDays, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, LineChart, Line, Legend } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { StatCard } from '@/components/StatCard';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useAuth } from '@/hooks/use-auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { MultiSelectFilter } from './MultiSelectFilter';


const EcommerceDashboard = dynamic(() => import('./EcommerceDashboard').then(mod => mod.EcommerceDashboard), {
    loading: () => <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>,
});


const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background p-2 border rounded-md shadow-lg">
          <p className="label font-bold">{`${label}`}</p>
          {payload.map((entry: any, index: number) => (
             <p key={`item-${index}`} style={{ color: entry.color }}>
                {`${entry.name}: ${entry.value.toFixed(1)}%`}
             </p>
          ))}
        </div>
      );
    }
    return null;
  };

interface DailyDispatchDashboardProps {
    onReturn: () => void;
    holidays: Date[];
    allOrders: EcommerceOrder[];
    isLoading: boolean;
    onRefresh: () => void;
}

const DailyDispatchDashboard: React.FC<DailyDispatchDashboardProps> = ({ onReturn, holidays, allOrders, isLoading, onRefresh }) => {
  const { toast } = useToast();
  const { theme } = useTheme();
  const reportContentRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  const [dateFilter, setDateFilter] = useState<DateRange | undefined>();
  const [storeFilter, setStoreFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'onTime' | 'late'>('all');
  
  // State for manual correction
  const [correctionOrderIds, setCorrectionOrderIds] = useState('');
  const [foundOrdersForCorrection, setFoundOrdersForCorrection] = useState<EcommerceOrder[]>([]);
  const [isCorrectionDialogOpen, setIsCorrectionDialogOpen] = useState(false);
  const [newDispatchDate, setNewDispatchDate] = useState<Date | undefined>();

  const activeDate = useMemo(() => {
    if (dateFilter?.from && !dateFilter.to) {
        return dateFilter.from;
    }
    const today = startOfToday();
    return today;
  }, [dateFilter]);
  
  const slaCache = useRef(new Map<string, { isLate: boolean; limitHours: number; timeDiffHours: number | null; dueDate: Date | null; }>());
  const wasLateCache = useRef(new Map<string, boolean>());
  
  useEffect(() => {
      slaCache.current.clear();
      wasLateCache.current.clear();
  }, [holidays]);

  const getSlaDetails = useCallback((order: EcommerceOrder): { isLate: boolean; limitHours: number; timeDiffHours: number | null; dueDate: Date | null; } => {
    if (!order.id) return { isLate: false, limitHours: 0, timeDiffHours: null, dueDate: null };
    if (slaCache.current.has(order.id)) return slaCache.current.get(order.id)!;

    const orderDate = order.fechaPedido ? new Date(order.fechaPedido) : null;
    const dispatchDate = order.dispatchDate ? new Date(order.dispatchDate) : null;

    if (!dispatchDate || !orderDate) return { isLate: false, limitHours: 0, timeDiffHours: null, dueDate: null };

    const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48 };
    const defaultTimeLimit = 48;
    const tienda = order.tienda?.trim().toUpperCase() ?? '';
    const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
    const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
    
    const toLocalString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const holidayStrings = new Set(holidays.map(toLocalString));
    
    let dueDate = new Date(orderDate);
    let hoursRemaining = limitHours;
    while (hoursRemaining > 0) {
        dueDate.setHours(dueDate.getHours() + 1);
        const dayOfWeek = dueDate.getDay(); // 0 = Sun
        const hourOfDay = dueDate.getHours();
        const dateString = toLocalString(dueDate);
        const isHoliday = holidayStrings.has(dateString);

        const isBusinessHour = !(
            dayOfWeek === 0 || 
            isHoliday ||
            (dayOfWeek === 6 && hourOfDay >= 16)
        );
        
        if (isBusinessHour) {
            hoursRemaining--;
        }
    }
    const isLate = startOfDay(dispatchDate) > startOfDay(dueDate);

    const timeDiffHours = calculateSlaHours(orderDate, dispatchDate, holidays);
    
    const result = { isLate, limitHours, timeDiffHours, dueDate };
    slaCache.current.set(order.id, result);
    return result;
  }, [holidays]);
  
  const wasDispatchedLate = useCallback((order: EcommerceOrder): boolean => {
    if (!order.id) return false;
    if (wasLateCache.current.has(order.id)) return wasLateCache.current.get(order.id)!;

    if (!order.dispatchDate || !order.fechaPedido) return false;
    
    const orderDate = new Date(order.fechaPedido);
    const dispatchDate = new Date(order.dispatchDate);

    const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48, };
    const defaultTimeLimit = 48;
    const tienda = order.tienda?.trim().toUpperCase() ?? '';
    const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
    const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
    
    const timeDiffHours = calculateSlaHours(orderDate, dispatchDate, holidays);
    
    const isLate = timeDiffHours > limitHours;
    wasLateCache.current.set(order.id, isLate);
    return isLate;
  }, [holidays]);


  const storeFilteredOrders = useMemo(() => {
      if (storeFilter.length === 0) return allOrders;
      return allOrders.filter(o => o.tienda && storeFilter.includes(o.tienda));
  }, [allOrders, storeFilter]);

  const dateFilteredOrders = useMemo(() => {
    if (!dateFilter?.from) {
        return storeFilteredOrders;
    }
    const fromDate = startOfDay(dateFilter.from);
    const toDate = dateFilter.to ? endOfDay(dateFilter.to) : endOfDay(dateFilter.from);
    
    return storeFilteredOrders.filter(o => {
        if (!o.dispatchDate) return false;
        const dispatchDate = new Date(o.dispatchDate);
        return dispatchDate >= fromDate && dispatchDate <= toDate;
    });
  }, [storeFilteredOrders, dateFilter]);
  
  const dailySummary = useMemo(() => {
    const dispatchesForDate = storeFilteredOrders.filter(order => 
        order.dispatchDate && isSameDay(new Date(order.dispatchDate), activeDate)
    );
    const totalDispatched = dispatchesForDate.length;
    let onTimeCount = 0;
    dispatchesForDate.forEach(o => {
      if (!getSlaDetails(o).isLate) {
        onTimeCount++;
      }
    });
    const lateCount = totalDispatched - onTimeCount;
    const onTimeRate = totalDispatched > 0 ? (onTimeCount / totalDispatched) * 100 : 100;

    return { totalDispatched, onTimeCount, lateCount, onTimeRate, dispatchesForDate };
  }, [storeFilteredOrders, activeDate, getSlaDetails]);

  const uniqueStores = useMemo(() => {
    return Array.from(new Set(allOrders.map(o => o.tienda).filter(Boolean))).sort();
  }, [allOrders]);

  const filteredData = useMemo(() => {
    let data = dailySummary.dispatchesForDate;

    if (statusFilter !== 'all') {
        data = data.filter(order => {
            const { isLate } = getSlaDetails(order);
            return statusFilter === 'late' ? isLate : !isLate;
        });
    }

    return data;
  }, [dailySummary.dispatchesForDate, statusFilter, getSlaDetails]);
  
  const byStore = useMemo(() => {
    let dataToAnalyze = dailySummary.dispatchesForDate;
    if (statusFilter !== 'all') {
        dataToAnalyze = dataToAnalyze.filter(order => {
            const { isLate } = getSlaDetails(order);
            return statusFilter === 'late' ? isLate : !isLate;
        });
    }
    const totalDispatches = dataToAnalyze.length;
    
    const storeCounts = dataToAnalyze.reduce((acc, order) => {
        const store = order.tienda || 'Sin Tienda';
        acc[store] = (acc[store] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(storeCounts)
        .map(([name, count]) => ({ 
            name, 
            count,
            percentage: totalDispatches > 0 ? (count / totalDispatches) * 100 : 0
        }))
        .sort((a,b) => b.count - a.count);
  }, [dailySummary.dispatchesForDate, statusFilter, getSlaDetails]);


  const byStoreSummary = useMemo(() => {
    let dataToAnalyze = dailySummary.dispatchesForDate;
     if (statusFilter !== 'all') {
        dataToAnalyze = dataToAnalyze.filter(order => {
            const { isLate } = getSlaDetails(order);
            return statusFilter === 'late' ? isLate : !isLate;
        });
    }

    const storeStats = dataToAnalyze.reduce((acc, order) => {
        const store = order.tienda || 'Sin Tienda';
        if (!acc[store]) {
            acc[store] = { onTime: 0, late: 0, total: 0 };
        }
        acc[store].total++;
        const { isLate } = getSlaDetails(order);
        if (isLate) {
            acc[store].late++;
        } else {
            acc[store].onTime++;
        }
        return acc;
    }, {} as Record<string, { onTime: number; late: number; total: number }>);

    return Object.entries(storeStats)
        .map(([name, stats]) => ({ 
            name, 
            ...stats,
            compliance: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 100,
        }))
        .sort((a, b) => b.total - a.total);
  }, [dailySummary.dispatchesForDate, statusFilter, storeFilter, getSlaDetails]);
  
  const dispatchTrend = useMemo(() => {
    const dayCounts = new Map<string, number>();

    dateFilteredOrders.forEach(order => {
        if (order.dispatchDate) {
            const dayKey = format(new Date(order.dispatchDate), 'yyyy-MM-dd');
            dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
        }
    });

    return Array.from(dayCounts.entries()).map(([day, count]) => ({
        name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
        Despachos: count,
        fullDate: new Date(day + 'T00:00:00'),
    })).sort((a, b) => a.fullDate.getTime() - b.fullDate.getTime());
  }, [dateFilteredOrders]);
  
    const effectivenessByOrderDay = useMemo(() => {
        const allDispatched = dateFilteredOrders;
        const dayStats = new Map<string, { total: number, onTime: number }>();

        allDispatched.forEach(order => {
            if (order.fechaPedido) {
                const dayKey = format(new Date(order.fechaPedido), 'yyyy-MM-dd');
                const stats = dayStats.get(dayKey) || { total: 0, onTime: 0 };
                stats.total++;
                if (!getSlaDetails(order).isLate) stats.onTime++;
                dayStats.set(dayKey, stats);
            }
        });

        return Array.from(dayStats.entries()).map(([day, stats]) => ({
            name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
            date: day,
            Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
        })).sort((a, b) => a.date.localeCompare(b.date));
    }, [dateFilteredOrders, getSlaDetails]);

  const effectivenessByDispatchDay = useMemo(() => {
      const allDispatched = dateFilteredOrders;
      const dayStats = new Map<string, { total: number, onTime: number }>();

      allDispatched.forEach(order => {
          const groupDate = order.dispatchDate;
          if (groupDate) {
              const dayKey = format(new Date(groupDate), 'yyyy-MM-dd');
              const stats = dayStats.get(dayKey) || { total: 0, onTime: 0 };
              stats.total++;
              if (!getSlaDetails(order).isLate) stats.onTime++;
              dayStats.set(dayKey, stats);
          }
      });

      return Array.from(dayStats.entries()).map(([day, stats]) => ({
          name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
          date: day,
          Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
      })).sort((a, b) => a.date.localeCompare(b.date));
  }, [dateFilteredOrders, getSlaDetails]);

  const effectivenessByMonth = useMemo(() => {
    const allDispatched = dateFilteredOrders;
    const monthStats = new Map<string, { total: number, onTime: number }>();

    allDispatched.forEach(order => {
        const groupDate = order.dispatchDate;
        if(groupDate) {
            const monthKey = format(new Date(groupDate), 'yyyy-MM');
            const stats = monthStats.get(monthKey) || { total: 0, onTime: 0 };
            stats.total++;
            if (!getSlaDetails(order).isLate) stats.onTime++;
            monthStats.set(monthKey, stats);
        }
    });

    return Array.from(monthStats.entries()).map(([month, stats]) => ({
        name: format(new Date(month + '-02T00:00:00'), 'MMM yyyy', { locale: es }),
        date: month,
        "Efectividad Mensual": stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
    })).sort((a,b) => a.date.localeCompare(b.date));
  }, [dateFilteredOrders, getSlaDetails]);
  
  const historicalSummary = useMemo(() => {
    const dispatched = dateFilteredOrders;
    const totalDispatched = dispatched.length;
    
    // Strict Compliance (by hour)
    const onTimeStrict = dispatched.filter(o => !wasDispatchedLate(o)).length;
    const effectivenessStrict = totalDispatched > 0 ? (onTimeStrict / totalDispatched) * 100 : 100;
    
    // Flexible Compliance (by day)
    const onTimeFlexible = dispatched.filter(o => !getSlaDetails(o).isLate).length;
    const effectivenessFlexible = totalDispatched > 0 ? (onTimeFlexible / totalDispatched) * 100 : 100;

    return { 
        totalDispatched, 
        onTime: onTimeFlexible, 
        late: totalDispatched - onTimeFlexible, 
        effectiveness: effectivenessFlexible,
        effectivenessStrict: effectivenessStrict
    };
  }, [dateFilteredOrders, getSlaDetails, wasDispatchedLate]);

  const historicalStoreSummary = useMemo(() => {
    const dispatchedOrders = dateFilteredOrders; 

    const storeStats = dispatchedOrders.reduce((acc, order) => {
        const store = order.tienda || 'Sin Tienda';
        if (!acc[store]) {
            acc[store] = { onTime: 0, late: 0, total: 0 };
        }
        acc[store].total++;
        if (order.dispatchDate && order.fechaPedido) {
            if (!getSlaDetails(order).isLate) {
                acc[store].onTime++;
            } else {
                acc[store].late++;
            }
        }
        return acc;
    }, {} as Record<string, { onTime: number; late: number; total: number }>);

    return Object.entries(storeStats)
        .map(([name, stats]) => ({
            name,
            ...stats,
            compliance: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 100,
        }))
        .sort((a, b) => b.total - a.total);
    }, [dateFilteredOrders, getSlaDetails]);

    const dispatchTimeRangesByStore = useMemo(() => {
    const dispatchedOrders = dateFilteredOrders.filter(o => o.dispatchDate && o.fechaPedido);

    const storeRanges = new Map<string, {
        '0-1 Días': number;
        '1-2 Días': number;
        '2-3 Días': number;
        '>3 Días': number;
        total: number;
        totalDispatchDays: number;
    }>();

    dispatchedOrders.forEach(order => {
        const store = order.tienda || 'Sin Tienda';
        if (!storeRanges.has(store)) {
            storeRanges.set(store, { '0-1 Días': 0, '1-2 Días': 0, '2-3 Días': 0, '>3 Días': 0, total: 0, totalDispatchDays: 0 });
        }
        
        const storeData = storeRanges.get(store)!;
        storeData.total++;
        
        const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
        storeData.totalDispatchDays += days;

        if (days <= 1) {
            storeData['0-1 Días']++;
        } else if (days <= 2) {
            storeData['1-2 Días']++;
        } else if (days <= 3) {
             storeData['2-3 Días']++;
        } else {
            storeData['>3 Días']++;
        }
    });

    return Array.from(storeRanges.entries()).map(([store, storeData]) => ({
        store,
        ...storeData,
        averageDispatchDays: storeData.total > 0 ? storeData.totalDispatchDays / storeData.total : 0,
        '0-1 Días %': storeData.total > 0 ? (storeData['0-1 Días'] / storeData.total) * 100 : 0,
        '1-2 Días %': storeData.total > 0 ? (storeData['1-2 Días'] / storeData.total) * 100 : 0,
        '2-3 Días %': storeData.total > 0 ? (storeData['2-3 Días'] / storeData.total) * 100 : 0,
        '>3 Días %': storeData.total > 0 ? (storeData['>3 Días'] / storeData.total) * 100 : 0,
    })).sort((a,b) => b.total - a.total);
  }, [dateFilteredOrders, holidays]);

    const overallAverageDispatchDays = useMemo(() => {
        const dispatchedOrders = dateFilteredOrders.filter(o => o.dispatchDate && o.fechaPedido);
        if (dispatchedOrders.length === 0) return 0;

        const totalDays = dispatchedOrders.reduce((sum, order) => {
            const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
            return sum + days;
        }, 0);

        return totalDays / dispatchedOrders.length;
    }, [dateFilteredOrders, holidays]);


  const handleExportPdf = async () => {
    const input = reportContentRef.current;
    if (!input) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo encontrar el contenido para exportar.' });
      return;
    }
    
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
        
        const canvas = await html2canvas(element, {
          scale: 1.5,
          useCORS: true,
          backgroundColor: '#ffffff'
        });

        const contentWidth = pdfWidth - margin * 2;
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        const imgHeight = (canvas.height * contentWidth) / canvas.width;
        
        addPageIfNeeded(imgHeight + 5);
        
        pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight);
        currentY += imgHeight + 10;
      }
    };

    pdf.setFontSize(20);
    pdf.text("Reporte de Despachos Diarios", pdfWidth / 2, currentY, { align: 'center' });
    pdf.setFontSize(12);
    pdf.text(format(activeDate, "PPP", { locale: es }), pdfWidth / 2, currentY + 8, { align: 'center' });
    currentY += 20;

    await addElementToPdf('.pdf-section-stats', 'Indicadores del Día');
    await addElementToPdf('.pdf-section-historical-summary', 'Resumen Histórico de Despachos');
    await addElementToPdf('.pdf-section-dispatch-ranges-by-store', 'Rangos de Tiempo de Despacho por Tienda');
    await addElementToPdf('.pdf-section-trend-chart', 'Tendencia de Despachos');
    await addElementToPdf('.pdf-section-compliance-dispatch-day', 'Efectividad por Fecha de Despacho');
    await addElementToPdf('.pdf-section-compliance-order-day', 'Efectividad por Fecha de Pedido');
    await addElementToPdf('.pdf-section-compliance-month', 'Efectividad de Despacho por Mes');
    await addElementToPdf('.pdf-section-store-chart', 'Despachos por Tienda (Diario)');
    await addElementToPdf('.pdf-section-store-summary-table', 'Resumen de Despachos por Tienda (Diario)');
    await addElementToPdf('.pdf-section-historical-store-summary', 'Resumen Histórico por Tienda');
    
    pdf.save(`Reporte_Despachos_${format(activeDate, "yyyy-MM-dd")}.pdf`);
    toast({ title: "Éxito", description: "El reporte en PDF ha sido generado." });

    if (originalTheme === 'dark') {
      document.documentElement.classList.add('dark');
    }

    setIsExporting(false);
  };
  
  const handleDayClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload?.fullDate) {
        const clickedDate = data.activePayload[0].payload.fullDate;
        const newRange = { from: clickedDate, to: clickedDate };
        if (dateFilter?.from && isSameDay(clickedDate, dateFilter.from) && !dateFilter.to) {
            setDateFilter(undefined);
        } else {
            setDateFilter(newRange);
        }
    }
  };


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

  const renderCustomBarLabel = (props: any) => {
    const { x, y, width, value } = props;
    const percentage = props.payload?.percentage || 0;
    return (
        <text x={x + width + 5} y={y + props.height / 2} dy={4} fill="currentColor" fontSize={12} textAnchor="start">
            {`${value} (${percentage.toFixed(1)}%)`}
        </text>
    );
  };
  
  const handleSearchForCorrection = () => {
    if (!correctionOrderIds.trim()) {
        setFoundOrdersForCorrection([]);
        return;
    }
    const idsToSearch = correctionOrderIds.split(/[\s,]+/).map(id => id.trim()).filter(Boolean);
    const foundOrders = allOrders.filter(o => idsToSearch.includes(o.id));
    
    if (foundOrders.length > 0) {
        setFoundOrdersForCorrection(foundOrders);
        if (foundOrders.length !== idsToSearch.length) {
            const foundIds = new Set(foundOrders.map(o => o.id));
            const notFoundIds = idsToSearch.filter(id => !foundIds.has(id));
            toast({ variant: 'destructive', title: 'Algunos pedidos no encontrados', description: `No se encontraron pedidos con los siguientes IDs: ${notFoundIds.join(', ')}.`});
        }
    } else {
        setFoundOrdersForCorrection([]);
        toast({ variant: 'destructive', title: 'No encontrado', description: 'No se encontró ningún pedido con los IDs proporcionados.'});
    }
  };

  const handleUpdateDispatchDate = async () => {
    if (foundOrdersForCorrection.length === 0 || !newDispatchDate) return;

    const updates = foundOrdersForCorrection.map(order => ({
        orderId: order.id,
        dispatchDate: newDispatchDate
    }));

    const result = await batchUpdateEcommerceOrderDispatchDates(updates);
    if (result.success) {
        toast({ title: 'Fechas actualizadas', description: `${result.updatedCount} pedidos han sido corregidos.`});
        setIsCorrectionDialogOpen(false);
        setFoundOrdersForCorrection([]);
        setCorrectionOrderIds('');
        onRefresh(); // This will refresh all data and KPIs
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
  };


  return (
    <div className="space-y-8" ref={reportContentRef}>
      <Dialog open={isCorrectionDialogOpen} onOpenChange={setIsCorrectionDialogOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Corregir Fecha de Despacho</DialogTitle>
                  <DialogDescription>
                      Seleccione la nueva fecha de despacho para los {foundOrdersForCorrection.length} pedidos seleccionados.
                  </DialogDescription>
              </DialogHeader>
              <div className="py-4 flex justify-center">
                  <Calendar
                      mode="single"
                      selected={newDispatchDate}
                      onSelect={setNewDispatchDate}
                      initialFocus
                      locale={es}
                  />
              </div>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCorrectionDialogOpen(false)}>Cancelar</Button>
                  <Button onClick={handleUpdateDispatchDate} disabled={!newDispatchDate}>Guardar Nueva Fecha</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
      <Card className="print-hide">
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Dashboard de Despachos</CardTitle>
            <CardDescription>
              Métricas y detalles para el día: {format(activeDate, "PPP", { locale: es })}.
              {storeFilter.length > 0 && <span className="font-semibold text-primary"> Filtrando por: {storeFilter.length} tienda(s)</span>}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {(storeFilter.length > 0 || statusFilter !== 'all' || dateFilter) && (
                <Button variant="ghost" onClick={() => { setStoreFilter([]); setStatusFilter('all'); setDateFilter(undefined); }}>
                    <Filter className="mr-2 h-4 w-4"/> Limpiar Filtros
                </Button>
            )}
             <MultiSelectFilter
                title="Tiendas"
                options={uniqueStores.map(store => ({ label: store, value: store }))}
                selectedValues={new Set(storeFilter)}
                onSelectionChange={(selected) => setStoreFilter(Array.from(selected))}
            />
             <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date-range-picker"
                        variant={"outline"}
                        className={cn("w-[260px] justify-start text-left font-normal", !dateFilter && "text-muted-foreground")}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateFilter?.from ? (dateFilter.to ? (<>{format(dateFilter.from, "LLL dd, y", { locale: es })} - {format(dateFilter.to, "LLL dd, y", { locale: es })}</>) : (format(dateFilter.from, "LLL dd, y", { locale: es }))) : (<span>Seleccionar rango...</span>)}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                    <Calendar initialFocus mode="range" defaultMonth={dateFilter?.from} selected={dateFilter} onSelect={setDateFilter} numberOfMonths={2} locale={es} />
                </PopoverContent>
            </Popover>
            <Button onClick={handleExportPdf} variant="outline" disabled={isExporting}>
              {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}
              Exportar PDF
            </Button>
            <Button onClick={onReturn} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a Dashboards
            </Button>
          </div>
        </CardHeader>
      </Card>
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="pdf-section-stats grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard title="Total Despachado Hoy" value={dailySummary.totalDispatched.toLocaleString()} icon={<Truck />} onClick={() => setStatusFilter('all')} isActive={statusFilter === 'all'} />
              <StatCard title="Despachos a Tiempo" value={dailySummary.onTimeCount.toLocaleString()} icon={<CheckCircle />} color="text-green-500" onClick={() => setStatusFilter('onTime')} isActive={statusFilter === 'onTime'} />
              <StatCard title="Despachos Atrasados" value={dailySummary.lateCount.toLocaleString()} icon={<AlertCircle />} color="text-red-500" onClick={() => setStatusFilter('late')} isActive={statusFilter === 'late'} />
              <StatCard title="Tasa de Cumplimiento (Día)" value={`${dailySummary.onTimeRate.toFixed(1)}%`} icon={<GaugeCircle />} color={getComplianceColor(dailySummary.onTimeRate)} subtitle="Lógica Flexible (por día)"/>
          </div>

          <div className="pdf-section-historical-summary">
            <Card>
                <CardHeader>
                    <CardTitle>Análisis Histórico de Despachos</CardTitle>
                    <CardDescription>Los datos históricos reflejan el rango de fechas seleccionado en el filtro.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <StatCard 
                            title="Efectividad Histórica (Flexible)" 
                            value={`${historicalSummary.effectiveness.toFixed(2)}%`} 
                            icon={<ShieldCheck />} 
                            color={getComplianceColor(historicalSummary.effectiveness)} 
                            subtitle="Cumplimiento por día"
                        />
                         <StatCard 
                            title="Efectividad Histórica (Estricta)" 
                            value={`${historicalSummary.effectivenessStrict.toFixed(2)}%`} 
                            icon={<ShieldCheck />} 
                            color={getComplianceColor(historicalSummary.effectivenessStrict)} 
                            subtitle="Cumplimiento por hora (SLA)"
                        />
                         <StatCard 
                            title="Promedio Días Despacho" 
                            value={`${overallAverageDispatchDays.toFixed(1)} días`} 
                            icon={<Timer />}
                            subtitle="Tiempo hábil desde pedido a despacho"
                        />
                        <StatCard
                            title="Total Despachado (Rango)"
                            value={historicalSummary.totalDispatched.toLocaleString()}
                            icon={<Package />}
                        />
                    </div>
                </CardContent>
            </Card>
          </div>
          
           <div className="pdf-section-dispatch-ranges-by-store">
             <Card>
                <CardHeader>
                    <CardTitle>Rangos de Tiempo de Despacho por Tienda (Histórico)</CardTitle>
                    <CardDescription>
                        Distribución de los despachos en el rango de fechas seleccionado por tienda.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tienda</TableHead>
                                <TableHead className="text-right">Total Despachos</TableHead>
                                <TableHead className="text-right">Promedio Días Despacho</TableHead>
                                <TableHead className="text-right">0-1 Días</TableHead>
                                <TableHead className="text-right">1-2 Días</TableHead>
                                <TableHead className="text-right">2-3 Días</TableHead>
                                <TableHead className="text-right">&gt;3 Días</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {dispatchTimeRangesByStore.map(row => (
                                <TableRow key={row.store}>
                                    <TableCell className="font-medium">{row.store}</TableCell>
                                    <TableCell className="text-right font-bold">{row.total.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-bold">{row.averageDispatchDays.toFixed(1)}</TableCell>
                                    <TableCell className="text-right">
                                        {row['0-1 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['0-1 Días %'].toFixed(1)}%)</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {row['1-2 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['1-2 Días %'].toFixed(1)}%)</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {row['2-3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['2-3 Días %'].toFixed(1)}%)</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {row['>3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['>3 Días %'].toFixed(1)}%)</span>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
             </Card>
            </div>

           <div className="grid grid-cols-1 gap-8">
            <div className="pdf-section-trend-chart">
                 <Card>
                    <CardHeader>
                        <CardTitle>Tendencia de Despachos</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dispatchTrend} onClick={handleDayClick} style={{cursor: 'pointer'}}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis allowDecimals={false} />
                                <Tooltip />
                                <Legend />
                                <Line type="monotone" dataKey="Despachos" stroke="hsl(var(--chart-2))" strokeWidth={2}>
                                  <LabelList dataKey="Despachos" position="top" style={{ fontSize: '10px' }} />
                                </Line>
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
            <div className="pdf-section-compliance-dispatch-day">
                <Card>
                    <CardHeader>
                        <CardTitle>Efectividad por Fecha de Despacho</CardTitle>
                        <CardDescription>Porcentaje de despachos puntuales basado en el día en que se realizó el envío.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={effectivenessByDispatchDay}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis domain={[0, 100]} unit="%" />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey="Efectividad" stroke="hsl(var(--chart-1))" strokeWidth={2} >
                                    <LabelList dataKey="Efectividad" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} />
                                </Line>
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
             <div className="pdf-section-compliance-order-day">
                <Card>
                    <CardHeader>
                        <CardTitle>Efectividad por Fecha de Pedido</CardTitle>
                        <CardDescription>Porcentaje de cumplimiento basado en el día en que se realizó el pedido, sin importar cuándo se despachó.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={effectivenessByOrderDay}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis domain={[0, 100]} unit="%" />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey="Efectividad" stroke="hsl(var(--chart-3))" strokeWidth={2} >
                                    <LabelList dataKey="Efectividad" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} />
                                </Line>
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
            <div className="pdf-section-compliance-month">
                <Card>
                    <CardHeader>
                        <CardTitle>Efectividad de Despacho por Mes</CardTitle>
                        <CardDescription>Porcentaje de despachos puntuales por mes.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={effectivenessByMonth}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis domain={[0, 100]} unit="%" />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend />
                                <Line type="monotone" dataKey="Efectividad Mensual" stroke="hsl(var(--chart-2))" strokeWidth={2} >
                                    <LabelList dataKey="Efectividad Mensual" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} />
                                </Line>
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
            <div className="pdf-section-store-chart">
                <Card>
                    <CardHeader>
                        <CardTitle>Despachos por Tienda (Diario)</CardTitle>
                        <CardDescription>Distribución de los despachos realizados en el día seleccionado.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={byStore} layout="vertical" margin={{ left: 100, right: 50 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis type="number" allowDecimals={false} />
                                <YAxis dataKey="name" type="category" width={100} interval={0} tick={{ fontSize: 12 }} />
                                <Tooltip formatter={(value: number, name: string, props: any) => [`${value} pedidos`, `Participación: ${props.payload.percentage.toFixed(1)}%`]} />
                                <Bar dataKey="count" name="Pedidos" fill="hsl(var(--chart-1))" cursor="pointer">
                                    <LabelList content={renderCustomBarLabel} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
          </div>
          
           <div className="pdf-section-store-summary-table">
            <Card>
                <CardHeader>
                    <CardTitle>Resumen de Despachos por Tienda (Diario)</CardTitle>
                    <CardDescription>Análisis de cumplimiento de SLA (flexible por día) para los despachos del día seleccionado.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tienda</TableHead>
                                <TableHead className="text-right">A Tiempo</TableHead>
                                <TableHead className="text-right">Atrasados</TableHead>
                                <TableHead className="text-right font-bold">Total</TableHead>
                                <TableHead className="text-right font-bold">Cumplimiento</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {byStoreSummary.map(store => (
                                <TableRow key={store.name}>
                                    <TableCell>{store.name}</TableCell>
                                    <TableCell className="text-right text-green-600 font-semibold">{store.onTime}</TableCell>
                                    <TableCell className="text-right text-red-600 font-semibold">{store.late}</TableCell>
                                    <TableCell className="text-right font-bold">{store.total}</TableCell>
                                    <TableCell className={cn("text-right font-bold text-lg", getComplianceColor(store.compliance))}>
                                        {store.compliance.toFixed(1)}%
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
          </div>
          
          <div className="pdf-section-historical-store-summary">
            <Card>
                <CardHeader>
                    <CardTitle>Resumen Histórico de Despachos por Tienda</CardTitle>
                    <CardDescription>Análisis de cumplimiento de SLA (flexible por día) para los despachos en el rango de fechas seleccionado.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tienda</TableHead>
                                <TableHead className="text-right">A Tiempo</TableHead>
                                <TableHead className="text-right">Atrasados</TableHead>
                                <TableHead className="text-right font-bold">Total</TableHead>
                                <TableHead className="text-right font-bold">Cumplimiento</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {historicalStoreSummary.map(store => (
                                <TableRow key={store.name}>
                                    <TableCell>{store.name}</TableCell>
                                    <TableCell className="text-right text-green-600 font-semibold">{store.onTime}</TableCell>
                                    <TableCell className="text-right text-red-600 font-semibold">{store.late}</TableCell>
                                    <TableCell className="text-right font-bold">{store.total}</TableCell>
                                    <TableCell className={cn("text-right font-bold text-lg", getComplianceColor(store.compliance))}>
                                        {store.compliance.toFixed(1)}%
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
          </div>

          <Card className="print-hide">
            <CardHeader>
              <CardTitle>Detalle de Despachos del Día</CardTitle>
              <CardDescription>Listado de todos los pedidos despachados en la fecha seleccionada.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto border rounded-md">
                 <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID Pedido</TableHead>
                        <TableHead>Tienda</TableHead>
                        <TableHead>Estado SLA</TableHead>
                        <TableHead>Fecha Pedido</TableHead>
                        <TableHead>Fecha Límite SLA</TableHead>
                        <TableHead>Fecha Despacho</TableHead>
                        <TableHead>Detalle SLA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.map(order => {
                        const { isLate, limitHours, timeDiffHours, dueDate } = getSlaDetails(order);
                        return (
                        <TableRow key={order.id}>
                          <TableCell>{order.id}</TableCell>
                          <TableCell>{order.tienda}</TableCell>
                          <TableCell>
                            <Badge variant={isLate ? 'destructive' : 'default'}>
                              {isLate ? 'Atrasado' : 'A Tiempo'}
                            </Badge>
                          </TableCell>
                           <TableCell>
                            {order.fechaPedido ? format(new Date(order.fechaPedido), 'PPP p', { locale: es }) : 'N/A'}
                          </TableCell>
                          <TableCell>
                            {dueDate ? format(dueDate, 'PPP p', { locale: es }) : 'N/A'}
                          </TableCell>
                          <TableCell>
                            {order.dispatchDate ? format(new Date(order.dispatchDate), 'PPP', { locale: es }) : 'N/A'}
                          </TableCell>
                          <TableCell className="text-xs">
                             {timeDiffHours !== null
                                ? `Despachado en ${timeDiffHours.toFixed(1)} horas (SLA: ${limitHours}h).`
                                : 'N/A'
                            }
                          </TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="print-hide">
              <CardHeader>
                  <CardTitle>Corrección Manual de Fecha de Despacho</CardTitle>
                  <CardDescription>Busque uno o varios pedidos por ID (separados por coma, espacio o nueva línea) para editar su fecha de despacho.</CardDescription>
              </CardHeader>
              <CardContent>
                  <div className="flex w-full max-w-lg items-start space-x-2">
                      <Textarea
                          placeholder="ID(s) del Pedido..."
                          value={correctionOrderIds}
                          onChange={(e) => setCorrectionOrderIds(e.target.value)}
                          rows={3}
                      />
                      <Button onClick={handleSearchForCorrection}><Search className="mr-2 h-4 w-4"/>Buscar</Button>
                  </div>
                  {foundOrdersForCorrection.length > 0 && (
                      <div className="mt-4 space-y-4">
                        <p>Se encontraron <span className="font-bold">{foundOrdersForCorrection.length}</span> pedidos. Seleccione la nueva fecha y guarde los cambios.</p>
                        <div className="max-h-60 overflow-y-auto border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>ID Pedido</TableHead>
                                        <TableHead>Tienda</TableHead>
                                        <TableHead>Fecha Despacho Actual</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                {foundOrdersForCorrection.map(order => (
                                    <TableRow key={order.id}>
                                        <TableCell>{order.id}</TableCell>
                                        <TableCell>{order.tienda}</TableCell>
                                        <TableCell>{order.dispatchDate ? format(new Date(order.dispatchDate), 'PPP', { locale: es }) : 'N/A'}</TableCell>
                                    </TableRow>
                                ))}
                                </TableBody>
                            </Table>
                        </div>
                        <Button className="mt-2" size="sm" variant="outline" onClick={() => setIsCorrectionDialogOpen(true)}><Edit className="mr-2 h-4 w-4"/>Editar Fecha para {foundOrdersForCorrection.length} Pedidos</Button>
                      </div>
                  )}
              </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};


interface EfficiencyDashboardProps {
    orders: EcommerceOrder[];
    logs: DelayedOrderLog[];
    holidays: Date[];
    dateRange?: DateRange;
    onDateRangeChange: (dateRange?: DateRange) => void;
    storeFilter: string[];
    onStoreFilterChange: (stores: string[]) => void;
}

const EfficiencyDashboard: React.FC<EfficiencyDashboardProps> = ({ orders, logs, holidays, dateRange, onDateRangeChange, storeFilter, onStoreFilterChange }) => {
    
    const { toast } = useToast();
    const reportContentRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const { theme } = useTheme();
    
    const uniqueStores = useMemo(() => {
        if (!orders) return [];
        return Array.from(new Set(orders.map(o => o.tienda).filter(Boolean))).sort();
    }, [orders]);

    const handleStoreFilterChange = (selected: Set<string>) => {
        onStoreFilterChange(Array.from(selected));
    };

    const dateFilteredData = useMemo(() => {
        if (!dateRange?.from) return orders;
        const fromDate = startOfDay(dateRange.from);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
        return orders.filter(order => {
            if (!order.fechaPedido) return false;
            const orderDate = new Date(order.fechaPedido);
            return orderDate >= fromDate && orderDate <= toDate;
        });
    }, [orders, dateRange]);

    const filteredData = useMemo(() => {
        if (storeFilter.length === 0) {
            return dateFilteredData;
        }
        return dateFilteredData.filter(order => order.tienda && storeFilter.includes(order.tienda));
    }, [dateFilteredData, storeFilter]);
    
    const logMap = useMemo(() => new Map(logs.map(log => [log.orderId, log])), [logs]);

    const wasDispatchedLate = useCallback((order: EcommerceOrder): boolean => {
        if (!order.dispatchDate || !order.fechaPedido) return false;
        
        const orderDate = new Date(order.fechaPedido);
        const dispatchDate = new Date(order.dispatchDate);

        const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48, };
        const defaultTimeLimit = 48;
        const tienda = order.tienda?.trim().toUpperCase() ?? '';
        const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
        const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
        
        const timeDiffHours = calculateSlaHours(orderDate, dispatchDate, holidays);
        
        return timeDiffHours > limitHours;

    }, [holidays]);

    const historicalOnTimeRate = useMemo(() => {
        const allDispatchedOrders = filteredData.filter(o => o.dispatchDate && (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');
        if (allDispatchedOrders.length === 0) return 100;
        const onTimeDispatchedOrders = allDispatchedOrders.filter(o => !wasDispatchedLate(o));
        return (onTimeDispatchedOrders.length / allDispatchedOrders.length) * 100;
    }, [filteredData, wasDispatchedLate]);

    const overallAverageDispatchDays = useMemo(() => {
        const dispatchedOrders = filteredData.filter(o => o.dispatchDate && o.fechaPedido);
        if (dispatchedOrders.length === 0) return 0;

        const totalDays = dispatchedOrders.reduce((sum, order) => {
            const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
            return sum + days;
        }, 0);

        return totalDays / dispatchedOrders.length;
    }, [filteredData, holidays]);
    
    const isCurrentlyDelayed = useCallback((order: EcommerceOrder, referenceDate: Date): boolean => {
        const excludedStates = ['en transporte externo', 'en tienda', 'entregado', 'cancelado', 'pendiente pago', 'pendiente cancelar'];
        const estado = (order.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
        if (excludedStates.includes(estado) || order.dispatchDate) return false;
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
    
    const avgTimeToResolveByStore = useMemo(() => {
        const atRiskOrders = filteredData.filter(order => isCurrentlyDelayed(order, new Date()) || wasDispatchedLate(order));
        
        const storeStats = new Map<string, { totalDays: number; count: number; withCrm: number }>();

        atRiskOrders.forEach(order => {
            if (!order.fechaPedido || !order.tienda) return;
            const log = logMap.get(order.id);
            const crmJustification = log?.justifications?.slice().reverse().find(j => j.bitrixTaskCreationDate);
            let resolutionDate: Date | undefined;
            let hasCrm = false;

            if (crmJustification?.bitrixTaskCreationDate) {
                resolutionDate = new Date(crmJustification.bitrixTaskCreationDate);
                hasCrm = true;
            } else if (order.dispatchDate) {
                resolutionDate = new Date(order.dispatchDate);
            }

            if (resolutionDate) {
                const startDate = new Date(order.fechaPedido);
                if (!isNaN(startDate.getTime()) && resolutionDate > startDate) {
                    const store = order.tienda;
                    const stats = storeStats.get(store) || { totalDays: 0, count: 0, withCrm: 0 };
                    stats.totalDays += calculateSlaHours(startDate, resolutionDate, holidays) / 24;
                    stats.count++;
                    if (hasCrm) stats.withCrm++;
                    storeStats.set(store, stats);
                }
            }
        });

        return Array.from(storeStats.entries()).map(([storeName, stats]) => ({
            name: storeName,
            averageDays: stats.count > 0 ? stats.totalDays / stats.count : 0,
            count: stats.count,
            withCrmPercentage: stats.count > 0 ? (stats.withCrm / stats.count) * 100 : 0,
        })).sort((a,b) => b.averageDays - a.averageDays);
    }, [filteredData, logMap, holidays, isCurrentlyDelayed, wasDispatchedLate]);
    
     const overallAvgTimeToResolve = useMemo(() => {
        if (!avgTimeToResolveByStore || avgTimeToResolveByStore.length === 0) return 0;
        const totalDays = avgTimeToResolveByStore.reduce((sum, s) => sum + (s.averageDays * s.count), 0);
        const totalCount = avgTimeToResolveByStore.reduce((sum, s) => sum + s.count, 0);
        return totalCount > 0 ? totalDays / totalCount : 0;
    }, [avgTimeToResolveByStore]);
    
    const avgBitrixToDispatchDays = useMemo(() => {
        const ordersWithBitrixAndDispatch = filteredData.filter(order => {
            const log = logMap.get(order.id);
            const bitrixDate = log?.justifications?.find(j => j.bitrixTaskCreationDate)?.bitrixTaskCreationDate;
            return bitrixDate && order.dispatchDate;
        });

        if (ordersWithBitrixAndDispatch.length === 0) return 0;

        const totalDays = ordersWithBitrixAndDispatch.reduce((sum, order) => {
            const log = logMap.get(order.id)!;
            const bitrixDate = new Date(log.justifications.find(j => j.bitrixTaskCreationDate)!.bitrixTaskCreationDate!);
            const dispatchDate = new Date(order.dispatchDate!);
            const hours = calculateSlaHours(bitrixDate, dispatchDate, holidays);
            return sum + (hours / 24);
        }, 0);

        return totalDays / ordersWithBitrixAndDispatch.length;
    }, [filteredData, logMap, holidays]);
    
    const dispatchTimeRangesByWeek = useMemo(() => {
        const dispatchedOrders = filteredData.filter(o => o.dispatchDate && o.fechaPedido);
        const weekStats = new Map<string, { startDate: Date; endDate: Date; '0-1 Días': number; '1-2 Días': number; '2-3 Días': number; '>3 Días': number; total: number; totalDispatchDays: number; }>();
        dispatchedOrders.forEach(order => {
            const dispatchDate = new Date(order.dispatchDate!);
            const weekStart = startOfWeek(dispatchDate, { weekStartsOn: 1 });
            const weekEnd = endOfWeek(dispatchDate, { weekStartsOn: 1 });
            const weekKey = format(weekStart, 'yyyy-MM-dd');
            if (!weekStats.has(weekKey)) weekStats.set(weekKey, { startDate: weekStart, endDate: weekEnd, '0-1 Días': 0, '1-2 Días': 0, '2-3 Días': 0, '>3 Días': 0, total: 0, totalDispatchDays: 0, });
            const weekData = weekStats.get(weekKey)!;
            weekData.total++;
            const days = calculateSlaHours(new Date(order.fechaPedido!), dispatchDate, holidays) / 24;
            weekData.totalDispatchDays += days;
            if (days <= 1) weekData['0-1 Días']++; else if (days <= 2) weekData['1-2 Días']++; else if (days <= 3) weekData['2-3 Días']++; else weekData['>3 Días']++;
        });
        return Array.from(weekStats.entries()).map(([weekKey, stats]) => {
            const total = stats.total;
            return {
                weekKey,
                weekLabel: `Semana del ${format(stats.startDate, 'dd MMM', { locale: es })} al ${format(stats.endDate, 'dd MMM yyyy', { locale: es })}`,
                ...stats,
                averageDispatchDays: total > 0 ? stats.totalDispatchDays / total : 0,
                '0-1 Días %': total > 0 ? (stats['0-1 Días'] / total) * 100 : 0,
                '1-2 Días %': total > 0 ? (stats['1-2 Días'] / total) * 100 : 0,
                '2-3 Días %': total > 0 ? (stats['2-3 Días'] / total) * 100 : 0,
                '>3 Días %': total > 0 ? (stats['>3 Días'] / total) * 100 : 0,
            };
        }).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [filteredData, holidays]);
    
    const dispatchTimeRangesByStore = useMemo(() => {
        const dispatchedOrders = filteredData.filter(o => o.dispatchDate && o.fechaPedido);
        const storeRanges = new Map<string, { '0-1 Días': number; '1-2 Días': number; '2-3 Días': number; '>3 Días': number; total: number; totalDispatchDays: number; }>();
        dispatchedOrders.forEach(order => {
            const store = order.tienda || 'Sin Tienda';
            if (!storeRanges.has(store)) storeRanges.set(store, { '0-1 Días': 0, '1-2 Días': 0, '2-3 Días': 0, '>3 Días': 0, total: 0, totalDispatchDays: 0 });
            const storeData = storeRanges.get(store)!;
            storeData.total++;
            const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
            storeData.totalDispatchDays += days;
            if (days <= 1) storeData['0-1 Días']++; else if (days <= 2) storeData['1-2 Días']++; else if (days <= 3) storeData['2-3 Días']++; else storeData['>3 Días']++;
        });
        return Array.from(storeRanges.entries()).map(([store, ranges]) => ({
            store, ...ranges,
            averageDispatchDays: ranges.total > 0 ? ranges.totalDispatchDays / ranges.total : 0,
            '0-1 Días %': ranges.total > 0 ? (ranges['0-1 Días'] / ranges.total) * 100 : 0,
            '1-2 Días %': ranges.total > 0 ? (ranges['1-2 Días'] / ranges.total) * 100 : 0,
            '2-3 Días %': ranges.total > 0 ? (ranges['2-3 Días'] / ranges.total) * 100 : 0,
            '>3 Días %': ranges.total > 0 ? (ranges['>3 Días'] / ranges.total) * 100 : 0,
        })).sort((a,b) => b.total - a.total);
    }, [filteredData, holidays]);
    
    const effectivenessByDay = useMemo(() => {
        const dayStats = new Map<string, { total: number, onTime: number }>();
        filteredData.forEach(order => {
            if (order.dispatchDate) {
                const dayKey = format(new Date(order.dispatchDate), 'yyyy-MM-dd');
                const stats = dayStats.get(dayKey) || { total: 0, onTime: 0 };
                stats.total++;
                if (!wasDispatchedLate(order)) stats.onTime++;
                dayStats.set(dayKey, stats);
            }
        });
        return Array.from(dayStats.entries()).map(([day, stats]) => ({
            name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
            date: day,
            Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
        })).sort((a, b) => a.date.localeCompare(b.date));
    }, [filteredData, wasDispatchedLate]);
    
     const effectivenessByMonth = useMemo(() => {
        const monthStats = new Map<string, { total: number, onTime: number }>();
        filteredData.forEach(order => {
            if(order.dispatchDate) {
                const monthKey = format(new Date(order.dispatchDate), 'yyyy-MM');
                const stats = monthStats.get(monthKey) || { total: 0, onTime: 0 };
                stats.total++;
                if (!wasDispatchedLate(order)) stats.onTime++;
                monthStats.set(monthKey, stats);
            }
        });
        return Array.from(monthStats.entries()).map(([month, stats]) => ({
            name: format(new Date(month + '-02'), 'MMM yyyy', { locale: es }),
            date: month,
            "Efectividad Mensual": stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
        })).sort((a,b) => a.date.localeCompare(b.date));
    }, [filteredData, wasDispatchedLate]);
    
    const storeDispatchPerformance = useMemo(() => {
        let dispatchedOrders = filteredData.filter(o => o.dispatchDate && (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');
        const storeMap = new Map<string, { totalDispatched: number; onTime: number }>();
        dispatchedOrders.forEach(order => {
            const store = order.tienda || 'Sin Tienda';
            const entry = storeMap.get(store) || { totalDispatched: 0, onTime: 0 };
            entry.totalDispatched++;
            if (!wasDispatchedLate(order)) entry.onTime++;
            storeMap.set(store, entry);
        });
        return Array.from(storeMap.entries()).map(([tienda, data]) => ({
            tienda, ...data,
            efficiency: data.totalDispatched > 0 ? (data.onTime / data.totalDispatched) * 100 : 100,
        })).sort((a, b) => b.totalDispatched - a.totalDispatched);
    }, [filteredData, wasDispatchedLate]);

    const getComplianceColor = (compliance: number): string => {
        if (compliance >= 95) return 'text-green-500';
        if (compliance >= 85) return 'text-amber-500';
        return 'text-red-500';
    };

    const handleExportPdf = async () => {
        const input = reportContentRef.current;
        if (!input) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo encontrar el contenido para exportar.' });
            return;
        }
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
            
            const canvas = await html2canvas(element, {
              scale: 1.5,
              useCORS: true,
              backgroundColor: '#ffffff'
            });

            const contentWidth = pdfWidth - margin * 2;
            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const imgHeight = (canvas.height * contentWidth) / canvas.width;
            
            addPageIfNeeded(imgHeight + 5);
            
            pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight);
            currentY += imgHeight + 10;
          }
        };

        pdf.setFontSize(20);
        pdf.text("Reporte de Eficiencia", pdfWidth / 2, currentY, { align: 'center' });
        pdf.setFontSize(12);
        const dateTitle = dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "PPP", { locale: es })} - ${format(dateRange.to, "PPP", { locale: es })}` : format(dateRange.from, "PPP", { locale: es })) : "Todo el Historial";
        pdf.text(dateTitle, pdfWidth / 2, currentY + 8, { align: 'center' });
        currentY += 20;

        await addElementToPdf('.pdf-section-efficiency-stats', 'Indicadores de Eficiencia');
        await addElementToPdf('.pdf-section-time-to-resolve', 'Tiempo Promedio de Resolución por Tienda');
        await addElementToPdf('.pdf-section-dispatch-ranges-by-week', 'Resumen Semanal de Tiempos de Despacho');
        await addElementToPdf('.pdf-section-efficiency-charts', 'Gráficos de Eficiencia');
        await addElementToPdf('.pdf-section-dispatch-ranges', 'Rangos de Tiempo de Despacho por Tienda');
        await addElementToPdf('.pdf-section-store-dispatch-efficiency', 'Eficiencia Histórica de Despacho por Tienda');

        pdf.save(`Reporte_Eficiencia_${format(new Date(), "yyyy-MM-dd")}.pdf`);
        toast({ title: "Éxito", description: "El reporte en PDF ha sido generado." });

        if (originalTheme === 'dark') {
          document.documentElement.classList.add('dark');
        }
        setIsExporting(false);
    }
    
    return (
        <div className="space-y-8" ref={reportContentRef}>
            <Card>
                <CardHeader>
                    <CardTitle>Filtros de Eficiencia</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-4">
                     <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn("w-[260px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, y", { locale: es })} - {format(dateRange.to, "LLL dd, y", { locale: es })}</>) : (format(dateRange.from, "LLL dd, y", { locale: es }))) : (<span>Seleccionar rango...</span>)}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
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
                        options={uniqueStores.map(store => ({ label: store, value: store }))}
                        selectedValues={new Set(storeFilter)}
                        onSelectionChange={handleStoreFilterChange}
                    />
                    <Button onClick={handleExportPdf} variant="outline" disabled={isExporting}>
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileDown className="mr-2 h-4 w-4" />}
                        Exportar PDF
                    </Button>
                </CardContent>
            </Card>
            <div className="pdf-section-efficiency-stats grid grid-cols-1 md:grid-cols-4 gap-8">
                <StatCard
                    title="Eficiencia Histórica de Despacho"
                    subtitle="De todos los despachos en el rango, % que salió a tiempo (lógica estricta por hora)."
                    value={`${historicalOnTimeRate.toFixed(1)}%`}
                    icon={<ShieldCheck />}
                    color={getComplianceColor(historicalOnTimeRate)}
                />
                 <StatCard 
                    title="Promedio Días Despacho" 
                    value={`${overallAverageDispatchDays.toFixed(1)} días`} 
                    icon={<Timer />}
                    subtitle="Tiempo hábil desde pedido a despacho (general)."
                />
                 <StatCard 
                    title="Tiempo Prom. de Resolución" 
                    value={`${overallAvgTimeToResolve.toFixed(1)} días`} 
                    icon={<TimerOff />}
                    subtitle="Promedio para resolver pedidos con atraso."
                />
                <StatCard
                    title="Tiempo Prom. Gestión (Bitrix)"
                    value={`${avgBitrixToDispatchDays.toFixed(1)} días`}
                    icon={<BarChart2 />}
                    subtitle="Tiempo hábil desde tarea en CRM a despacho."
                />
            </div>
             <div className="pdf-section-time-to-resolve">
                <Card>
                    <CardHeader>
                        <CardTitle>Tiempo Promedio de Resolución por Tienda</CardTitle>
                        <CardDescription>Días hábiles promedio que tardan los pedidos con atraso en resolverse (sea por tarea en CRM o por despacho).</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Pedidos Medidos</TableHead><TableHead className="text-right">% con Tarea CRM</TableHead><TableHead className="text-right">Tiempo Promedio (días)</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {avgTimeToResolveByStore.length > 0 ? (
                                    avgTimeToResolveByStore.map(store => (
                                        <TableRow key={store.name}><TableCell>{store.name}</TableCell><TableCell className="text-right">{store.count}</TableCell><TableCell className="text-right">{store.withCrmPercentage.toFixed(1)}%</TableCell><TableCell className="text-right font-semibold">{store.averageDays.toFixed(1)}</TableCell></TableRow>
                                    ))
                                ) : ( <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-24">No hay datos de resolución para el período seleccionado.</TableCell></TableRow> )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
            <div className="pdf-section-dispatch-ranges-by-week">
                <Card>
                    <CardHeader>
                        <CardTitle>Resumen Semanal de Tiempos de Despacho</CardTitle>
                        <CardDescription>
                            Evolución semanal de la velocidad de despacho para el período seleccionado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Semana</TableHead>
                                    <TableHead className="text-right">Total Despachos</TableHead>
                                    <TableHead className="text-right">Promedio Días</TableHead>
                                    <TableHead className="text-right">0-1 Días</TableHead>
                                    <TableHead className="text-right">1-2 Días</TableHead>
                                    <TableHead className="text-right">2-3 Días</TableHead>
                                    <TableHead className="text-right">&gt;3 Días</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {dispatchTimeRangesByWeek.map(row => (
                                    <TableRow key={row.weekKey}>
                                        <TableCell className="font-medium">{row.weekLabel}</TableCell>
                                        <TableCell className="text-right font-bold">{row.total.toLocaleString()}</TableCell>
                                        <TableCell className="text-right font-bold">{row.averageDispatchDays.toFixed(1)}</TableCell>
                                        <TableCell className="text-right">{row['0-1 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['0-1 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['1-2 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['1-2 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['2-3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['2-3 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['>3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['>3 Días %'].toFixed(1)}%)</span></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
             <div className="pdf-section-efficiency-charts grid grid-cols-1 gap-8">
              <Card>
                  <CardHeader><CardTitle>Eficiencia de Despacho por Día</CardTitle><CardDescription>Porcentaje de despachos puntuales basado en el día en que se realizó el envío.</CardDescription></CardHeader>
                  <CardContent className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={effectivenessByDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="Efectividad" stroke="hsl(var(--chart-1))" strokeWidth={2} ><LabelList dataKey="Efectividad" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} /></Line></LineChart>
                      </ResponsiveContainer>
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader><CardTitle>Eficiencia de Despacho por Mes</CardTitle><CardDescription>Porcentaje de despachos puntuales por mes.</CardDescription></CardHeader>
                  <CardContent className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={effectivenessByMonth}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="Efectividad Mensual" stroke="hsl(var(--chart-2))" strokeWidth={2} ><LabelList dataKey="Efectividad Mensual" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} /></Line></LineChart>
                      </ResponsiveContainer>
                  </CardContent>
              </Card>
            </div>
            <div className="pdf-section-dispatch-ranges">
                <Card>
                    <CardHeader><CardTitle>Rangos de Tiempo de Despacho por Tienda</CardTitle><CardDescription>Distribución de los despachos por tienda según el tiempo hábil que tardaron desde el pedido.</CardDescription></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Total Despachos</TableHead><TableHead className="text-right">Promedio Días Despacho</TableHead><TableHead className="text-right">0-1 Días</TableHead><TableHead className="text-right">1-2 Días</TableHead><TableHead className="text-right">2-3 Días</TableHead><TableHead className="text-right">&gt;3 Días</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {dispatchTimeRangesByStore.map(row => (
                                    <TableRow key={row.store}><TableCell className="font-medium">{row.store}</TableCell><TableCell className="text-right font-bold">{row.total.toLocaleString()}</TableCell><TableCell className="text-right font-bold">{row.averageDispatchDays.toFixed(1)}</TableCell><TableCell className="text-right">{row['0-1 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['0-1 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['1-2 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['1-2 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['2-3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['2-3 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['>3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['>3 Días %'].toFixed(1)}%)</span></TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
              <div className="pdf-section-store-dispatch-efficiency">
                <Card>
                    <CardHeader><CardTitle>Eficiencia Histórica de Despacho por Tienda</CardTitle><CardDescription>Analiza únicamente los pedidos despachados para calcular el % que salió a tiempo (lógica estricta por hora).</CardDescription></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Total Despachado</TableHead><TableHead className="text-right">A Tiempo</TableHead><TableHead className="text-right">Eficiencia</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {storeDispatchPerformance.map(store => (<TableRow key={store.tienda}><TableCell>{store.tienda}</TableCell><TableCell className="text-right">{store.totalDispatched}</TableCell><TableCell className="text-right text-green-600 font-semibold">{store.onTime}</TableCell><TableCell className={cn("text-right font-bold text-lg", getComplianceColor(store.efficiency))}>{store.efficiency.toFixed(1)}%</TableCell></TableRow>))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
              </div>
        </div>
    );
};


interface DashboardsModuleProps {
  onReturnToSuite: () => void;
}

export const DashboardsModule: React.FC<DashboardsModuleProps> = ({ onReturnToSuite }) => {
  const [holidays, setHolidays] = useState<Date[]>([]);
  const { role } = useAuth();
  
  const [allOrders, setAllOrders] = useState<EcommerceOrder[]>([]);
  const [delayedLogs, setDelayedLogs] = useState<DelayedOrderLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  
  // State for global filters
  const [globalDateRange, setGlobalDateRange] = useState<DateRange | undefined>();
  const [globalStoreFilter, setGlobalStoreFilter] = useState<string[]>([]);
  const [isFullHistoryLoaded, setIsFullHistoryLoaded] = useState(false);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    const [ordersResult, logsResult, holidaysResult] = await Promise.all([
      loadEcommerceOrders(isFullHistoryLoaded),
      getDelayedOrderLogs(),
      loadHolidays()
    ]);

    if (ordersResult.success && ordersResult.data) {
      const filteredOrders = ordersResult.data.filter(o => (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');
      setAllOrders(filteredOrders);
    } else {
      toast({ variant: "destructive", title: "Error", description: ordersResult.error || "No se pudieron cargar los datos de despacho." });
    }
    
    if (logsResult.success && logsResult.data) {
        setDelayedLogs(logsResult.data);
    } else {
        toast({ variant: 'destructive', title: 'Error al refrescar justificaciones', description: logsResult.error });
    }

    if (holidaysResult.success && holidaysResult.data) {
        setHolidays(holidaysResult.data);
    }

    setIsLoading(false);
  }, [toast, isFullHistoryLoaded]);
  
  useEffect(() => {
    // We only load holidays on mount. Orders/Logs are now manual via "Generar Análisis"
    // to save Firebase reads as requested by user.
    const loadInitialMeta = async () => {
        const holidaysResult = await loadHolidays();
        if (holidaysResult.success && holidaysResult.data) {
            setHolidays(holidaysResult.data);
        }
    };
    loadInitialMeta();
  }, []);
  
  const handleHolidaysChange = useCallback(async (dates: Date[] | undefined) => {
    const safeDates = dates || [];
    setHolidays(safeDates);
    await saveHolidays(safeDates);
  }, []);

  return (
    <div className="space-y-8">
        <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-4">
                <Button variant="outline" onClick={onReturnToSuite} size="sm" className="bg-white dark:bg-slate-950">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                </Button>
                <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Consola de Control Ecommerce</h1>
                    <p className="text-xs text-muted-foreground font-medium">Gestión operativa y análisis de cumplimiento</p>
                </div>
            </div>
            <div className="flex items-center gap-3 bg-white dark:bg-slate-950 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-inner">
                <div className={cn("p-1.5 rounded-md", isFullHistoryLoaded ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600")}>
                    <Database className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground leading-none mb-1">Modo de Carga</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {isFullHistoryLoaded ? 'Historial Completo' : 'Últimos 60 días'}
                    </span>
                </div>
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-2" />
                <Button 
                    variant={isFullHistoryLoaded ? "secondary" : "default"}
                    size="sm" 
                    className="h-9 px-3 text-xs font-bold"
                    onClick={() => setIsFullHistoryLoaded(!isFullHistoryLoaded)}
                >
                    {isFullHistoryLoaded ? 'Cambiar a Recientes' : 'Cargar Todo'}
                </Button>
            </div>
        </div>

         <Tabs defaultValue="ecommerce" className="w-full">
            <TabsList className="grid w-full grid-cols-3 print-hide">
                <TabsTrigger value="ecommerce">Análisis de Pedidos Ecommerce</TabsTrigger>
                <TabsTrigger value="efficiency">Análisis de Eficiencia</TabsTrigger>
                <TabsTrigger value="daily_dispatch">Dashboard de Despachos</TabsTrigger>
            </TabsList>
             <TabsContent value="ecommerce" className="mt-4">
                <EcommerceDashboard 
                    onReturn={onReturnToSuite} 
                    holidays={holidays} 
                    onHolidaysChange={handleHolidaysChange}
                    orders={allOrders}
                    logs={delayedLogs}
                    isLoading={isLoading}
                    onRefresh={fetchAllData}
                    dateRange={globalDateRange}
                    onDateRangeChange={setGlobalDateRange}
                    storeFilter={globalStoreFilter}
                    onStoreFilterChange={setGlobalStoreFilter}
                />
             </TabsContent>
            <TabsContent value="efficiency" className="mt-4">
                 <EfficiencyDashboard 
                    orders={allOrders}
                    logs={delayedLogs}
                    holidays={holidays}
                    dateRange={globalDateRange}
                    onDateRangeChange={setGlobalDateRange}
                    storeFilter={globalStoreFilter}
                    onStoreFilterChange={setGlobalStoreFilter}
                />
             </TabsContent>
             <TabsContent value="daily_dispatch" className="mt-4">
                <DailyDispatchDashboard 
                    onReturn={onReturnToSuite} 
                    holidays={holidays} 
                    allOrders={allOrders}
                    isLoading={isLoading}
                    onRefresh={fetchAllData}
                />
             </TabsContent>
         </Tabs>
    </div>
  )
};

    
