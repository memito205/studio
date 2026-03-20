
"use client";

import React from 'react';
import type { DiscardedRecord } from '@/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface DiscardedRecordsViewerProps {
  discardedRecords: DiscardedRecord[];
}

export const DiscardedRecordsViewer: React.FC<DiscardedRecordsViewerProps> = ({ discardedRecords }) => {
  if (!discardedRecords || discardedRecords.length === 0) {
    return null;
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <div className="flex items-center gap-3">
            <AlertTriangle className="text-destructive h-6 w-6" />
            <CardTitle>Registros Descartados ({discardedRecords.length})</CardTitle>
        </div>
        <CardDescription>
          Los siguientes registros se omitieron del cálculo debido a datos faltantes o inválidos. Revíselos para asegurar la integridad de los datos de origen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>Mostrar/Ocultar {discardedRecords.length} Registros Descartados</AccordionTrigger>
            <AccordionContent>
                <div className="max-h-80 overflow-y-auto mt-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Razón del Descarte</TableHead>
                                <TableHead>Datos de la Fila</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {discardedRecords.map((record, index) => (
                                <TableRow key={index}>
                                    <TableCell className="font-medium text-destructive">{record.reason}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground font-mono">
                                        {Object.entries(record.rowData).map(([key, value]) => `${key}: ${value}`).join(' | ')}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};
