

"use client";

import React, { useState, useMemo } from 'react';
import { DeadTimeEntry, ManualJustifications, JustificationType } from '@/types';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MoreHorizontal, CheckCircle, AlertTriangle, Clock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface Props {
  incidents: DeadTimeEntry[];
  justifications: ManualJustifications;
  onJustificationsChange: (justifications: ManualJustifications) => void;
  onAcceptSuggestion: (incidentId: string, type: JustificationType) => void;
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
  onAcceptSuggestion
}) => {
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<DeadTimeEntry | null>(null);
  const [reason, setReason] = useState('');
  const [customDuration, setCustomDuration] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState('');

  const handleOpenReasonDialog = (incident: DeadTimeEntry) => {
    setSelectedIncident(incident);
    const currentJustification = justifications[incident.id];
    setReason(currentJustification?.reasonText || '');
    setCustomDuration(currentJustification?.customDuration);
    setIsDialogOpen(true);
  };

  const handleClassificationChange = (incidentId: string, type: JustificationType | 'UNJUSTIFIED') => {
    const newJustifications = { ...justifications };
    if (type === 'UNJUSTIFIED') {
        delete newJustifications[incidentId];
    } else {
        newJustifications[incidentId] = { type };
    }
    onJustificationsChange(newJustifications);
  };
  
  const handleSaveReason = () => {
    if (!selectedIncident) return;
    
    const newJustifications = { ...justifications };
    const justificationText = reason.trim();
    if (justificationText || customDuration) {
        newJustifications[selectedIncident.id] = {
            type: 'REASON',
            reasonText: justificationText,
            customDuration: customDuration
        };
    } else {
        delete newJustifications[selectedIncident.id];
    }
    onJustificationsChange(newJustifications);
    
    setIsDialogOpen(false);
    setSelectedIncident(null);
    setReason('');
    setCustomDuration(undefined);
  };
  
  const getClassificationText = (incident: DeadTimeEntry): string => {
      if (incident.status === 'Justificado') {
          return incident.justification || 'Justificado';
      }
      if(incident.status === 'Excedente de Descanso'){
          return 'Excedente de Descanso';
      }
      return "No Justificado";
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


  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Gestión de Inactividad</CardTitle>
        <CardDescription>
            Revise las pausas detectadas (mayores o iguales a 5 minutos). Asígnelas a un descanso o justifíquelas con una razón.
        </CardDescription>
         <div className="relative pt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
            placeholder="Filtrar por nombre de operario..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-10 w-full sm:w-80"
          />
        </div>
      </CardHeader>
      <CardContent>
       {incidentsToDisplay.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          {incidents.length > 0 ? 'No se encontraron resultados para el filtro actual.' : 'No se detectaron pausas o tiempos muertos significativos para la selección actual.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operario</TableHead>
                <TableHead>Horario Pausa</TableHead>
                <TableHead className="text-center">Duración (min)</TableHead>
                <TableHead>Clasificación Actual</TableHead>
                <TableHead className="text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidentsToDisplay.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell className="font-medium whitespace-nowrap">{incident.packerName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {incident.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {incident.endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-center font-semibold">{incident.duration}</TableCell>
                    <TableCell>
                        <Badge variant={getStatusVariant(incident.status)} className="whitespace-nowrap">
                            {getStatusIcon(incident.status)}
                            {getClassificationText(incident)}
                        </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={incident.status === 'Justificado'}>
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Toggle menu</span>
                              </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'UNJUSTIFIED')}>Marcar como No Justificado</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'BREAKFAST')}>Asignar a Desayuno</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'LUNCH')}>Asignar a Almuerzo</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleClassificationChange(incident.id, 'SNACK')}>Asignar a Refrigerio</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleOpenReasonDialog(incident)}>Justificar con Razón...</DropdownMenuItem>
                          </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      </CardContent>
       <CardContent>
        <AutoJustificationSuggestions 
            incidents={incidents} 
            onAcceptSuggestion={onAcceptSuggestion}
            existingJustifications={justifications}
        />
      </CardContent>
    </Card>

    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            {selectedIncident && (
            <>
                <DialogHeader>
                    <DialogTitle>Justificar Inactividad</DialogTitle>
                    <DialogDescription>
                        Para la pausa de <span className="font-bold">{selectedIncident.packerName}</span> de {selectedIncident.duration} minutos.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="reason" className="text-right">Razón</Label>
                        <Input
                          id="reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="col-span-3"
                          placeholder="Ej: Falla de impresora"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="duration" className="text-right">Duración (min)</Label>
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
                                setCustomDuration(Math.min(numVal, selectedIncident.duration));
                              }
                          }}
                          className="col-span-3"
                          placeholder={`Parcial (máx ${selectedIncident.duration})`}
                          max={selectedIncident.duration}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancelar</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleSaveReason}>Guardar Justificación</Button>
                </DialogFooter>
            </>
            )}
        </DialogContent>
    </Dialog>
    </>
  );
};
