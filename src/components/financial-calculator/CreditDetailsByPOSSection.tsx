
"use client";

import React, { useState } from "react";
import type { CreditCalculationResult } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Input } from "@/components/ui/input"; // Import Input for search
import CreditValueByPOSChart from "@/components/financial-calculator/CreditValueByPOSChart"; // Import the new chart component
import CreditAmortizationDetailDialog from "@/components/financial-calculator/CreditAmortizationDetailDialog"; // Import the new dialog component
import { Button } from "../ui/button";
import { Eye } from "lucide-react";


interface CreditDetailsByPOSSectionProps {
  results: CreditCalculationResult[];
}

const CreditDetailsByPOSSection: React.FC<CreditDetailsByPOSSectionProps> = ({ results }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCredit, setSelectedCredit] = useState<CreditCalculationResult | null>(null);

  if (results.length === 0) {
    return null;
  }

  // Group results and calculate totals for each puntoDeVenta
  const posSummaries = Object.entries(
    results.reduce((acc, credit) => {
      const pos = credit.puntoDeVenta;
      if (!acc[pos]) {
        acc[pos] = {
          count: 0,
          totalValorCredito: 0,
          totalVrAdmon: 0,
          totalIvaAdmon: 0,
          totalInterestPaid: 0,
          totalIvaFinancPaid: 0,
          totalUncollectedAmountGracePeriod: 0,
          totalGracePeriodCost: 0,
          credits: [], // Store individual credits for detailed view
        };
      }
      acc[pos].count++;
      acc[pos].totalValorCredito += credit.valorCredito;
      acc[pos].totalVrAdmon += credit.vrAdmon;
      acc[pos].totalIvaAdmon += credit.ivaAdmon;
      acc[pos].totalInterestPaid += credit.totalInterestPaid;
      acc[pos].totalIvaFinancPaid += credit.totalIvaFinancPaid;
      acc[pos].totalUncollectedAmountGracePeriod += credit.uncollectedAmountGracePeriod;
      acc[pos].totalGracePeriodCost += credit.totalGracePeriodCost;
      (acc[pos].credits as CreditCalculationResult[]).push(credit); // Add credit to the list
      return acc;
    }, {} as Record<string, {
      count: number;
      totalValorCredito: number;
      totalVrAdmon: number;
      totalIvaAdmon: number;
      totalInterestPaid: number;
      totalIvaFinancPaid: number;
      totalUncollectedAmountGracePeriod: number;
      totalGracePeriodCost: number;
      credits: CreditCalculationResult[];
    }>)
  );

  // Filter POS summaries based on search term
  const filteredPosSummaries = posSummaries.filter(([posName]) =>
    posName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate overall totals for the footer (based on filtered data)
  const overallTotals = filteredPosSummaries.reduce((acc, [, totals]) => {
    acc.totalCredits += totals.count;
    acc.totalValorCredito += totals.totalValorCredito;
    acc.totalVrAdmon += totals.totalVrAdmon;
    acc.totalIvaAdmon += totals.totalIvaAdmon;
    acc.totalInterestPaid += totals.totalInterestPaid;
    acc.totalIvaFinancPaid += totals.totalIvaFinancPaid;
    acc.totalUncollectedAmountGracePeriod += totals.totalUncollectedAmountGracePeriod;
    acc.totalGracePeriodCost += totals.totalGracePeriodCost;
    return acc;
  }, {
    totalCredits: 0,
    totalValorCredito: 0,
    totalVrAdmon: 0,
    totalIvaAdmon: 0,
    totalInterestPaid: 0,
    totalIvaFinancPaid: 0,
    totalUncollectedAmountGracePeriod: 0,
    totalGracePeriodCost: 0,
  });

  const handleRowClick = (credit: CreditCalculationResult) => {
    setSelectedCredit(credit);
  };

  return (
    <>
      <CreditValueByPOSChart results={results} /> {/* Chart uses all results */}

      <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">Resumen por Punto de Venta</CardTitle>
          <div className="mt-4">
            <Input
              placeholder="Buscar por Punto de Venta..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm mx-auto"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50 dark:bg-gray-800">
                <TableRow>
                  <TableHead className="text-left text-gray-700 dark:text-gray-300">Punto de Venta</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Créditos</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Valor Crédito</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Intereses</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Costo Gracia</TableHead>
                  <TableHead className="text-center text-gray-700 dark:text-gray-300">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPosSummaries.length > 0 ? (
                  filteredPosSummaries.map(([posName, totals]) => (
                    <React.Fragment key={posName}>
                       <TableRow className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <TableCell className="font-medium">{posName}</TableCell>
                        <TableCell className="text-right">{totals.count}</TableCell>
                        <TableCell className="text-right">${totals.totalValorCredito.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">${totals.totalInterestPaid.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right font-bold text-red-500">${totals.totalGracePeriodCost.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-center">
                            <Button variant="ghost" size="icon" onClick={() => handleRowClick(totals.credits[0])} title="Ver detalle del primer crédito">
                                <Eye className="h-4 w-4" />
                            </Button>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-4 text-gray-500 dark:text-gray-400">
                      No se encontraron resultados para "{searchTerm}".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter className="bg-blue-100 dark:bg-blue-900/30 font-bold text-blue-800 dark:text-blue-200">
                <TableRow>
                  <TableCell>Total General</TableCell>
                  <TableCell className="text-right">{overallTotals.totalCredits}</TableCell>
                  <TableCell className="text-right">${overallTotals.totalValorCredito.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${overallTotals.totalInterestPaid.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right">${overallTotals.totalGracePeriodCost.toLocaleString('es-CO')}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedCredit && (
        <CreditAmortizationDetailDialog
          credit={selectedCredit}
          isOpen={!!selectedCredit}
          onClose={() => setSelectedCredit(null)}
        />
      )}
    </>
  );
};

export default CreditDetailsByPOSSection;
