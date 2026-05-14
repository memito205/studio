"use client";

import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileUp, 
  Truck, 
  ShoppingCart, 
  Table as TableIcon, 
  Download, 
  Plus, 
  Calculator, 
  AlertCircle,
  ArrowRightLeft,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import { 
    saveExternalServiceRows, 
    getExternalServiceRows, 
    updateExternalServiceRow, 
    saveServiceRates, 
    getServiceRates 
} from '@/app/actions';
import { ExternalServiceRow, ServiceRate } from '@/types';

interface WeeklyBatch {
  /** Clave estable para UI (semana+proveedor o grupo manual+proveedor). */
  batchKey: string;
  weekKey: string;
  weekRange: string;
  provider: string;
  /** Si no es null, el lote fue armado manualmente en logística (varios días). */
  manualGroupId: string | null;
  totalValue: number;
  rows: ExternalServiceRow[];
  serviceBreakdown: { 
    [service: string]: { 
      total: number; 
      totalQty: number;
      stores: { [store: string]: number };
      storesQty: { [store: string]: number };
      rate?: number;
      method?: ExternalServiceRow['metodoPago'] | 'Mixto';
    } 
  };
  ocNumber?: string;
  invoiceNumber?: string;
  invoiceValue?: number;
}

export const ServiceConciliation: React.FC<{ onReturn: () => void }> = ({ onReturn }) => {
  const [data, setData] = useState<ExternalServiceRow[]>([]);
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [activeTab, setActiveTab] = useState<'logistica' | 'compras' | 'contabilidad'>('logistica');
  const [filterProvider, setFilterProvider] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedBatches, setExpandedBatches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeElementId, setActiveElementId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { role, loading: authLoading } = useAuth();
  const isOffice = role === 'office';

  useEffect(() => {
    if (authLoading) return;
    if (isOffice && activeTab === 'logistica') setActiveTab('compras');
  }, [authLoading, isOffice, activeTab]);

  // Load data on mount
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      const [rowsRes, ratesRes] = await Promise.all([
        getExternalServiceRows(),
        getServiceRates()
      ]);
      
      if (rowsRes.success && rowsRes.data) setData(rowsRes.data);
      if (ratesRes.success && ratesRes.data) setRates(ratesRes.data);
      setIsLoading(false);
    };
    loadInitialData();
  }, []);
  
  // Helpers
  const normalize = (str: string) => {
    if (!str) return '';
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' '); // Normalize internal spaces
  };

  const cleanNumber = (val: any): number => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    let s = String(val).trim();
    if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',') && !s.includes('.')) {
      if (s.indexOf(',') >= s.length - 3) s = s.replace(',', '.');
      else s = s.replace(',', '');
    }
    const cleaned = s.replace(/[^\d.-]/g, "");
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const calculateValor = (provider: string, service: string, qty: number) => {
    if (!provider || !service) return 0;
    const pNormal = normalize(provider);
    const sNormal = normalize(service);
    const match = rates.find(r => 
      normalize(r.provider) === pNormal && 
      normalize(r.service) === sNormal
    );
    if (!match) return 0;
    return Number((match.rate * qty).toFixed(2));
  };

  const getUnitRate = (provider: string, service: string) => {
    if (!provider || !service) return 0;
    const pNormal = normalize(provider);
    const sNormal = normalize(service);
    const match = rates.find(r => 
      normalize(r.provider) === pNormal && 
      normalize(r.service) === sNormal
    );
    return match ? match.rate : 0;
  };

  const getMethod = (provider: string, service: string) => {
    if (!provider || !service) return 'Unidad';
    const pNormal = normalize(provider);
    const sNormal = normalize(service);
    const match = rates.find(r => 
      normalize(r.provider) === pNormal && 
      normalize(r.service) === sNormal
    );
    return match ? (match.method || 'Unidad') : 'Unidad';
  };

  /** Maps tariff/UI strings (Und, Hr, etc.) and row.metodoPago to canonical billing method. */
  const normalizeBillingMethod = (
    raw: string | undefined | null
  ): ExternalServiceRow['metodoPago'] | null => {
    if (raw == null || raw === '') return null;
    const u = normalize(String(raw));
    if (u.includes('JORNADA') || u === 'DIA' || u.includes('DAY')) return 'Jornada';
    if (u.includes('HORA') || u === 'HR' || u === 'HRS' || u.includes('HOUR')) return 'Hora';
    if (u.includes('UNID') || u === 'UND' || u.includes('UNIT')) return 'Unidad';
    return null;
  };

  const resolveRowBillingMethod = (row: ExternalServiceRow): ExternalServiceRow['metodoPago'] => {
    return (
      normalizeBillingMethod(row.metodoPago as string) ??
      normalizeBillingMethod(getMethod(row.proveedor, row.servicio)) ??
      'Unidad'
    );
  };

  const toDateObject = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (value.seconds) {
      const d = new Date(value.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDateInputLocal = (value: any): string => {
    const d = toDateObject(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const parseDateInputLocal = (value: string): Date | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    // Use midday local time to avoid timezone/dst edge shifts.
    const parsed = new Date(y, m - 1, d, 12, 0, 0, 0);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const getWeekRange = (date: any) => {
    try {
      const d = date && date.seconds ? new Date(date.seconds * 1000) : new Date(date);
      const start = startOfWeek(d, { weekStartsOn: 1 });
      const end = endOfWeek(d, { weekStartsOn: 1 });
      return `${format(start, 'dd MMM')} - ${format(end, 'dd MMM')}`;
    } catch { return "Semana Indefinida"; }
  };

  const getWeekKey = (date: any) => {
    try {
      const d = date && date.seconds ? new Date(date.seconds * 1000) : new Date(date);
      const start = startOfWeek(d, { weekStartsOn: 1 });
      return format(start, 'yyyy-MM-dd');
    } catch { return "unknown"; }
  };

  const getRowTimeMs = (row: ExternalServiceRow): number => {
    const d = toDateObject(row.fechaServicio);
    return d ? d.getTime() : 0;
  };

  const rowMatchesBatch = (batch: WeeklyBatch, row: ExternalServiceRow): boolean => {
    if (batch.manualGroupId) {
      return (
        row.proveedor === batch.provider &&
        (row.grupoFacturacion?.trim() ?? '') === batch.manualGroupId
      );
    }
    if (row.grupoFacturacion?.trim()) return false;
    return getWeekKey(row.fechaServicio) === batch.weekKey && row.proveedor === batch.provider;
  };

  // Logistics View Data
  const logisticsData = useMemo(() => {
    let result = data.filter(row => row.estadoCadena === 'Logística' || row.estadoCadena === 'Devuelto');
    if (filterProvider) {
      result = result.filter(row => row.proveedor.toLowerCase().includes(filterProvider.toLowerCase()));
    }
    result.sort((a, b) => {
      const getMS = (d: any) => {
        if (!d) return 0;
        if (d.seconds) return d.seconds * 1000;
        const parsed = new Date(d).getTime();
        return isNaN(parsed) ? 0 : parsed;
      };
      const dateA = getMS(a.fechaServicio);
      const dateB = getMS(b.fechaServicio);
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return result;
  }, [data, filterProvider, sortOrder]);

  const providerSuggestions = useMemo(() => {
    const fromRates = rates.map(r => r.provider.trim());
    const defaults = ["EMPAQUES Y SOLUCIONES", "IMPECABLE", "MAQUILOGIS"];
    return Array.from(new Set([...fromRates, ...defaults])).sort();
  }, [rates]);

  const getServiceSuggestions = (provider: string) => {
    if (!provider) return [];
    const pNormal = normalize(provider);
    const fromRates = rates
        .filter(r => normalize(r.provider) === pNormal)
        .map(r => r.service.trim());
    
    const defaults: Record<string, string[]> = {
      "EMPAQUES Y SOLUCIONES": ["ETIQUETADO", "TALLADO", "SERVICIOS BODEGA"],
      "IMPECABLE": ["ETIQUETADO", "TALLADO"],
      "MAQUILOGIS": ["ETIQUETADO", "TALLADO"]
    };
    
    const foundKey = Object.keys(defaults).find(k => normalize(k) === pNormal);
    const matchedDefaults = foundKey ? defaults[foundKey] : [];
    
    return Array.from(new Set([...fromRates, ...matchedDefaults])).sort();
  };

  const weeklyBatches = useMemo(() => {
    const batches: { [key: string]: WeeklyBatch } = {};
    
    data.forEach(row => {
      const manual = row.grupoFacturacion?.trim();
      const wKey = getWeekKey(row.fechaServicio);
      const compositeKey = manual
        ? `grp_${manual}_${row.proveedor}`
        : `${wKey}_${row.proveedor}`;
      
      if (!batches[compositeKey]) {
        batches[compositeKey] = {
          batchKey: compositeKey,
          manualGroupId: manual || null,
          weekKey: wKey,
          weekRange: manual ? '' : getWeekRange(row.fechaServicio),
          provider: row.proveedor,
          totalValue: 0,
          rows: [],
          serviceBreakdown: {},
          ocNumber: '',
          invoiceNumber: '',
          invoiceValue: 0
        };
      }
      
      const b = batches[compositeKey];
      const serviceName = (row.servicio || 'SERVICIO SIN NOMBRE').toUpperCase();
      const rowValue = Number(row.valorACobrar || 0);

      const rowMethod = resolveRowBillingMethod(row);

      if (!b.serviceBreakdown[serviceName]) {
        b.serviceBreakdown[serviceName] = { 
          total: 0, 
          totalQty: 0, 
          stores: {}, 
          storesQty: {},
          rate: getUnitRate(row.proveedor, row.servicio),
          method: rowMethod,
        };
      } else {
        const curMethod = b.serviceBreakdown[serviceName].method;
        if (curMethod && curMethod !== 'Mixto' && rowMethod !== curMethod) {
          b.serviceBreakdown[serviceName].method = 'Mixto';
        }
      }

      const rowQty = Number(row.cantidad || 0);

      b.totalValue += rowValue;
      b.rows.push(row);
      b.serviceBreakdown[serviceName].total += rowValue;
      b.serviceBreakdown[serviceName].totalQty += rowQty;
      
      const destRaw = row.destino || 'SIN DESTINO';
      const destUpper = destRaw.toUpperCase();

      if (destUpper.includes('PVDH') || destUpper.includes('TODOS LOS')) {
        const specialStores = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B22', 'B23', 'MOLINOS', 'PIONEROS', 'BODVI'];
        const splitValue = rowValue / specialStores.length;
        const splitQty = rowQty / specialStores.length;
        specialStores.forEach(store => {
          b.serviceBreakdown[serviceName].stores[store] = (b.serviceBreakdown[serviceName].stores[store] || 0) + splitValue;
          b.serviceBreakdown[serviceName].storesQty[store] = (b.serviceBreakdown[serviceName].storesQty[store] || 0) + splitQty;
        });
      } else {
        b.serviceBreakdown[serviceName].stores[destRaw] = (b.serviceBreakdown[serviceName].stores[destRaw] || 0) + rowValue;
        b.serviceBreakdown[serviceName].storesQty[destRaw] = (b.serviceBreakdown[serviceName].storesQty[destRaw] || 0) + rowQty;
      }
      
      if (row.numeroOC) b.ocNumber = row.numeroOC;
      if (row.numeroFactura) b.invoiceNumber = row.numeroFactura;
      // Batch invoice is one value replicated across rows — never sum (would multiply by row count or concatenate strings).
      const vf = cleanNumber(row.valorFactura);
      if (!isNaN(vf) && vf !== 0) {
        b.invoiceValue = Math.max(b.invoiceValue || 0, vf);
      }
    });
    
    let result = Object.values(batches);
    result.forEach(b => {
      if (b.manualGroupId && b.rows.length) {
        const times = b.rows.map(r => getRowTimeMs(r)).filter(t => t > 0);
        if (times.length) {
          const dMin = new Date(Math.min(...times));
          const dMax = new Date(Math.max(...times));
          b.weekRange = `${format(dMin, 'dd MMM')} - ${format(dMax, 'dd MMM yyyy')} · ${b.rows.length} operaciones`;
          b.weekKey = format(dMin, 'yyyy-MM-dd');
        } else {
          b.weekRange = `Grupo manual · ${b.rows.length} operaciones`;
        }
      }
    });
    if (filterProvider) {
      result = result.filter(b => b.provider.toLowerCase().includes(filterProvider.toLowerCase()));
    }
    return result.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  }, [data, filterProvider, rates]);

  const updateRowField = async (id: string, field: keyof ExternalServiceRow, value: any) => {
    const oldRow = data.find(row => row.id === id);
    if (!oldRow) return;

    let updated = { ...oldRow, [field]: value };

    if (field === 'proveedor' && oldRow.grupoFacturacion?.trim()) {
      updated.grupoFacturacion = '';
    }
    
    // Auto-calculate depending on field changes
    if (field === 'proveedor' || field === 'servicio' || field === 'cantidad') {
      const prov = field === 'proveedor' ? value : oldRow.proveedor;
      const serv = field === 'servicio' ? value : oldRow.servicio;
      const qty = field === 'cantidad' ? cleanNumber(value) : oldRow.cantidad;
      const newVal = calculateValor(prov, serv, qty);
      if (newVal > 0) {
        updated.valorACobrar = newVal;
        const rawTariffMethod = getMethod(prov, serv);
        updated.metodoPago =
          (normalizeBillingMethod(rawTariffMethod) ?? 'Unidad') as ExternalServiceRow['metodoPago'];
      }
    }

    if (field === 'valorACobrar' || field === 'valorFactura') {
      if (field === 'valorACobrar') updated.valorACobrar = cleanNumber(value);
      if (field === 'valorFactura') updated.valorFactura = cleanNumber(value);
      const cobrar =
        field === 'valorACobrar' ? cleanNumber(value) : Number(oldRow.valorACobrar || 0);
      const factura =
        field === 'valorFactura' ? cleanNumber(value) : cleanNumber(oldRow.valorFactura);
      updated.diferencia = cobrar - factura;
    }

    // Update local state immediately
    setData(prev => prev.map(row => row.id === id ? updated : row));

    // Restore focus if needed after state update
    if (activeElementId) {
        setTimeout(() => {
            const el = document.getElementById(activeElementId);
            if (el) el.focus();
        }, 0);
    }

    // Send the explicit updates to the server
    const res = await updateExternalServiceRow(id, updated);
    if (!res.success) {
        toast({ variant: 'destructive', title: 'Error guardando celda', description: res.error || 'Error de base de datos' });
    }
  };

  const updateBatchField = async (batch: WeeklyBatch, field: keyof ExternalServiceRow, value: any) => {
    const coercedValue = field === 'valorFactura' ? cleanNumber(value) : value;

    const updatesList: { id: string, data: ExternalServiceRow }[] = [];

    setData(prev => prev.map(row => {
      if (rowMatchesBatch(batch, row)) {
        const updated = { ...row, [field]: coercedValue };
        
        if (field === 'valorFactura') {
            const cobrar = Number(updated.valorACobrar || 0);
            const factura = cleanNumber(coercedValue);
            updated.valorFactura = factura;
            updated.diferencia = cobrar - factura;
        }

        updatesList.push({ id: row.id, data: updated });
        return updated;
      }
      return row;
    }));

    await Promise.all(updatesList.map(u => updateExternalServiceRow(u.id, u.data)));
  };

  const applyBillingGroupToSelected = async () => {
    const ids = Array.from(selectedIds);
    const rows = logisticsData.filter(r => ids.includes(r.id));
    if (rows.length < 2) {
      toast({
        variant: 'destructive',
        title: 'Selección insuficiente',
        description: 'Seleccione al menos dos filas para armar un lote de facturación.',
      });
      return;
    }
    const providers = new Set(rows.map(r => normalize(r.proveedor)));
    if (providers.size !== 1) {
      toast({
        variant: 'destructive',
        title: 'Proveedor distinto',
        description: 'Solo se pueden agrupar operaciones del mismo proveedor.',
      });
      return;
    }
    const provider = rows[0].proveedor;
    if (!provider.trim()) {
      toast({
        variant: 'destructive',
        title: 'Proveedor requerido',
        description: 'Complete el proveedor en las filas seleccionadas antes de agrupar.',
      });
      return;
    }
    const groupId = `fact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setIsSaving(true);
    const errors: string[] = [];
    for (const r of rows) {
      const res = await updateExternalServiceRow(r.id, { grupoFacturacion: groupId });
      if (!res.success) errors.push(res.error || r.id);
    }
    setData(prev =>
      prev.map(row => (ids.includes(row.id) ? { ...row, grupoFacturacion: groupId } : row)),
    );
    setIsSaving(false);
    setSelectedIds(new Set());
    if (errors.length) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: errors[0] });
    } else {
      toast({
        title: 'Lote agrupado',
        description: 'Compras y contabilidad verán un solo bloque para este proveedor con las fechas seleccionadas.',
      });
    }
  };

  const clearBillingGroupFromSelected = async () => {
    const ids = Array.from(selectedIds);
    const rows = logisticsData.filter(r => ids.includes(r.id) && r.grupoFacturacion?.trim());
    if (rows.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Sin grupo',
        description: 'Las filas seleccionadas no tienen agrupación manual de facturación.',
      });
      return;
    }
    setIsSaving(true);
    const errors: string[] = [];
    for (const r of rows) {
      const res = await updateExternalServiceRow(r.id, { grupoFacturacion: '' });
      if (!res.success) errors.push(res.error || r.id);
    }
    const clearIds = new Set(rows.map(r => r.id));
    setData(prev =>
      prev.map(row =>
        clearIds.has(row.id) ? { ...row, grupoFacturacion: '' } : row,
      ),
    );
    setIsSaving(false);
    setSelectedIds(new Set());
    if (errors.length) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: errors[0] });
    } else {
      toast({ title: 'Agrupación quitada', description: 'Esas operaciones vuelven a consolidarse solo por semana calendario.' });
    }
  };

  const handleRatesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const dataArr = event.target?.result;
        const wb = XLSX.read(dataArr, { type: 'binary' });
        const sheetName = wb.SheetNames.find(n => n.toUpperCase().includes('TARIFA') || n.toUpperCase().includes('PRECIO')) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const raw = XLSX.utils.sheet_to_json<any>(ws);
        
        const rowKeys = Object.keys(raw[0] || {});
        const findKey = (options: string[]) => {
          const normalizedOptions = options.map(opt => normalize(opt));
          return rowKeys.find(rk => normalizedOptions.includes(normalize(rk)));
        };

        const keys = {
          provider: findKey(['PROVEEDOR', 'EMPRESA']),
          service: findKey(['SERVICIO', 'ACTIVIDAD']),
          rate: findKey(['TARIFA', 'VALOR', 'PRECIO']),
          method: findKey(['METODO', 'UND', 'UNIDAD'])
        };

        const cleaned = raw.map(r => ({
          provider: String(keys.provider ? r[keys.provider] : ""),
          service: String(keys.service ? r[keys.service] : ""),
          rate: cleanNumber(keys.rate ? r[keys.rate] : 0),
          method: String(keys.method ? r[keys.method] : "Unidad")
        })).filter(r => r.provider && r.service && r.rate > 0);

        if (cleaned.length === 0) throw new Error("No se detectaron columnas válidas");

        setIsSaving(true);
        const res = await saveServiceRates(cleaned);
        setIsSaving(false);

        if (res.success) {
            setRates(cleaned);
            toast({ title: "Tarifario Cargado", description: `Se guardaron ${cleaned.length} tarifas.` });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
      } catch (err: any) { 
        toast({ variant: "destructive", title: "Error", description: err.message });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const dataArr = event.target?.result;
        const wb = XLSX.read(dataArr, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
        const rowKeys = Object.keys(rawData[0] || {});
        
        const findKey = (options: string[]) => {
          const normalizedOptions = options.map(opt => normalize(opt));
          return rowKeys.find(rk => normalizedOptions.includes(normalize(rk)));
        };

        const keys = {
          provider: findKey(['PROVEEDOR', 'EMPRESA']),
          service: findKey(['SERVICIO', 'ACTIVIDAD']),
          qty: findKey(['CANTIDAD', 'CANT']),
          valor: findKey(['VALOR A COBRAR', 'VALOR']),
          fecha: findKey(['FECHA', 'DATE']),
          destino: findKey(['DESTINO', 'DEPENDENCIA'])
        };

        const cleanedData: ExternalServiceRow[] = rawData.map((row, index) => {
          const provider = String(keys.provider ? row[keys.provider] : "");
          const service = String(keys.service ? row[keys.service] : "");
          const qty = cleanNumber(keys.qty ? row[keys.qty] : 1) || 1;
          const fechaRaw = keys.fecha ? row[keys.fecha] : null;
          const fecha = (fechaRaw instanceof Date) ? fechaRaw : new Date();
          const destino = String(keys.destino ? row[keys.destino] : "");
          
          let valor = cleanNumber(keys.valor ? row[keys.valor] : 0);
          let method = 'Unidad';
          
          const lookupVal = calculateValor(provider, service, qty);
          if (lookupVal > 0) {
            valor = lookupVal;
            method = getMethod(provider, service);
          }

          // Generate duplicate hash
          const hashString = `${format(fecha, 'yyyy-MM-dd')}_${normalize(provider)}_${normalize(service)}_${normalize(destino)}_${qty}_${valor}`;
          const hash = hashString.replace(/\s+/g, '');

          return {
            id: `temp-${index}-${Date.now()}`,
            fechaServicio: fecha,
            proveedor: provider,
            cantidad: qty,
            servicio: service,
            destino: destino,
            valorACobrar: valor,
            metodoPago: method as any,
            estadoCadena: 'Logística',
            duplicateHash: hash,
            createdAt: new Date()
          };
        });

        setIsSaving(true);
        const res = await saveExternalServiceRows(cleanedData);
        setIsSaving(false);

        if (res.success) {
            const refreshRes = await getExternalServiceRows();
            if (refreshRes.success && refreshRes.data) setData(refreshRes.data);
            toast({ 
                title: "Carga Finalizada", 
                description: `Subidos: ${res.data?.uploaded}. Omitidos (duplicados): ${res.data?.skipped}.` 
            });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
      } catch (err: any) { 
        toast({ variant: "destructive", title: "Error", description: "Error al procesar archivo." });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBatchExport = (batch: WeeklyBatch) => {
    const exportData: any[] = [];
    
    Object.entries(batch.serviceBreakdown).forEach(([service, stats]) => {
      // First, add a "Total" row for this service for quick reference
      exportData.push({
        "Proveedor": batch.provider,
        "Semana": batch.weekRange,
        "Servicio": service,
        "Destino/Tienda": "--- TOTAL SERVICIO ---",
        "Cant. Unitaria": stats.totalQty,
        "Metodo": stats.method,
        "Tarifa": stats.rate,
        "Subtotal": stats.total
      });

      // Then, add one row per store
      Object.entries(stats.stores).sort((a,b) => a[0].localeCompare(b[0])).forEach(([store, value]) => {
        const storeQty = stats.storesQty[store] || 0;
        exportData.push({
          "Proveedor": batch.provider,
          "Semana": batch.weekRange,
          "Servicio": service,
          "Destino/Tienda": store,
          "Cant. Unitaria": storeQty,
          "Metodo": stats.method,
          "Tarifa": stats.rate,
          "Subtotal": value
        });
      });

      // Add a spacer row for readability
      exportData.push({});
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen_Compra");
    
    const fileName = `Resumen_Compra_${batch.provider}_${batch.batchKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const allVisibleSelected =
    logisticsData.length > 0 && logisticsData.every(r => selectedIds.has(r.id));

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(logisticsData.map(r => r.id)));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mb-4" />
        <p className="text-slate-600 font-medium">Cargando Conciliación de Servicios...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onReturn} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
                <ChevronRight size={24} className="rotate-180" />
            </button>
            <div className="bg-indigo-600 p-2 rounded-lg text-white"><ArrowRightLeft size={24} /></div>
            <h1 className="text-xl font-bold tracking-tight text-indigo-950 italic">Conciliación Servicios <span className="text-slate-400 font-normal">v3.0</span></h1>
          </div>
          <div className="flex gap-3">
            {isSaving && <Loader2 className="animate-spin text-indigo-600 mt-2 mr-2" size={20} />}
            <label className={cn(
              "cursor-pointer px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all border",
              rates.length > 0 ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
            )}>
              <Calculator size={14} />
              {rates.length > 0 ? `${rates.length} Tarifas` : "Subir Tarifario"}
              <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleRatesUpload} />
            </label>
            <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-all active:scale-95">
              <FileUp size={16} /> Cargar Excel Servicios
              <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row mb-10 gap-6 justify-between items-end">
          <nav className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 shrink-0">
            {[
              { id: 'logistica', label: '1. Logística', icon: Truck, color: 'text-blue-600', activeBg: 'bg-blue-50' },
              { id: 'compras', label: '2. Compras', icon: ShoppingCart, color: 'text-amber-600', activeBg: 'bg-amber-50' },
              { id: 'contabilidad', label: '3. Contabilidad', icon: Calculator, color: 'text-emerald-600', activeBg: 'bg-emerald-50' }
            ].filter(tab => !isOffice || tab.id !== 'logistica').map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all",
                  activeTab === tab.id ? `${tab.activeBg} ${tab.color} shadow-sm border border-slate-100` : "text-slate-400 hover:text-slate-600"
                )}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex gap-4 items-center bg-white p-3 rounded-2xl shadow-sm border border-slate-200 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input 
                placeholder="Filtrar proveedor..."
                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 w-full"
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
              />
            </div>
            <select className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-600 outline-none" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as any)}>
              <option value="desc">↓ Más Recientes</option>
              <option value="asc">↑ Más Antiguos</option>
            </select>
          </div>
        </div>

        {!data.length ? (
          <div className="text-center py-40 bg-white rounded-3xl border-2 border-dashed border-slate-200">
             <div className="bg-indigo-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-300"><TableIcon size={40} /></div>
             <h2 className="text-2xl font-bold text-slate-800">No hay registros cargados</h2>
             <p className="text-slate-500 mt-2">Carga un archivo Excel para iniciar la gestión.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeTab === 'logistica' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 bg-blue-50/90 border border-blue-200 rounded-2xl px-4 py-3 text-sm shadow-sm">
                  <Layers className="text-blue-700 w-5 h-5 shrink-0" aria-hidden />
                  <p className="text-slate-700 flex-1 min-w-[220px] leading-snug">
                    Marque varias operaciones del <span className="font-bold">mismo proveedor</span> (pueden ser días distintos) y agrúpelas para que Compras y Contabilidad las vean como un solo lote, alineado a cómo factura el proveedor.
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isSaving || selectedIds.size < 2}
                      onClick={() => void applyBillingGroupToSelected()}
                      className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                    >
                      Agrupar selección
                    </button>
                    <button
                      type="button"
                      disabled={isSaving || selectedIds.size === 0}
                      onClick={() => void clearBillingGroupFromSelected()}
                      className="px-4 py-2 rounded-xl bg-white border border-blue-300 text-blue-900 text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-100/50 transition-colors"
                    >
                      Quitar agrupación
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={() => setSelectedIds(new Set())}
                      className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-white/80 disabled:opacity-40"
                    >
                      Limpiar selección
                    </button>
                  </div>
                </div>
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-lg shadow-slate-100 overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-blue-600 text-white font-bold">
                    <tr>
                      <th className="px-2 py-4 w-11 text-center align-middle">
                        <input
                          type="checkbox"
                          className="rounded border-white/80 bg-white/20 accent-blue-600"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          aria-label="Seleccionar todas las filas visibles"
                        />
                      </th>
                      <th className="px-3 py-4 whitespace-nowrap">Lote</th>
                      <th className="px-6 py-4 whitespace-nowrap">Fecha</th>
                      <th className="px-6 py-4 whitespace-nowrap">Proveedor</th>
                      <th className="px-6 py-4 whitespace-nowrap">Servicio</th>
                      <th className="px-6 py-4 whitespace-nowrap">Destino</th>
                      <th className="px-6 py-4 whitespace-nowrap">Cant. / Método</th>
                      <th className="px-6 py-4 whitespace-nowrap">Valor Reportado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logisticsData.map(row => (
                      <tr
                        key={row.id}
                        className={cn(
                          'hover:bg-blue-50/10',
                          row.estadoCadena === 'Devuelto' && 'bg-red-50',
                          row.grupoFacturacion?.trim() && 'bg-violet-50/50',
                        )}
                      >
                        <td className="px-2 py-4 align-middle text-center">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 accent-blue-600"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleSelectRow(row.id)}
                            aria-label={`Seleccionar fila ${row.id}`}
                          />
                        </td>
                        <td className="px-3 py-4 align-middle">
                          {row.grupoFacturacion?.trim() ? (
                            <span className="inline-block text-[10px] font-black uppercase tracking-tight bg-violet-200 text-violet-900 px-2 py-1 rounded-lg max-w-[7rem] truncate" title={row.grupoFacturacion}>
                              Manual
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-semibold">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="date"
                            className="bg-transparent border border-slate-200 rounded px-1 py-1 text-xs font-bold"
                            value={formatDateInputLocal(row.fechaServicio)}
                            onChange={(e) => {
                              const parsedDate = parseDateInputLocal(e.target.value);
                              if (!parsedDate) {
                                toast({
                                  variant: 'destructive',
                                  title: 'Fecha inválida',
                                  description: 'Seleccione una fecha válida para continuar.'
                                });
                                return;
                              }
                              updateRowField(row.id, 'fechaServicio', parsedDate);
                            }}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input 
                            id={`provider-${row.id}`}
                            list={`providers-${row.id}`}
                            className="bg-slate-100 border border-slate-200 rounded px-2 py-1.5 text-xs font-black uppercase outline-none focus:border-indigo-500 w-full"
                            value={row.proveedor || ''} 
                            onFocus={() => setActiveElementId(`provider-${row.id}`)}
                            onBlur={() => setActiveElementId(null)}
                            onChange={(e) => updateRowField(row.id, 'proveedor', e.target.value)}
                          />
                          <datalist id={`providers-${row.id}`}>{providerSuggestions.map(p => <option key={p} value={p} />)}</datalist>
                        </td>
                        <td className="px-6 py-4">
                          <input 
                            id={`service-${row.id}`}
                            list={`services-${row.id}`}
                            className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs font-medium outline-none focus:border-indigo-500 w-full"
                            value={row.servicio || ''} 
                            onFocus={() => setActiveElementId(`service-${row.id}`)}
                            onBlur={() => setActiveElementId(null)}
                            onChange={(e) => updateRowField(row.id, 'servicio', e.target.value)}
                          />
                          <datalist id={`services-${row.id}`}>{getServiceSuggestions(row.proveedor).map(s => <option key={s} value={s} />)}</datalist>
                        </td>
                        <td className="px-6 py-4">
                           <input 
                             id={`dest-${row.id}`}
                             className="bg-slate-100/50 border border-slate-200 rounded px-2 py-1 text-[10px] uppercase font-bold w-full" 
                             value={row.destino || ''} 
                             onFocus={() => setActiveElementId(`dest-${row.id}`)}
                             onBlur={() => setActiveElementId(null)}
                             onChange={(e) => updateRowField(row.id, 'destino', e.target.value)} 
                           />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2 items-center">
                            <input type="number" className="w-12 bg-slate-100 border border-slate-200 rounded px-1 py-0.5 text-xs font-bold" value={row.cantidad ?? 0} onChange={(e) => updateRowField(row.id, 'cantidad', e.target.value)} />
                            <select className="text-[10px] bg-slate-100 rounded px-1" value={row.metodoPago || 'Unidad'} onChange={(e) => updateRowField(row.id, 'metodoPago', e.target.value as any)}>
                                <option value="Unidad">Und</option><option value="Jornada">Día</option><option value="Hora">Hr</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-blue-700">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              $<input type="number" className="bg-transparent outline-none w-24" value={row.valorACobrar ?? 0} onChange={(e) => updateRowField(row.id, 'valorACobrar', e.target.value)} />
                              {getUnitRate(row.proveedor, row.servicio) > 0 && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </div>
            )}

            {activeTab === 'compras' && (
              <div className="flex flex-col gap-6">
                {weeklyBatches.map(batch => {
                  const bKey = batch.batchKey;
                  const isExpanded = expandedBatches.includes(bKey);
                  return (
                    <div key={bKey} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-md">
                          <div className="bg-amber-500 text-white px-8 py-5 flex justify-between items-center cursor-pointer" onClick={() => setExpandedBatches(prev => isExpanded ? prev.filter(k => k !== bKey) : [...prev, bKey])}>
                        <div className="flex items-center gap-6">
                           {isExpanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />}
                           <div>
                              <p className="text-[10px] font-black uppercase tracking-widest opacity-80">
                                {batch.manualGroupId ? 'Periodo (agrupado en logística)' : 'Semana'}: {batch.weekRange}
                              </p>
                              <h3 className="text-xl font-black uppercase tracking-tight mt-1">{batch.provider}</h3>
                           </div>
                        </div>
                        <div className="flex items-center gap-6">
                           <div className="text-right">
                              <p className="text-[10px] font-bold uppercase opacity-75">{batch.manualGroupId ? 'Total lote' : 'Suma semanal'}</p>
                              <p className="text-2xl font-mono font-black">${batch.totalValue.toLocaleString()}</p>
                           </div>
                           <button 
                             onClick={(e) => { e.stopPropagation(); handleBatchExport(batch); }}
                             className="bg-white/20 hover:bg-white/30 p-3 rounded-xl transition-all shadow-sm active:scale-90"
                             title="Exportar Resumen por Tienda"
                           >
                              <Download size={20} />
                           </button>
                           <div className="bg-white/20 p-4 rounded-xl flex items-center gap-3" onClick={e => e.stopPropagation()}>
                              <ShoppingCart size={20} />
                              <input 
                                placeholder="ORDEN DE COMPRA #"
                                className="bg-white text-slate-800 rounded-lg px-4 py-2 text-xs font-black outline-none w-44 shadow-inner"
                                value={batch.ocNumber || ''}
                                onChange={(e) => updateBatchField(batch, 'numeroOC', e.target.value)}
                              />
                           </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-8 bg-slate-50/20">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {Object.entries(batch.serviceBreakdown).map(([service, stats]) => (
                                    <CardKeyMetric 
                                      key={service} 
                                      title={service} 
                                      value={stats.total} 
                                      quantity={stats.totalQty} 
                                      stores={stats.stores} 
                                      storesQty={stats.storesQty} 
                                      total={batch.totalValue}
                                      unitRate={stats.rate}
                                      method={stats.method}
                                    />
                                ))}
                            </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'contabilidad' && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl overflow-x-auto">
                 <table className="w-full text-sm text-left">
                    <thead className="bg-emerald-600 text-white font-bold">
                      <tr>
                        <th className="px-6 py-4 whitespace-nowrap">OC / Periodo</th>
                        <th className="px-6 py-4 whitespace-nowrap">Proveedor</th>
                        <th className="px-6 py-4 whitespace-nowrap">Total Consolidado</th>
                        <th className="px-6 py-4 whitespace-nowrap">Facturación</th>
                        <th className="px-6 py-4 whitespace-nowrap">Conciliación</th>
                        <th className="px-6 py-4 whitespace-nowrap">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {weeklyBatches.map(batch => {
                        const invNum = cleanNumber(batch.invoiceValue);
                        const totalNum = Number(batch.totalValue) || 0;
                        const diff = totalNum - invNum;
                        const diffFinite = Number.isFinite(diff);
                        return (
                          <tr key={batch.batchKey} className={cn("hover:bg-emerald-50/10", diffFinite && diff !== 0 && "bg-red-50/20")}>
                            <td className="px-6 py-5">
                                <div className="flex flex-col">
                                   <span className="bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-black w-fit uppercase">OC: {batch.ocNumber || "FALTA"}</span>
                                   <span className="text-[10px] font-bold text-slate-400 mt-1">{batch.weekRange}</span>
                                </div>
                            </td>
                            <td className="px-6 py-5 font-bold uppercase text-slate-700">{batch.provider}</td>
                            <td className="px-6 py-5 font-mono font-black text-emerald-800 text-lg">${batch.totalValue.toLocaleString()}</td>
                            <td className="px-6 py-5">
                                <div className="flex flex-col gap-2">
                                   <input placeholder="N° FACTURA" className="bg-white border-2 border-slate-100 rounded-lg px-2 py-1 text-[10px] font-black focus:border-emerald-500 outline-none w-full" value={batch.invoiceNumber || ''} onChange={(e) => updateBatchField(batch, 'numeroFactura', e.target.value)} />
                                   <input type="number" placeholder="VALOR FAC" className="bg-white border-2 border-slate-100 rounded-lg px-2 py-1 text-xs font-black focus:border-emerald-500 outline-none w-full" value={batch.invoiceValue === 0 || batch.invoiceValue === undefined ? '' : batch.invoiceValue} onChange={(e) => updateBatchField(batch, 'valorFactura', e.target.value)} />
                                </div>
                            </td>
                            <td className="px-6 py-5">
                               <div className={cn("px-4 py-3 rounded-2xl font-mono font-black text-center border-2", diffFinite && diff === 0 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : diffFinite ? "bg-red-50 text-red-600 border-red-200" : "bg-amber-50 text-amber-800 border-amber-100")}>
                                 {!diffFinite ? '—' : diff === 0 ? "CALZA OK" : `$${diff.toLocaleString()}`}
                               </div>
                            </td>
                            <td className="px-6 py-5">
                               <button onClick={async () => {
                                   const msg = prompt("Justificación para devolver este lote a Logística:");
                                   if(msg) {
                                       await updateBatchField(batch, 'estadoCadena', 'Devuelto');
                                       await updateBatchField(batch, 'observacion', msg);
                                       toast({ title: "Lote devuelto", description: "El reporte se ha enviado de vuelta a Logística." });
                                   }
                               }} className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl shadow-lg transition-all active:scale-90"><AlertCircle size={18} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                 </table>
              </div>
            )}
          </div>
        )}
      </main>

      <div className="fixed bottom-8 right-8 flex flex-col gap-4">
         {data.length > 0 && (
           <button onClick={() => {
                const ws = XLSX.utils.json_to_sheet(data.map(r => ({ ...r, fechaServicio: format(r.fechaServicio, 'yyyy-MM-dd') })));
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Consolidado_Final");
                XLSX.writeFile(wb, `Reporte_Conciliacion_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
            }} className="bg-emerald-600 text-white p-5 rounded-full shadow-2xl hover:scale-110 transition-all"><Download size={28} /></button>
         )}
         {!isOffice && (
         <button onClick={async () => {
             const newRow: ExternalServiceRow = {
                 id: "manual-" + Date.now(),
                 fechaServicio: new Date(),
                 proveedor: '',
                 servicio: '',
                 cantidad: 1,
                 valorACobrar: 0,
                 metodoPago: 'Unidad',
                 estadoCadena: 'Logística',
                 duplicateHash: "manual-" + Date.now(),
                 createdAt: new Date()
             };
             // This needs a server action to save immediately or handling locally until a batch save.
             // For simplicity, we'll just save it to get an ID.
             const res = await saveExternalServiceRows([newRow]);
             if (res.success) {
                const refresh = await getExternalServiceRows();
                if (refresh.success && refresh.data) setData(refresh.data);
                setActiveTab('logistica');
             }
         }} className="bg-indigo-600 text-white p-5 rounded-full shadow-2xl hover:scale-110 transition-all"><Plus size={28} /></button>
         )}
      </div>
    </div>
  );
};

const CardKeyMetric = ({ title, value, quantity, stores, storesQty, total, unitRate, method }: any) => {
    const qtySuffix =
      method === 'Unidad' ? 'unds' :
      method === 'Jornada' ? 'días' :
      method === 'Hora' ? 'hrs' :
      method === 'Mixto' ? 'mixto' :
      'uds/hrs/días';
    return (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex justify-between items-start mb-4">
            <h4 className="font-bold text-slate-800">{title}</h4>
            <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-1 rounded">{((value / total) * 100).toFixed(1)}%</span>
        </div>
        <div className="flex items-end gap-2 mb-2">
            <span className="text-2xl font-mono font-black text-slate-700">${value.toLocaleString()}</span>
            <span className="text-xs text-slate-400 mb-1">({quantity.toLocaleString()} {qtySuffix})</span>
        </div>
        {unitRate > 0 && (
          <div className="mb-6">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Valor Unitario: </span>
            <span className="text-xs font-mono font-bold text-blue-600">${unitRate.toLocaleString()}</span>
          </div>
        )}
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
            {Object.entries(stores).map(([store, val]: any) => (
                <div key={store} className="flex justify-between text-[10px] items-center border-b border-slate-50 pb-1">
                    <span className="text-slate-500 font-medium">{store}</span>
                    <span className="font-bold text-slate-700">${Number(val).toLocaleString()}</span>
                </div>
            ))}
        </div>
    </div>
    );
};
