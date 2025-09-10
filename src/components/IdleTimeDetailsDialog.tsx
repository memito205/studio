/** @jsxImportSource react */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';

interface IdleTimeDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: {
    reception_id: string;
    rk_identifier: string;
    total_idle_time_minutes: number;
    details: Array<{
      from_scan_time: string;
      to_scan_time: string;
      idle_duration_minutes: number;
      userId?: string; // Add userId
      userName?: string; // Add userName
    }>;
  } | null;
}

const IdleTimeDetailsDialog: React.FC<IdleTimeDetailsDialogProps> = ({ open, onOpenChange, report }) => {
  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalles de Tiempo Muerto para RK: {report.rk_identifier}</DialogTitle>
          <DialogDescription>
            Tiempo muerto total: {report.total_idle_time_minutes.toFixed(2)} minutos
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {report.details.length === 0 ? (
            <p className="text-muted-foreground">No hay detalles de tiempo muerto para esta operación.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Desde Escaneo/Inicio</TableHead>
                    <TableHead>Hasta Escaneo/Fin</TableHead>
                    <TableHead>Usuario</TableHead> {/* New column for User */}
                    <TableHead className="text-right">Duración (min)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.details.map((detail, index) => (
                    <TableRow key={index}>
                      <TableCell>{detail.from_scan_time}</TableCell>
                      <TableCell>{detail.to_scan_time}</TableCell>
                      <TableCell>{detail.userName || detail.userId || 'N/A'}</TableCell> {/* Display user name */}
                      <TableCell className="text-right">{detail.idle_duration_minutes.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default IdleTimeDetailsDialog;
