
"use client";

import React from 'react';
import type { PreprintedLabel, GeneralLabel } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Make props more generic to accept either type of label
interface LabelReportProps {
  labels: (PreprintedLabel | GeneralLabel)[];
}

export const LabelReport: React.FC<LabelReportProps> = ({ labels }) => {

  const getStatusVariant = (status: 'available' | 'used' | 'void') => {
    switch (status) {
      case 'available': return 'default';
      case 'used': return 'success';
      case 'void': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <div className="my-4">
        <ScrollArea className="h-96 border rounded-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>ID Etiqueta</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha Creación</TableHead>
                        <TableHead>Fecha Uso</TableHead>
                        <TableHead>Usada Por</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {labels.map(label => (
                        <TableRow key={label.id}>
                            <TableCell className="font-mono">{label.id}</TableCell>
                            <TableCell>
                                <Badge variant={getStatusVariant(label.status)} className="capitalize">{label.status}</Badge>
                            </TableCell>
                            <TableCell>{new Date(label.createdAt).toLocaleString()}</TableCell>
                            <TableCell>{label.usedAt ? new Date(label.usedAt).toLocaleString() : '-'}</TableCell>
                            <TableCell>{'usedBy' in label ? label.usedBy || '-' : '-'}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
             {labels.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No hay etiquetas para mostrar.</p>
            )}
        </ScrollArea>
    </div>
  );
};
