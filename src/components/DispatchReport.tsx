
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { ArrowLeft, Printer, Download } from 'lucide-react';
import type { DispatchSessionInfo, BoxToDispatch } from '@/types';
import * as XLSX from 'xlsx';

interface DispatchReportProps {
  sessionInfo: DispatchSessionInfo;
  boxes: BoxToDispatch[];
  onReturn: () => void;
}

export const DispatchReport: React.FC<DispatchReportProps> = ({ sessionInfo, boxes, onReturn }) => {
    
  const handlePrint = () => {
    window.print();
  };

  const flattenBoxes = () => {
      const flattened: any[] = [];
      boxes.forEach(box => {
          if (box.items && box.items.length > 0) {
              box.items.forEach(item => {
                  flattened.push({
                      labelId: box.labelId,
                      unitId: box.unitId,
                      orderId: box.orderId,
                      customer: box.customer,
                      referencia: item.referencia,
                      cantidad: item.cantidad
                  });
              });
          } else {
              flattened.push({
                  labelId: box.labelId,
                  unitId: box.unitId,
                  orderId: box.orderId,
                  customer: box.customer,
                  referencia: 'N/A',
                  cantidad: box.totalItems
              });
          }
      });
      return flattened;
  };

  const handleDownloadExcel = () => {
      const rows = flattenBoxes().map(r => ({
          'Caja ID': r.unitId || '',
          'Etiqueta': r.labelId,
          'Referencia': r.referencia,
          'Cantidad': r.cantidad,
          'Pedido / Orden': r.orderId,
          'Cliente': r.customer,
      }));
      
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Despacho");
      XLSX.writeFile(wb, `Resumen_Despacho_${sessionInfo.id?.substring(0,6) || 'Doc'}.xlsx`);
  };

  const rowsToPrint = flattenBoxes();

  const totalBoxes = boxes.length;
  const totalUnits = boxes.reduce((sum, box) => sum + box.totalItems, 0);

  return (
    <div className="space-y-6 print:space-y-4 print:p-0">
        <div className="flex justify-between items-center print:hidden">
            <h1 className="text-3xl font-bold">Relación de Despacho</h1>
            <div className="flex gap-2">
                <Button variant="outline" onClick={onReturn}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver
                </Button>
                <Button onClick={handleDownloadExcel} variant="outline" className="border-primary/20 text-primary hover:bg-primary/10">
                    <Download className="mr-2 h-4 w-4" /> Excel
                </Button>
                <Button onClick={handlePrint}>
                    <Printer className="mr-2 h-4 w-4" /> Imprimir
                </Button>
            </div>
        </div>

        <Card id="dispatch-report-content" className="border-2 print:border-none print:shadow-none">
            <CardHeader className="text-center">
                <CardTitle className="text-2xl">RELACIÓN DE DESPACHO</CardTitle>
                <CardDescription>Fecha: {new Date(sessionInfo.createdAt!).toLocaleDateString('es-CO')}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 mb-6 text-sm border-y py-4">
                    <p><strong>Placa Camión:</strong> {sessionInfo.truckPlate}</p>
                    <p><strong>Conductor:</strong> {sessionInfo.driverName}</p>
                    <p><strong>Precinto:</strong> {sessionInfo.sealNumber}</p>
                </div>
                
                <h3 className="font-semibold mb-2">Detalle de Artículos:</h3>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Pedido/Cliente</TableHead>
                                <TableHead>Referencia</TableHead>
                                <TableHead className="text-right">Cantidad</TableHead>
                                <TableHead>Caja #</TableHead>
                                <TableHead>Etiqueta</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rowsToPrint.map((row, index) => (
                                <TableRow key={`${row.labelId}-${index}`}>
                                    <TableCell>{index + 1}</TableCell>
                                    <TableCell>
                                        <div className="font-semibold">{row.orderId}</div>
                                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{row.customer}</div>
                                    </TableCell>
                                    <TableCell className="font-medium">{row.referencia}</TableCell>
                                    <TableCell className="text-right font-medium">{row.cantidad}</TableCell>
                                    <TableCell>{row.unitId}</TableCell>
                                    <TableCell className="font-mono text-xs">{row.labelId}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <div className="mt-6 flex justify-end">
                    <div className="w-full max-w-sm space-y-2 text-right">
                         <div className="flex justify-between font-bold text-lg">
                            <span>TOTAL CAJAS:</span>
                            <span>{totalBoxes}</span>
                        </div>
                        <div className="flex justify-between font-bold text-lg border-t pt-2">
                            <span>TOTAL UNIDADES:</span>
                            <span>{totalUnits}</span>
                        </div>
                    </div>
                </div>

                <div className="mt-20 grid grid-cols-2 gap-8 text-center text-sm">
                    <div>
                        <hr className="border-t border-foreground mb-1"/>
                        <p>Firma y C.C. Conductor</p>
                    </div>
                     <div>
                        <hr className="border-t border-foreground mb-1"/>
                        <p>Firma y C.C. Quien Entrega</p>
                    </div>
                </div>

            </CardContent>
        </Card>
    </div>
  );
};
