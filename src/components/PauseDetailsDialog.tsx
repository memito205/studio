/** @jsxImportSource react */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OperationPause } from '@/types';
import { Badge } from './ui/badge';

interface PauseDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: {
    operation_rk_identifier: string;
    userName: string;
    pauses: OperationPause[];
  } | null;
}

const PauseDetailsDialog: React.FC<PauseDetailsDialogProps> = ({ open, onOpenChange, report }) => {
  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalles de Pausas para: {report.userName}</DialogTitle>
          <DialogDescription>
            Operación RK: {report.operation_rk_identifier}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {report.pauses.length === 0 ? (
            <p className="text-muted-foreground text-center">No se encontraron pausas para este usuario en esta operación.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Razón</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead className="text-right">Duración (min)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.pauses.map((pause, index) => {
                    const startTime = pause.start_time;
                    const endTime = pause.end_time; // This can be null
                    const durationMinutes = endTime 
                        ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000 
                        : (new Date().getTime() - new Date(startTime).getTime()) / 60000;

                    return (
                        <TableRow key={pause.id || index}>
                            <TableCell>{pause.pause_reason}</TableCell>
                            <TableCell>{new Date(startTime).toLocaleString()}</TableCell>
                            <TableCell>
                                {endTime ? new Date(endTime).toLocaleString() : <Badge variant="destructive">Activa</Badge>}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{durationMinutes.toFixed(2)}</TableCell>
                        </TableRow>
                    );
                   })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PauseDetailsDialog;
