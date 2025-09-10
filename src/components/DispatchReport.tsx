
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { ArrowLeft, Printer } from 'lucide-react';
import type { DispatchSessionInfo, BoxToDispatch } from '@/types';

interface DispatchReportProps {
  sessionInfo: DispatchSessionInfo;
  boxes: BoxToDispatch[];
  onReturn: () => void;
}

export const DispatchReport: React.FC<DispatchReportProps> = ({ sessionInfo, boxes, onReturn }) => {
    
  const handlePrint = () => {
    window.print();
  };

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
                
                <h3 className="font-semibold mb-2">Detalle de Cajas:</h3>
                <div className="border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Cód. Etiqueta (Caja)</TableHead>
                                <TableHead>Pedido</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right">Cant. Unidades</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {boxes.map((box, index) => (
                                <TableRow key={box.labelId}>
                                    <TableCell>{index + 1}</TableCell>
                                    <TableCell className="font-mono">{box.labelId}</TableCell>
                                    <TableCell>{box.orderId}</TableCell>
                                    <TableCell>{box.customer}</TableCell>
                                    <TableCell className="text-right font-medium">{box.totalItems}</TableCell>
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
