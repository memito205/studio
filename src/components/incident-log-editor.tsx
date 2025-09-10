"use client";

import type { IncidentLogEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2 } from 'lucide-react';
import React from 'react';

interface IncidentLogEditorProps {
    incidentLog: IncidentLogEntry[];
    onIncidentLogChange: (log: IncidentLogEntry[]) => void;
}

const formatDateTimeLocal = (isoString: string): string => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        // Adjust for timezone offset for correct display in datetime-local input
        const tzoffset = date.getTimezoneOffset() * 60000;
        const localISOTime = new Date(date.getTime() - tzoffset).toISOString().slice(0, 16);
        return localISOTime;
    } catch (e) {
        console.error("Invalid date for formatting:", isoString, e);
        return '';
    }
};

export const IncidentLogEditor: React.FC<IncidentLogEditorProps> = ({ incidentLog, onIncidentLogChange }) => {

    const handleAddIncident = () => {
        const newIncident: IncidentLogEntry = {
            id: `incident-${Date.now()}`,
            timestamp: new Date().toISOString(),
            text: ''
        };
        onIncidentLogChange([...incidentLog, newIncident]);
    };

    const handleIncidentChange = (id: string, field: 'timestamp' | 'text', value: string) => {
        const updatedLog = incidentLog.map(entry => {
            if (entry.id === id) {
                if (field === 'timestamp') {
                    // When changing datetime-local, convert back to ISO string
                    return { ...entry, timestamp: new Date(value).toISOString() };
                }
                return { ...entry, [field]: value };
            }
            return entry;
        });
        onIncidentLogChange(updatedLog);
    };

    const handleDeleteIncident = (id: string) => {
        onIncidentLogChange(incidentLog.filter(entry => entry.id !== id));
    };

    return (
        <Card>
            <CardHeader className="flex-row justify-between items-center">
                <div>
                    <CardTitle>Registro de Incidencias</CardTitle>
                    <CardDescription className="mt-1">
                        Añada eventos (ej: fallas de máquina) que puedan explicar variaciones.
                    </CardDescription>
                </div>
                <Button
                    onClick={handleAddIncident}
                    variant="outline"
                >
                    Añadir Incidencia
                </Button>
            </CardHeader>

            <CardContent>
              <div className="space-y-4">
                  {incidentLog.map(entry => (
                      <div key={entry.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 bg-muted/50 rounded-lg">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-grow">
                              <div className="space-y-1">
                                  <Label htmlFor={`timestamp-${entry.id}`} className="text-xs">Fecha y Hora</Label>
                                  <Input
                                      type="datetime-local"
                                      id={`timestamp-${entry.id}`}
                                      value={formatDateTimeLocal(entry.timestamp)}
                                      onChange={(e) => handleIncidentChange(entry.id, 'timestamp', e.target.value)}
                                  />
                              </div>
                              <div className="space-y-1">
                                  <Label htmlFor={`text-${entry.id}`} className="text-xs">Descripción de la Incidencia</Label>
                                  <Input
                                      type="text"
                                      id={`text-${entry.id}`}
                                      value={entry.text}
                                      onChange={(e) => handleIncidentChange(entry.id, 'text', e.target.value)}
                                      placeholder="Ej: Falla en sistema de bandas"
                                  />
                              </div>
                          </div>
                          <Button
                              onClick={() => handleDeleteIncident(entry.id)}
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
                              title="Eliminar incidencia"
                          >
                              <Trash2 className="h-5 w-5" />
                          </Button>
                      </div>
                  ))}
              </div>
            </CardContent>
        </Card>
    );
};
