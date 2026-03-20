/** @jsxImportSource react */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LabelingActivityLog } from '@/types';
import { format, formatDistance } from 'date-fns';
import { es } from 'date-fns/locale';
import { ScrollArea } from './ui/scroll-area';

interface LabelingActivityLogDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  logs: LabelingActivityLog[];
  taskTitle: string;
}

const getActivityText = (log: LabelingActivityLog): string => {
    switch (log.type) {
        case 'START': return 'Inicio de Tarea';
        case 'PAUSE': return `Pausa (${log.pauseReason || 'Sin motivo'})`;
        case 'RESUME': return 'Reanudación de Tarea';
        case 'FINISH': return 'Finalización de Tarea';
        default: return log.type;
    }
}

export const LabelingActivityLogDialog: React.FC<LabelingActivityLogDialogProps> = ({
  isOpen,
  onOpenChange,
  logs,
  taskTitle,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Log de Actividad: {taskTitle}</DialogTitle>
          <DialogDescription>
            Historial de eventos para esta tarea de etiquetado.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Evento</TableHead>
                <TableHead>Fecha y Hora</TableHead>
                <TableHead>Duración</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, index) => {
                 let durationText = '-';
                 if (log.type === 'PAUSE') {
                    const resumeLog = logs.find(l => l.type === 'RESUME' && new Date(l.timestamp) > new Date(log.timestamp));
                    const finishLog = logs.find(l => l.type === 'FINISH');
                    const endTime = resumeLog ? new Date(resumeLog.timestamp) : (finishLog ? new Date(finishLog.timestamp) : new Date());
                    durationText = formatDistance(new Date(log.timestamp), endTime, { locale: es, addSuffix: false });
                 }
                 return (
                    <TableRow key={log.id}>
                        <TableCell className="font-medium">{getActivityText(log)}</TableCell>
                        <TableCell>{format(new Date(log.timestamp), 'PPP p', { locale: es })}</TableCell>
                        <TableCell>{durationText}</TableCell>
                    </TableRow>
                );
              })}
            </TableBody>
          </Table>
           {logs.length === 0 && <p className="text-center text-muted-foreground p-4">No hay actividades registradas.</p>}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
