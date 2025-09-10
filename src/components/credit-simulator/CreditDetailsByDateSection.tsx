
"use client";

import React, { useState } from "react";
import type { CreditCalculationResult } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Input } from "@/components/ui/input"; // Import Input for search
import CreditValueByDateChart from "@/components/financial-calculator/CreditValueByDateChart"; // Import the new chart component
import CreditAmortizationDetailDialog from "@/components/financial-calculator/CreditAmortizationDetailDialog"; // Import the new dialog component
import { Button } from "../ui/button";
import { Eye } from "lucide-react";


interface CreditDetailsByDateSectionProps {
  results: CreditCalculationResult[];
}

const CreditDetailsByDateSection: React.FC<CreditDetailsByDateSectionProps> = ({ results }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCredit, setSelectedCredit] = useState<CreditCalculationResult | null>(null);

  if (results.length === 0) {
    return null;
  }

  // Group results and calculate totals for each fechaCredito
  const dateSummaries = Object.entries(
    results.reduce((acc, credit) => {
      const date = credit.fechaCredito; // Use the formatted date string for grouping
      if (!acc[date]) {
        acc[date] = {
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
      acc[date].count++;
      acc[date].totalValorCredito += credit.valorCredito;
      acc[date].totalVrAdmon += credit.vrAdmon;
      acc[date].totalIvaAdmon += credit.ivaAdmon;
      acc[date].totalInterestPaid += credit.totalInterestPaid;
      acc[date].totalIvaFinancPaid += credit.totalIvaFinancPaid;
      acc[date].totalUncollectedAmountGracePeriod += credit.uncollectedAmountGracePeriod;
      acc[date].totalGracePeriodCost += credit.totalGracePeriodCost;
      (acc[date].credits as CreditCalculationResult[]).push(credit); // Add credit to the list
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
  ).sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime()); // Sort by date

  // Filter date summaries based on search term
  const filteredDateSummaries = dateSummaries.filter(([dateName]) =>
    dateName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate overall totals for the footer (based on filtered data)
  const overallTotals = filteredDateSummaries.reduce((acc, [, totals]) => {
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
      <CreditValueByDateChart results={results} /> {/* Chart uses all results */}

      <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">Resumen por Fecha de Crédito</CardTitle>
          <div className="mt-4">
            <Input
              placeholder="Buscar por Fecha de Crédito..."
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
                  <TableHead className="text-left text-gray-700 dark:text-gray-300">Fecha de Crédito</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Créditos</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Valor Crédito</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Intereses</TableHead>
                  <TableHead className="text-right text-gray-700 dark:text-gray-300">Costo Gracia</TableHead>
                  {/* Remove Acciones from header, it's part of the row now */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDateSummaries.length > 0 ? (
                  filteredDateSummaries.map(([dateName, totals]) => (
                    <React.Fragment key={dateName}>
                      <TableRow className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <TableCell className="font-medium">{dateName}</TableCell>
                        <TableCell className="text-right">{totals.count}</TableCell>
                        <TableCell className="text-right">${totals.totalValorCredito.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">${totals.totalInterestPaid.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right font-bold text-red-500">${totals.totalGracePeriodCost.toLocaleString('es-CO')}</TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-4 text-gray-500 dark:text-gray-400">
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

export default CreditDetailsByDateSection;
