

"use client";

import React, { useMemo, useEffect } from 'react';
import type { ProductivityGoals, BrandProductTypeGoals, ManualProductClassifications, ManualJustifications, UniqueReference, ReferenceCorrections, ReportConfiguration, ManualOperatorMappings, IncidentLogEntry, JustificationType, Annotations, ProductDatabaseItem, DiscardedRecord, RemisionEntry, DeadTimeEntry } from '@/types';
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
import { ReferenceCorrectionEditor } from './reference-correction-editor';
import { NewOperatorMapper } from './new-operator-mapper';
import { IncidentLogEditor } from './incident-log-editor';
import { DiscardedRecordsViewer } from './discarded-records-viewer';
import { classifyProduct, extractBrandsFromReport, preScanForUnclassifiedProducts, extractUnmappedPackers } from '@/services/reportProcessor';

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
  onManualJustificationsChange: (newJustifications: ManualJustifications) => void;
  uniqueReferences: UniqueReference[];
  referenceCorrections: ReferenceCorrections;
  onReferenceCorrectionsChange: (newCorrections: ReferenceCorrections) => void;
  manualOperatorMappings: ManualOperatorMappings;
  onManualOperatorMappingChange: (id: string, name: string) => void;
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
  onCalculate: () => void; 
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
  onProcessedDataChange: (data: RemisionEntry[]) => void; // Add this prop
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
  onProcessedDataChange,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [shareStatus, setShareStatus] = React.useState<'idle' | 'copied'>('idle');
  
  const productMap = React.useMemo(() => new Map(productDB.map(p => [p.codigoBarras, p])), [productDB]);
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

  useEffect(() => {
    onProcessedDataChange(fullyProcessedData);
  }, [fullyProcessedData, onProcessedDataChange]);

  const derivedState = React.useMemo(() => {
    const brands = extractBrandsFromReport(fullyProcessedData);
    const unclassifiedProducts = preScanForUnclassifiedProducts(fullyProcessedData);
    const unmappedPackers = extractUnmappedPackers(rawData, manualOperatorMappings);

    return { brands, unclassifiedProducts, unmappedPackers };
  }, [fullyProcessedData, rawData, manualOperatorMappings]);

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
    } as any;
  }, [goals, brandProductTypeGoals, manualClassifications, manualJustifications, referenceCorrections, learnedCorrections, manualOperatorMappings, incidentLog, reportDate, reportStartTime, reportEndTime, configSelectedPacker, annotations]);


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
      <BrandProductTypeGoalConfiguration brands={derivedState.brands} goals={brandProductTypeGoals} onBrandProductTypeGoalsChange={onBrandProductTypeGoalsChange} baseGoals={goals} />
      
      <IncidentLogEditor incidentLog={incidentLog} onIncidentLogChange={onIncidentLogChange} />

      <UnclassifiedProductEditor 
        unclassifiedTerms={derivedState.unclassifiedProducts} 
        classifications={manualClassifications}
        onClassificationsChange={onManualClassificationsChange}
        availableBrands={derivedState.brands}
      />
      
      <DeadTimeJustificationEditor 
          incidents={deadTimes}
          justifications={manualJustifications} 
          onJustificationsChange={onManualJustificationsChange} 
          onAcceptSuggestion={onAcceptSuggestion}
      />

      <div className="flex justify-end pt-4">
        <Button
          onClick={onCalculate}
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
