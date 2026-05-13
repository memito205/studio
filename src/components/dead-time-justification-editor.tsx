"use client";

import React, { useState, useMemo } from 'react';
import { DeadTimeEntry, ManualJustifications, JustificationType } from '@/types';
import { findManualJustificationKeysForDeadTime } from '@/services/reportProcessor';
import { AutoJustificationSuggestions } from './auto-justification-suggestions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogClose
} from "@/components/ui/dialog";
import {
    MoreHorizontal, 
    CheckCircle, 
    AlertTriangle, 
    Clock, 
    Search, 
    User, 
    CalendarCheck, 
    Timer, 
    ArrowRightCircle, 
    UserMinus,
    LayoutGrid,
    List,
    RotateCcw,
    Trash2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

function stripSyncedJustificationPrefix(text: string): string {
  return text.replace(/^\[(?:Pulso|Remisión|Global)\]\s*/i, '').trim();
}

function inferBreakTypeFromIncidentText(text: string | undefined): JustificationType | undefined {
  const j = stripSyncedJustificationPrefix(text || '').toLowerCase();
  if (/\bdesayuno\b/.test(j)) return 'BREAKFAST';
  if (/\balmuerzo\b/.test(j)) return 'LUNCH';
  if (/\brefrigerio\b/.test(j)) return 'SNACK';
  return undefined;
}

function manualBreakLabel(type: JustificationType): string | undefined {
  switch (type) {
    case 'BREAKFAST': return 'Desayuno';
    case 'LUNCH': return 'Almuerzo';
    case 'SNACK': return 'Refrigerio';
    default: return undefined;
  }
}

/** Id del pause original antes de splits (`-justified`, `-excess`, etc.). */
function baseDeadTimeId(incidentId: string): string {
  return incidentId.replace(/-(justified|excess|remains|pre|post)$/i, '');
}

interface Props {
  incidents: DeadTimeEntry[];
  justifications: ManualJustifications;
  onJustificationsChange: (justifications: ManualJustifications) => void;
  onAcceptSuggestion: (incidentId: string, type: JustificationType) => void;
  isSaving?: boolean;
}

const getStatusVariant = (status: DeadTimeEntry['status']): 'success' | 'warning' | 'destructive' | 'default' => {
    switch (status) {
        case 'Justificado': return 'success';
        case 'Excedente de Descanso': return 'warning';
        case 'No Justificado': return 'destructive';
        default: return 'default';
    }
}

const getStatusIcon = (status: DeadTimeEntry['status']): React.ReactNode => {
    switch(status) {
        case 'Justificado': return <CheckCircle className="h-3.5 w-3.5 -translate-x-1" />;
        case 'Excedente de Descanso': return <AlertTriangle className="h-3.5 w-3.5 -translate-x-1" />;
        case 'No Justificado': return <Clock className="h-3.5 w-3.5 -translate-x-1" />;
        default: return null;
    }
}

export const DeadTimeJustificationEditor: React.FC<Props> = ({ 
  incidents, 
  justifications, 
  onJustificationsChange,
  onAcceptSuggestion,
  isSaving = false
}) => {
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<DeadTimeEntry | null>(null);
  const [reason, setReason] = useState('');
  const [customDuration, setCustomDuration] = useState<number | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isRevertDialogOpen, setIsRevertDialogOpen] = useState(false);
  const [incidentToRevert, setIncidentToRevert] = useState<DeadTimeEntry | null>(null);
  const [restartTime, setRestartTime] = useState('');

  const handleOpenReasonDialog = (incident: DeadTimeEntry) => {
    setSelectedIncident(incident);
    const currentJustification = justifications[incident.id];
    let initialReason = currentJustification?.reasonText?.trim() || '';
    if (!initialReason && incident.justification?.trim()) {
      initialReason = stripSyncedJustificationPrefix(incident.justification);
    }
    setReason(initialReason);
    setCustomDuration(currentJustification?.customDuration);
    
    // Default to the full incident range
    const startStr = currentJustification?.startTime || incident.startTime.toTimeString().substring(0, 5);
    const endStr = currentJustification?.endTime || incident.endTime.toTimeString().substring(0, 5);
    
    setStartTime(startStr);
    setEndTime(endStr);
    setIsDialogOpen(true);
  };

  const handleClassificationChange = (incidentId: string, type: JustificationType | 'UNJUSTIFIED') => {
    const newJustifications = { ...justifications };
    if (type === 'UNJUSTIFIED') {
        newJustifications[incidentId] = { type: 'PULSE_IGNORE' };
    } else {
        newJustifications[incidentId] = { type };
    }
    onJustificationsChange(newJustifications);
  };

  const handleClearManualJustification = (incidentId: string) => {
    const next = { ...justifications };
    delete next[incidentId];
    onJustificationsChange(next);
  };

  /** Quita todas las claves manuales que el motor asocia a este tramo; si solo quedaba justificación por pulso, marca ignorar. */
  const handleRemoveJustification = (incident: DeadTimeEntry) => {
    const keys = findManualJustificationKeysForDeadTime(incident, justifications);
    const next = { ...justifications };
    let changed = false;
    for (const k of keys) {
      delete next[k];
      changed = true;
    }
    if (changed) {
      onJustificationsChange(next);
      return;
    }
    if (incident.status === 'Justificado' || incident.status === 'Excedente de Descanso') {
      const baseId = baseDeadTimeId(incident.id);
      next[baseId] = { type: 'PULSE_IGNORE' };
      onJustificationsChange(next);
    }
  };
  
  const handleSaveReason = () => {
    if (!selectedIncident) return;
    
    const newJustifications = { ...justifications };
    const justificationText = reason.trim();
    const prev = justifications[selectedIncident.id];
    const inferredFromIncident = inferBreakTypeFromIncidentText(selectedIncident.justification);
    const inferredFromUserText = inferBreakTypeFromIncidentText(justificationText);
    const hasRangeOrDuration =
      (Boolean(startTime?.trim()) && Boolean(endTime?.trim())) || customDuration != null;

    if (!justificationText && !hasRangeOrDuration) {
      delete newJustifications[selectedIncident.id];
      onJustificationsChange(newJustifications);
      setIsDialogOpen(false);
      setSelectedIncident(null);
      setReason('');
      setCustomDuration(undefined);
      setStartTime('');
      setEndTime('');
      return;
    }

    let savedType: JustificationType = 'REASON';
    if (prev?.type && prev.type !== 'PULSE_IGNORE') {
      if (prev.type === 'SHIFT_END') savedType = 'SHIFT_END';
      else if (['BREAKFAST', 'LUNCH', 'SNACK'].includes(prev.type)) savedType = prev.type;
      else savedType = prev.type;
    } else if (justificationText && !inferredFromUserText) {
      savedType = 'REASON';
    } else if (inferredFromUserText) {
      savedType = inferredFromUserText;
    } else if (inferredFromIncident) {
      savedType = inferredFromIncident;
    }

    newJustifications[selectedIncident.id] = {
      type: savedType,
      reasonText: justificationText || undefined,
      customDuration,
      startTime: startTime?.trim() || undefined,
      endTime: endTime?.trim() || undefined,
    };
    onJustificationsChange(newJustifications);
    
    setIsDialogOpen(false);
    setSelectedIncident(null);
    setReason('');
    setCustomDuration(undefined);
    setStartTime('');
    setEndTime('');
  };

  const handleOpenRevertDialog = (incident: DeadTimeEntry) => {
    setIncidentToRevert(incident);
    const defaultRestartTime = incident.endTime.toTimeString().substring(0, 5);
    setRestartTime(defaultRestartTime);
    setIsRevertDialogOpen(true);
  };

  const handleConfirmRevert = () => {
    if (!incidentToRevert || !restartTime) return;

    const incidentStart = incidentToRevert.startTime.toTimeString().substring(0, 5);
    const incidentEnd = incidentToRevert.endTime.toTimeString().substring(0, 5);

    // Keep the selected time within the incident range.
    const boundedRestartTime =
      restartTime < incidentStart ? incidentStart : restartTime > incidentEnd ? incidentEnd : restartTime;

    const newJustifications = { ...justifications };
    newJustifications[incidentToRevert.id] = {
      type: 'REASON',
      reasonText: `Reingreso a labor desde ${boundedRestartTime}`,
      startTime: incidentStart,
      endTime: boundedRestartTime,
    };
    onJustificationsChange(newJustifications);

    setIsRevertDialogOpen(false);
    setIncidentToRevert(null);
    setRestartTime('');
  };
  
  const getClassificationText = (incident: DeadTimeEntry): string => {
      const manual = justifications[incident.id];
      if (incident.status === 'Justificado') {
          if (incident.justification?.trim()) return incident.justification.trim();
          if (manual?.reasonText?.trim()) return manual.reasonText.trim();
          if (manual?.type && ['BREAKFAST', 'LUNCH', 'SNACK'].includes(manual.type)) {
            const lbl = manualBreakLabel(manual.type);
            return manual.reasonText?.trim() || (lbl ? `Descanso: ${lbl}` : 'Justificado');
          }
          return 'Justificado (sin motivo visible — use Modificar justificación)';
      }
      if (incident.status === 'Excedente de Descanso') {
          return incident.justification?.trim() || 'Excedente de Descanso';
      }
      if (manual?.type === 'PULSE_IGNORE') return 'No justificado (pulso ignorado)';
      return 'No Justificado';
  }

  const incidentsToDisplay = useMemo(() => {
    const baseIncidents = incidents.filter(inc => inc.duration >= 5);
    if (!filter) {
        return baseIncidents;
    }
    const lowercasedFilter = filter.toLowerCase();
    return baseIncidents.filter(inc => 
        inc.packerName.toLowerCase().includes(lowercasedFilter)
    );
  }, [incidents, filter]);

  const groupedIncidents = useMemo(() => {
    return incidentsToDisplay.reduce((acc, inc) => {
        if (!acc[inc.packerName]) acc[inc.packerName] = [];
        acc[inc.packerName].push(inc);
        return acc;
    }, {} as Record<string, DeadTimeEntry[]>);
  }, [incidentsToDisplay]);

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Timer className="h-6 w-6 text-primary" />
            Gestión de Inactividad
          </h2>
          <p className="text-muted-foreground">
              Refina y justifica los tiempos muertos detectados para optimizar el cálculo de productividad.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex border rounded-lg p-1 bg-background shadow-sm">
              <Button 
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'} 
                  size="sm" 
                  onClick={() => setViewMode('grid')}
                  className="px-3"
              >
                  <LayoutGrid className="h-4 w-4 mr-2" /> Cuadrícula
              </Button>
              <Button 
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
                  size="sm" 
                  onClick={() => setViewMode('list')}
                  className="px-3"
              >
                  <List className="h-4 w-4 mr-2" /> Lista
              </Button>
          </div>
          <Button 
              onClick={() => onJustificationsChange(justifications)}
              disabled={isSaving}
              className="shadow-lg hover:shadow-xl transition-all"
          >
              {isSaving ? (
              <>
                  <Clock className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
              </>
              ) : (
              <>
                  <CalendarCheck className="mr-2 h-4 w-4" />
                  Fijar Justificaciones
              </>
              )}
          </Button>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
            placeholder="Buscar por operario..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-10 h-11 bg-background shadow-sm border-muted-foreground/20 focus:border-primary transition-colors"
          />
        </div>
        {filter && (
          <Button variant="ghost" onClick={() => setFilter('')} className="h-11">
              Limpiar Filtro
          </Button>
        )}
      </div>

      {incidentsToDisplay.length === 0 ? (
        <Card className="bg-muted/50 border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-12">
             <div className="bg-background p-4 rounded-full shadow-sm mb-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
             </div>
             <p className="text-muted-foreground text-lg font-medium">
                {incidents.length > 0 ? 'No se encontraron resultados para el filtro actual.' : 'Sin inactividades pendientes de revisión.'}
             </p>
          </CardContent>
        </Card>
      ) : (
        <div className={cn(
            "grid gap-6",
            viewMode === 'grid' ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
        )}>
          {Object.entries(groupedIncidents).map(([packerName, packerIncidents]) => (
              <Card key={packerName} className="flex flex-col h-full bg-card hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3 bg-muted/30 rounded-t-lg">
                      <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                              <div className="bg-primary/10 p-2 rounded-lg">
                                  <User className="h-4 w-4 text-primary" />
                              </div>
                              <CardTitle className="text-sm font-bold truncate max-w-[150px]">{packerName}</CardTitle>
                          </div>
                          <Badge variant="outline" className="font-mono">{packerIncidents.length}</Badge>
                      </div>
                  </CardHeader>
                  <CardContent className="p-4 flex-1">
                      <ScrollArea className={cn("pr-4", viewMode === 'grid' ? "h-[350px]" : "h-auto")}>
                          <div className="space-y-4">
                              {packerIncidents.map((incident) => (
                                  <div key={incident.id} className="group relative p-4 rounded-lg border bg-background hover:border-primary/50 transition-all space-y-3">
                                      <div className="flex justify-between items-start gap-3">
                                          <div className="space-y-1">
                                              <div className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                                  <ArrowRightCircle className="h-3 w-3 mr-1 text-primary" />
                                                  {incident.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {incident.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                              </div>
                                              <div className="flex items-center gap-2">
                                                  <span className="text-lg font-black tracking-tight">{incident.duration}</span>
                                                  <span className="text-xs text-muted-foreground font-medium">minutos</span>
                                              </div>
                                          </div>
                                          <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                  <Button variant="ghost" size="icon" className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                                                      <MoreHorizontal className="h-4 w-4" />
                                                  </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end" className="w-[240px]">
                                                  <DropdownMenuItem onClick={() => handleOpenReasonDialog(incident)}>
                                                      {(justifications[incident.id] || incident.status === 'Justificado')
                                                          ? 'Modificar justificación…'
                                                          : 'Justificar con razón…'}
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem
                                                      onClick={() => handleRemoveJustification(incident)}
                                                      className="text-destructive focus:text-destructive"
                                                  >
                                                      <Trash2 className="h-4 w-4 mr-2" />
                                                      Eliminar justificación
                                                  </DropdownMenuItem>
                                                  {justifications[incident.id]?.type === 'PULSE_IGNORE' ? (
                                                      <DropdownMenuItem onClick={() => handleClearManualJustification(incident.id)}>
                                                          Restaurar sincronización con pulso
                                                      </DropdownMenuItem>
                                                  ) : (
                                                      <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'UNJUSTIFIED')}>
                                                          No justificado (ignorar pulso automático)
                                                      </DropdownMenuItem>
                                                  )}
                                                  <Separator className="my-1" />
                                                  <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'BREAKFAST')}>Asignar a Desayuno</DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'LUNCH')}>Asignar a Almuerzo</DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'SNACK')}>Asignar a Refrigerio</DropdownMenuItem>
                                                  <Separator className="my-1" />
                                                  <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'SHIFT_END')} className="text-destructive font-semibold">
                                                      <UserMinus className="h-4 w-4 mr-2" /> Finalizar Labor
                                                  </DropdownMenuItem>
                                                  {justifications[incident.id]?.type === 'SHIFT_END' && (
                                                      <DropdownMenuItem onClick={() => handleOpenRevertDialog(incident)}>
                                                          <RotateCcw className="h-4 w-4 mr-2" /> Revertir Finalización
                                                      </DropdownMenuItem>
                                                  )}
                                              </DropdownMenuContent>
                                          </DropdownMenu>
                                      </div>
                                      <Badge variant={getStatusVariant(incident.status)} className="w-full justify-start font-medium py-1.5 px-2.5 border-none">
                                          {getStatusIcon(incident.status)}
                                          <span className="truncate ml-1">{getClassificationText(incident)}</span>
                                      </Badge>
                                  </div>
                              ))}
                          </div>
                      </ScrollArea>
                  </CardContent>
              </Card>
          ))}
        </div>
      )}
      
      <AutoJustificationSuggestions 
          incidents={incidents} 
          onAcceptSuggestion={onAcceptSuggestion}
          existingJustifications={justifications}
      />
    </div>

    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            {selectedIncident && (
            <>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Timer className="h-5 w-5 text-primary" />
                        Justificar Inactividad
                    </DialogTitle>
                    <DialogDescription>
                        Ingrese la razón por la cual <span className="font-bold text-foreground">{selectedIncident.packerName}</span> tuvo un tiempo muerto de {selectedIncident.duration} minutos.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="reason">Razón o Motivo</Label>
                        <Input
                          id="reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="w-full"
                          placeholder="Ej: Falla de impresora, Falta de cajas..."
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="startTime">Desde</Label>
                            <Input
                                id="startTime"
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="endTime">Hasta</Label>
                            <Input
                                id="endTime"
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="duration">Duración Adicional (opcional)</Label>
                        <div className="flex items-center gap-3">
                            <Input
                            id="duration"
                            type="number"
                            value={customDuration ?? ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                const numVal = Number(val);
                                if (val === '') {
                                    setCustomDuration(undefined);
                                } else if (!isNaN(numVal)) {
                                    setCustomDuration(numVal);
                                }
                            }}
                            className="flex-1"
                            placeholder="Minutos extra..."
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground italic">
                            Si selecciona un rango, el sistema justificará exactamente ese periodo.
                        </p>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button type="button" variant="ghost">Cancelar</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleSaveReason} className="shadow-md">Guardar Justificación</Button>
                </DialogFooter>
            </>
            )}
        </DialogContent>
    </Dialog>
    <Dialog open={isRevertDialogOpen} onOpenChange={setIsRevertDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            {incidentToRevert && (
            <>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw className="h-5 w-5 text-primary" />
                        Revertir Finalización de Labor
                    </DialogTitle>
                    <DialogDescription>
                        Seleccione la hora desde la que el operario volvió a laborar. Se conservará justificado solo el tramo anterior.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="restartTime">Hora de reinicio</Label>
                        <Input
                            id="restartTime"
                            type="time"
                            value={restartTime}
                            onChange={(e) => setRestartTime(e.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Rango detectado: {incidentToRevert.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {incidentToRevert.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button type="button" variant="ghost">Cancelar</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleConfirmRevert} disabled={!restartTime}>
                        Guardar Reingreso
                    </Button>
                </DialogFooter>
            </>
            )}
        </DialogContent>
    </Dialog>
    </>
  );
};
