
"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CreditCalculationResult } from "@/types";

interface CreditAmortizationDetailDialogProps {
  credit: CreditCalculationResult | null;
  isOpen: boolean;
  onClose: () => void;
}

const CreditAmortizationDetailDialog: React.FC<CreditAmortizationDetailDialogProps> = ({ credit, isOpen, onClose }) => {
  if (!credit) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-blue-700 dark:text-blue-400">
            Detalle de Amortización para Crédito: {credit.creditId}
          </DialogTitle>
          <DialogDescription className="text-gray-600 dark:text-gray-400">
            Punto de Venta: {credit.puntoDeVenta} | Documento: {credit.documento} | Fecha: {credit.fechaCredito}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-2 text-sm">
          <p><strong>Valor Crédito:</strong> ${credit.valorCredito.toLocaleString('es-CO')}</p>
          <p><strong>Modalidad de Pago:</strong> {credit.modalidadPago}</p>
          <p><strong>Número de Cuotas:</strong> {credit.numCuotas}</p>
          <p><strong>Tasa de Interés:</strong> {(credit.tasaInteres * 100).toFixed(3)}%</p>
          <p><strong>Valor Administración:</strong> ${credit.vrAdmon.toLocaleString('es-CO')}</p>
          <p><strong>IVA Administración:</strong> ${credit.ivaAdmon.toLocaleString('es-CO')}</p>
          <p><strong>Costo Financiero Total (Intereses):</strong> ${credit.totalInterestPaid.toLocaleString('es-CO')}</p>
          <p><strong>Total IVA Financiero:</strong> ${credit.totalIvaFinancPaid.toLocaleString('es-CO')}</p>
          <p><strong>Monto No Recaudado (Gracia):</strong> ${credit.uncollectedAmountGracePeriod.toLocaleString('es-CO')}</p>
           <p className="text-red-600 font-bold"><strong>Costo Financiero Total por Gracia:</strong> ${credit.totalGracePeriodCost.toLocaleString('es-CO')}</p>
          <p><strong>Total a Pagar (Cuotas):</strong> ${credit.totalValorPagar.toLocaleString('es-CO')}</p>
        </div>
        <div className="overflow-x-auto mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuota</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Valor Cuota</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Financiación</TableHead>
                <TableHead className="text-right">IVA Financ.</TableHead>
                <TableHead className="text-right">Aval</TableHead>
                <TableHead className="text-right">IVA Aval</TableHead>
                 <TableHead className="text-right text-red-500">Costo Gracia por Cuota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credit.amortizationTable.map((row, index) => (
                <TableRow key={index}>
                  <TableCell>{row.cuota}</TableCell>
                  <TableCell>{row.fecha}</TableCell>
                  <TableCell className="text-right">${row.valorCuota.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${row.capital.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${row.financiacion.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${row.ivaFinanc.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${row.aval.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${row.ivaAval.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right text-red-500">${row.gracePeriodCostPerInstallment.toLocaleString('es-CO')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreditAmortizationDetailDialog;
