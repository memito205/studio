

"use client";

import React, { useMemo, useEffect } from 'react';
import type { ProductivityGoals, BrandProductTypeGoals, ManualProductClassifications, ManualJustifications, ManualJustificationsUpdate, UniqueReference, ReferenceCorrections, ReportConfiguration, ManualOperatorMappings, IncidentLogEntry, JustificationType, Annotations, ProductDatabaseItem, DiscardedRecord, RemisionEntry, DeadTimeEntry, ReferenceGoals, OperationPulse } from '@/types';
import { FileDown, Upload, Share2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { GoalConfiguration } from './goal-configuration';
import { BrandProductTypeGoalConfiguration } from './brand-product-type-goal-configuration';
import { UnclassifiedProductEditor } from './unclassified-product-editor';
import { DeadTimeJustificationEditor } from './dead-time-justification-editor';
import { ManualJustificationsInspector } from './ManualJustificationsInspector';
import { ReferenceCorrectionEditor } from './reference-correction-editor';
import { NewOperatorMapper } from './new-operator-mapper';
import { IncidentLogEditor } from './incident-log-editor';
import { DiscardedRecordsViewer } from './discarded-records-viewer';
import { classifyProduct, extractBrandsFromReport, preScanForUnclassifiedProducts, extractUnmappedPackers, extractAllReferencesFromReport, extractImportedBrandCatalogItems, buildProductLookupMap } from '@/services/reportProcessor';
import { ReferenceGoalConfiguration } from './reference-goal-configuration';
import { ImportedBrandCatalogViewer } from './imported-brand-catalog-viewer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ConfigurationScreenProps {
  fileName: string;
  rawData: any[];
  productDB: ProductDatabaseItem[];
  goals: ProductivityGoals;
  onGoalsChange: (newGoals: ProductivityGoals) => void;
  onSuggestGoals: () => void;
  brandProductTypeGoals: BrandProductTypeGoals;
  onBrandProductTypeGoalsChange: (newGoals: BrandProductTypeGoals) => void;
  manualClassifications: ManualProductClassifications;
  onManualClassificationsChange: (newClassifications: ManualProductClassifications) => void;
  manualJustifications: ManualJustifications;
  onManualJustificationsChange: (update: ManualJustificationsUpdate) => void;
  uniqueReferences: UniqueReference[];
  referenceCorrections: ReferenceCorrections;
  onReferenceCorrectionsChange: (newCorrections: ReferenceCorrections) => void;
  manualOperatorMappings: ManualOperatorMappings;
  onManualOperatorMappingChange: (newMappings: ManualOperatorMappings) => void;
  incidentLog: IncidentLogEntry[];
  onIncidentLogChange: (log: IncidentLogEntry[]) => void;
  reportDate: string;
  onReportDateChange: (date: string) => void;
  reportStartTime: string;
  onReportStartTimeChange: (time: string) => void;
  reportEndTime: string;
  onReportEndTimeChange: (time: string) => void;
  initialPackers: string[];
  configSelectedPacker: string[];
  onConfigSelectedPackerChange: (packer: string, isChecked: boolean) => void;
  onCalculate: (processedData: RemisionEntry[]) => void; 
  onReset: () => void;
  onReturnToSuite: () => void;
  isLoading: boolean;
  onLoadConfiguration: (config: ReportConfiguration) => void;
  annotations: Annotations;
  learnedCorrections: ReferenceCorrections;
  onAcceptSuggestion: (incidentId: string, type: JustificationType) => void;
  sanitizedRecordCount: number;
  discardedRecords: DiscardedRecord[];
  deadTimes: DeadTimeEntry[];
  isSavingJustifications?: boolean;
  referenceGoals: ReferenceGoals;
  onReferenceGoalsChange: (goals: ReferenceGoals) => void;
  operationPulses?: OperationPulse[];
  /** Sustituye el mapa en memoria con lo último de Firestore (evita claves fantasma). */
  onReloadJustificationsFromServer?: () => Promise<void>;
}

export const ConfigurationScreen: React.FC<ConfigurationScreenProps> = ({
  fileName,
  rawData,
  productDB,
  goals,
  onGoalsChange,
  onSuggestGoals,
  brandProductTypeGoals,
  onBrandProductTypeGoalsChange,
  manualClassifications,
  onManualClassificationsChange,
  manualJustifications,
  onManualJustificationsChange,
  uniqueReferences,
  referenceCorrections,
  onReferenceCorrectionsChange,
  manualOperatorMappings,
  onManualOperatorMappingChange,
  incidentLog,
  onIncidentLogChange,
  reportDate,
  onReportDateChange,
  reportStartTime,
  onReportStartTimeChange,
  reportEndTime,
  onReportEndTimeChange,
  initialPackers,
  configSelectedPacker,
  onConfigSelectedPackerChange,
  onCalculate,
  onReset,
  onReturnToSuite,
  isLoading,
  onLoadConfiguration,
  annotations,
  learnedCorrections,
  onAcceptSuggestion,
  sanitizedRecordCount,
  discardedRecords,
  deadTimes,
  isSavingJustifications,
  referenceGoals,
  onReferenceGoalsChange,
  operationPulses = [],
  onReloadJustificationsFromServer,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [shareStatus, setShareStatus] = React.useState<'idle' | 'copied'>('idle');
  const [remisionPulseUserFilter, setRemisionPulseUserFilter] = React.useState('');
  
  const productMap = React.useMemo(() => buildProductLookupMap(productDB), [productDB]);
  const combinedCorrections = React.useMemo(() => ({ ...learnedCorrections, ...referenceCorrections }), [learnedCorrections, referenceCorrections]);

  const fullyProcessedData = React.useMemo(() => {
    return rawData.map(entry => {
      const { productType, brand, finalDescription, finalReference } = classifyProduct(
        entry,
        manualClassifications,
        combinedCorrections,
        productMap
      );
      return {
        ...entry,
        productType,
        marca: brand,
        descripcion: finalDescription,
        referencia: finalReference
      };
    });
  }, [rawData, manualClassifications, combinedCorrections, productMap]);

  const derivedState = React.useMemo(() => {
    const brands = extractBrandsFromReport(fullyProcessedData);
    const unclassifiedProducts = preScanForUnclassifiedProducts(fullyProcessedData);
    const unmappedPackers = extractUnmappedPackers(rawData, manualOperatorMappings);
    const allReferences = extractAllReferencesFromReport(fullyProcessedData);
    const importedBrandCatalogItems = extractImportedBrandCatalogItems(rawData, productMap);

    return { brands, unclassifiedProducts, unmappedPackers, allReferences, importedBrandCatalogItems };
  }, [fullyProcessedData, rawData, manualOperatorMappings, productMap]);

  const remisionSyncedRows = React.useMemo(() => {
    const toLocalDate = (value: Date): string => {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const userQuery = remisionPulseUserFilter.trim().toLowerCase();

    return (operationPulses || [])
      .filter((p) => p.metadata?.fromModule === 'Remisión' && p.type === 'pause')
      .map((p) => {
        const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime as any);
        const end = p.endTime ? (p.endTime instanceof Date ? p.endTime : new Date(p.endTime as any)) : null;
        const minutes =
          end && !Number.isNaN(end.getTime()) && !Number.isNaN(start.getTime())
            ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
            : null;

        return {
          id: p.id || `${p.userId}-${String(start)}`,
          userName: String(p.userName || ''),
          reason: String(p.reason || p.justification || p.details || 'Sin motivo'),
          start,
          end,
          minutes,
          status: String(p.status || ''),
        };
      })
      .filter((row) => {
        if (!reportDate || Number.isNaN(row.start.getTime())) return true;
        return toLocalDate(row.start) === reportDate;
      })
      .filter((row) => {
        if (!userQuery) return true;
        return row.userName.toLowerCase().includes(userQuery);
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [operationPulses, reportDate, remisionPulseUserFilter]);
  
  const handleCalculateClick = () => {
    onCalculate(fullyProcessedData);
  }

  const getFullConfiguration = React.useCallback((): ReportConfiguration => {
    return {
      productivityGoals: goals,
      brandProductTypeGoals,
      manualClassifications: manualClassifications,
      manualJustifications,
      referenceCorrections,
      learnedCorrections,
      manualOperatorMappings,
      incidentLog,
      reportDate,
      reportStartTime,
      reportEndTime,
      configSelectedPacker,
      annotations,
      referenceGoals,
    } as any;
  }, [goals, brandProductTypeGoals, manualClassifications, manualJustifications, referenceCorrections, learnedCorrections, manualOperatorMappings, incidentLog, reportDate, reportStartTime, reportEndTime, configSelectedPacker, annotations, referenceGoals]);


  const handleSaveConfiguration = React.useCallback(() => {
    const configuration = getFullConfiguration();
    const blob = new Blob([JSON.stringify(configuration, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `config_productividad_${fileName.replace(/\.[^/.]+$/, "")}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [getFullConfiguration, fileName]);

  const handleShareConfiguration = React.useCallback(() => {
    const configuration = getFullConfiguration();
    const jsonString = JSON.stringify(configuration);
    const encodedConfig = btoa(jsonString);
    const url = `${window.location.origin}${window.location.pathname}?config=${encodedConfig}`;
    
    navigator.clipboard.writeText(url).then(() => {
        setShareStatus('copied');
        setTimeout(() => setShareStatus('idle'), 2000);
    }).catch(err => {
        console.error('Failed to copy URL: ', err);
        alert('No se pudo copiar el enlace. Por favor, cópielo manualmente desde la barra de direcciones.');
    });
  }, [getFullConfiguration]);


  const handleLoadFileClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let mergedConfig: Partial<ReportConfiguration> = {};
    
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        let config = JSON.parse(text) as ReportConfiguration;
        
        mergedConfig = {
          ...mergedConfig,
          ...config,
          brandProductTypeGoals: { ...mergedConfig.brandProductTypeGoals, ...config.brandProductTypeGoals },
          manualClassifications: { ...mergedConfig.manualClassifications, ...config.manualClassifications },
          manualJustifications: { ...mergedConfig.manualJustifications, ...config.manualJustifications },
          referenceCorrections: { ...mergedConfig.referenceCorrections, ...config.referenceCorrections },
          manualOperatorMappings: { ...mergedConfig.manualOperatorMappings, ...config.manualOperatorMappings },
          incidentLog: [...(mergedConfig.incidentLog || []), ...(config.incidentLog || [])],
          annotations: {...mergedConfig.annotations, ...config.annotations}
        };

      } catch (err) {
        alert(`Error al leer el archivo de configuración ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (Object.keys(mergedConfig).length > 0) {
      onLoadConfiguration(mergedConfig as ReportConfiguration);
    }

    if(e.target) e.target.value = '';
  }, [onLoadConfiguration]);

  const handleAllPackerChange = (isChecked: boolean) => {
    onConfigSelectedPackerChange('all', !!isChecked);
  };
  
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <CardTitle>Parámetros del Reporte</CardTitle>
              <CardDescription>
                Archivo: <span className="font-semibold text-primary">{fileName}</span>. 
                Se procesarán <span className="font-bold text-foreground">{sanitizedRecordCount}</span> registros después de aplicar los filtros iniciales.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".json"
                  multiple
                />
                <Button
                    onClick={handleLoadFileClick}
                    variant="outline"
                    title="Cargar una o más configuraciones guardadas"
                >
                    <Upload />
                    Cargar
                </Button>
                <Button
                    onClick={handleSaveConfiguration}
                    variant="outline"
                    title="Guardar la configuración actual en un archivo"
                >
                    <FileDown />
                    Guardar
                </Button>
                 <Button
                    onClick={handleShareConfiguration}
                    variant="outline"
                    title="Copiar un enlace con esta configuración para compartir"
                >
                    <Share2 />
                    {shareStatus === 'copied' ? '¡Copiado!' : 'Compartir'}
                 </Button>
                <Button
                  onClick={onReturnToSuite}
                  variant="secondary"
                >
                  Volver a la Suite
                </Button>
                <Button
                  onClick={onReset}
                  variant="ghost"
                >
                  Cancelar
                </Button>
            </div>
        </CardHeader>
      </Card>

      <DiscardedRecordsViewer discardedRecords={discardedRecords} />
      
      <Card>
         <CardHeader>
            <CardTitle>Rango del Reporte</CardTitle>
            <CardDescription>
                Especifique el día y la hora. Esto es crucial para filtrar los datos correctos y calcular la productividad y los tiempos muertos.
            </CardDescription>
         </CardHeader>
         <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
                <Label htmlFor="report-date">Fecha del Reporte</Label>
                <Input
                    type="date"
                    id="report-date"
                    value={reportDate}
                    onChange={(e) => onReportDateChange(e.target.value)}
                    className="mt-1"
                />
            </div>
            <div>
                <Label htmlFor="start-time">Hora de Inicio</Label>
                <Input
                    type="time"
                    id="start-time"
                    value={reportStartTime}
                    onChange={(e) => onReportStartTimeChange(e.target.value)}
                    className="mt-1"
                />
            </div>
            <div>
                <Label htmlFor="end-time">Hora de Finalización</Label>
                <Input
                    type="time"
                    id="end-time"
                    value={reportEndTime}
                    onChange={(e) => onReportEndTimeChange(e.target.value)}
                    className="mt-1"
                />
            </div>
         </CardContent>
      </Card>
      
      <ReferenceCorrectionEditor 
        uniqueReferences={uniqueReferences} 
        corrections={referenceCorrections} 
        onCorrectionsChange={onReferenceCorrectionsChange} 
      />

      <ImportedBrandCatalogViewer items={derivedState.importedBrandCatalogItems} />

      <NewOperatorMapper 
        unmappedPackers={derivedState.unmappedPackers}
        mappings={manualOperatorMappings}
        onMappingChange={onManualOperatorMappingChange}
      />

      <Card>
        <CardHeader>
            <CardTitle>Filtro Global del Reporte</CardTitle>
            <CardDescription>
            Opcionalmente, puede generar el reporte para uno o varios operarios. Si selecciona "Todos", el reporte será global.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
                <Checkbox
                    id="packer-all"
                    checked={configSelectedPacker.includes('all')}
                    onCheckedChange={handleAllPackerChange}
                />
                <Label htmlFor="packer-all" className="font-medium">
                    Todos los Operarios
                </Label>
            </div>
            <hr className="border-border"/>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {initialPackers.filter(p => p !== 'all').map(packer => (
                    <div key={packer} className="flex items-center space-x-2">
                        <Checkbox
                            id={`packer-${packer}`}
                            checked={configSelectedPacker.includes('all') || configSelectedPacker.includes(packer)}
                            disabled={configSelectedPacker.includes('all')}
                            onCheckedChange={(checked) => onConfigSelectedPackerChange(packer, !!checked)}
                        />
                        <Label htmlFor={`packer-${packer}`} className="text-sm font-normal">
                            {packer}
                        </Label>
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>

      <GoalConfiguration goals={goals} onGoalsChange={onGoalsChange} onSuggestGoals={onSuggestGoals} />
      <ReferenceGoalConfiguration 
        uniqueReferences={derivedState.allReferences} 
        referenceGoals={referenceGoals} 
        onReferenceGoalsChange={onReferenceGoalsChange} 
        brandProductTypeGoals={brandProductTypeGoals} 
        baseGoals={goals} 
      />
      <BrandProductTypeGoalConfiguration brands={derivedState.brands} goals={brandProductTypeGoals} onBrandProductTypeGoalsChange={onBrandProductTypeGoalsChange} baseGoals={goals} />
      
      <IncidentLogEditor incidentLog={incidentLog} onIncidentLogChange={onIncidentLogChange} />

      <UnclassifiedProductEditor 
        unclassifiedTerms={derivedState.unclassifiedProducts} 
        classifications={manualClassifications}
        onClassificationsChange={onManualClassificationsChange}
        availableBrands={derivedState.brands}
      />
      
      <ManualJustificationsInspector
        reportDate={reportDate}
        justifications={manualJustifications}
        onJustificationsChange={onManualJustificationsChange}
        onReloadFromServer={onReloadJustificationsFromServer}
        isSaving={isSavingJustifications}
      />
      
      <Card className="border-sky-600/30 bg-sky-950/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Pausas sincronizadas desde Remisión — día {reportDate || '—'}
          </CardTitle>
          <CardDescription>
            Pulsos del día leídos desde <code className="text-xs">operation_pulses</code> con origen Remisión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={remisionPulseUserFilter}
              onChange={(e) => setRemisionPulseUserFilter(e.target.value)}
              placeholder="Filtrar por usuario..."
              className="h-8 w-[220px]"
            />
            <span className="text-xs text-muted-foreground">{remisionSyncedRows.length} registros</span>
          </div>
          {remisionSyncedRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No hay pausas de Remisión para este día/filtro.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operario</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fin</TableHead>
                  <TableHead>Duración (min)</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remisionSyncedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.userName || '—'}</TableCell>
                    <TableCell className="text-sm">{row.reason}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {Number.isNaN(row.start.getTime())
                        ? '—'
                        : row.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {row.end && !Number.isNaN(row.end.getTime())
                        ? row.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'Activa'}
                    </TableCell>
                    <TableCell className="text-sm">{row.minutes != null ? row.minutes : 'Activa'}</TableCell>
                    <TableCell className="text-sm">{row.status || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DeadTimeJustificationEditor 
          incidents={deadTimes}
          justifications={manualJustifications} 
          onJustificationsChange={onManualJustificationsChange} 
          onAcceptSuggestion={onAcceptSuggestion}
          isSaving={isSavingJustifications}
      />

      <div className="flex justify-end pt-4">
        <Button
          onClick={handleCalculateClick}
          disabled={isLoading || !reportDate}
          size="lg"
          className="w-full sm:w-auto"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoading ? 'Calculando...' : 'Generar Reporte'}
        </Button>
      </div>
    </div>
  );
};
