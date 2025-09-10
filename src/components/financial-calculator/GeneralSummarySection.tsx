"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CalendarDays, Wallet, DollarSign, PiggyBank, TrendingUp, Eye } from "lucide-react"; 
import type { GeneralSummary, CreditCalculationResult } from "@/types";
import PaymentModalityChart from "@/components/financial-calculator/PaymentModalityChart"; 
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table"; 
import CreditAmortizationDetailDialog from "@/components/financial-calculator/CreditAmortizationDetailDialog";
import { CreditListDialog } from "./CreditListDialog";
import { Button } from "../ui/button";

interface GeneralSummarySectionProps {
  summary: GeneralSummary;
  results: CreditCalculationResult[];
}

const GeneralSummarySection: React.FC<GeneralSummarySectionProps> = ({ summary, results }) => {
  const [selectedCreditsForDialog, setSelectedCreditsForDialog] = useState<CreditCalculationResult[]>([]);
  const [isCreditListOpen, setIsCreditListOpen] = useState(false);
  const [selectedCreditForAmortization, setSelectedCreditForAmortization] = useState<CreditCalculationResult | null>(null);

  const totalCreditAmount = summary.totalValorCredito + summary.totalVrAdmon + summary.totalIvaAdmon + summary.totalInterestPaid + summary.totalIvaFinancPaid;
  
  const allInstallmentCounts = new Set([
    ...Object.keys(summary.quincenalInstallmentCounts).map(Number),
    ...Object.keys(summary.mensualInstallmentCounts).map(Number),
  ]);
  const sortedInstallmentCounts = Array.from(allInstallmentCounts).sort((a, b) => a - b);

  const handleViewMonthDetails = (monthKey: string) => {
    const creditsForMonth = results.filter(
      (credit) => credit.monthlyGraceCostBreakdown && credit.monthlyGraceCostBreakdown[monthKey]
    );
    setSelectedCreditsForDialog(creditsForMonth);
    setIsCreditListOpen(true);
  };
  
  const handleViewAmortization = (credit: CreditCalculationResult) => {
      setSelectedCreditForAmortization(credit);
  }

  return (
    <>
      <Card className="mb-6 shadow-lg border-gray-200 dark:border-gray-700">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">Resumen General de Costos de Campaña</CardTitle>
        </CardHeader>
        <CardContent>
          <div id="gerencial-summary-content" className="p-4 bg-white dark:bg-gray-900"> 
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 shadow-md hover:shadow-lg transition-all duration-200 min-h-[180px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300 text-wrap">
                    Total de Créditos Procesados
                  </CardTitle>
                  <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-blue-800 dark:text-blue-200 break-words">
                    {summary.totalCredits}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800 shadow-md hover:shadow-lg transition-all duration-200 min-h-[180px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-cyan-700 dark:text-cyan-300 text-wrap">
                    Valor Promedio de Crédito (Capital)
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-cyan-800 dark:text-cyan-200 break-words">
                    ${summary.averageValorCredito.toLocaleString('es-CO')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    Promedio del valor inicial del crédito, sin costos adicionales.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 shadow-md hover:shadow-lg transition-all duration-200 min-h-[180px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300 text-wrap">
                    Costo Total del Crédito (Valor + Aval + IVA + Intereses + IVA Intereses)
                  </CardTitle>
                  <PiggyBank className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-purple-800 dark:text-purple-200 break-words">
                    ${totalCreditAmount.toLocaleString('es-CO')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    Valor Crédito: ${summary.totalValorCredito.toLocaleString('es-CO')}
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    Valor Administración: ${summary.totalVrAdmon.toLocaleString('es-CO')}
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    IVA Administración: ${summary.totalIvaAdmon.toLocaleString('es-CO')}
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    Intereses: ${summary.totalInterestPaid.toLocaleString('es-CO')}
                    <span className="italic opacity-80"> (Intereses del crédito sin incluir gracia)</span>
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    IVA Intereses: ${summary.totalIvaFinancPaid.toLocaleString('es-CO')}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-all duration-200 min-h-[180px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300 text-wrap">
                    Monto No Recaudado (Gracia)
                  </CardTitle>
                  <Wallet className="h-4 w-4 text-red-600 dark:text-red-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-red-800 dark:text-red-200 break-words">
                    ${(summary.uncollectedAmountGracePeriod || 0).toLocaleString('es-CO')}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-all duration-200 min-h-[180px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300 text-wrap">
                    Costo Financiero Total por Gracia
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-red-600 dark:text-red-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-red-800 dark:text-red-200 break-words">
                    ${(summary.totalGracePeriodCost || 0).toLocaleString('es-CO')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    (Costo por no pagar las primeras cuotas)
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 shadow-md hover:shadow-lg transition-all duration-200 h-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300 text-wrap">
                    Créditos Quincenales
                  </CardTitle>
                  <CalendarDays className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-purple-800 dark:text-purple-200 break-words">
                    {summary.paymentModalityDistribution.quincenal}
                  </div>
                  {summary.totalCredits > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 break-words">
                      ({summary.quincenalPercentage.toFixed(2)}%)
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card className="bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 shadow-md hover:shadow-lg transition-all duration-200 h-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-300 text-wrap">
                    Créditos Mensuales
                  </CardTitle>
                  <CalendarDays className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-xl font-bold text-orange-800 dark:text-orange-200 break-words">
                    {summary.paymentModalityDistribution.mensual}
                  </div>
                  {summary.totalCredits > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 break-words">
                      ({summary.mensualPercentage.toFixed(2)}%)
                    </p>
                  )}
                </CardContent>
              </Card>
              {summary.paymentModalityDistribution.other > 0 && (
                <Card className="bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800 shadow-md hover:shadow-lg transition-all duration-200 h-full">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300 text-wrap">
                      Otras Modalidades
                    </CardTitle>
                    <CalendarDays className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-xl font-bold text-gray-800 dark:text-gray-200 break-words">
                      {summary.paymentModalityDistribution.other}
                    </div>
                    {summary.totalCredits > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">
                        ({summary.otherPercentage.toFixed(2)}%)
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
            {summary.totalCredits > 0 && (
              <div className="mt-8">
                <PaymentModalityChart summary={summary} />
              </div>
            )}

            {summary.totalCredits > 0 && (sortedInstallmentCounts.length > 0) && (
              <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-center text-blue-700 dark:text-blue-400">
                    Distribución de Cantidad de Cuotas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-gray-50 dark:bg-gray-800">
                        <TableRow>
                          <TableHead className="text-left text-gray-700 dark:text-gray-300">Cuotas</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Quincenal</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Participación (%)</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Mensual</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Participación (%)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedInstallmentCounts.map((numCuotas) => {
                          const quincenalCount = summary.quincenalInstallmentCounts[numCuotas] || 0;
                          const mensualCount = summary.mensualInstallmentCounts[numCuotas] || 0;

                          const quincenalParticipation = summary.paymentModalityDistribution.quincenal > 0
                            ? (quincenalCount / summary.paymentModalityDistribution.quincenal) * 100
                            : 0;
                          const mensualParticipation = summary.paymentModalityDistribution.mensual > 0
                            ? (mensualCount / summary.paymentModalityDistribution.mensual) * 100
                            : 0;

                          return (
                            <TableRow key={numCuotas}>
                              <TableCell className="font-medium">{numCuotas}</TableCell>
                              <TableCell className="text-right">{quincenalCount}</TableCell>
                              <TableCell className="text-right">{quincenalParticipation.toFixed(2)}%</TableCell>
                              <TableCell className="text-right">{mensualCount}</TableCell>
                              <TableCell className="text-right">{mensualParticipation.toFixed(2)}%</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {summary.totalCredits > 0 && summary.overallMonthlyGraceCostBreakdown && Object.keys(summary.overallMonthlyGraceCostBreakdown).length > 0 && (
              <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-center text-blue-700 dark:text-blue-400">
                    Detalle de Costo por Gracia Mensual
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-gray-50 dark:bg-gray-800">
                        <TableRow>
                          <TableHead className="text-left text-gray-700 dark:text-gray-300">Mes</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Base No Recaudada (Nuevas Cuotas)</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Base que Generó Costo (Capital + Interés Acum.)</TableHead>
                          <TableHead className="text-right text-gray-700 dark:text-gray-300">Costo Generado</TableHead>
                          <TableHead className="text-center text-gray-700 dark:text-gray-300">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(summary.overallMonthlyGraceCostBreakdown)
                          .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
                          .map(([month, data]) => (
                            <TableRow key={month}>
                              <TableCell className="font-medium">{month}</TableCell>
                              <TableCell className="text-right">${(data.baseAmount || 0).toLocaleString('es-CO', {maximumFractionDigits: 2})}</TableCell>
                              <TableCell className="text-right text-gray-500 dark:text-gray-400">${(data.compoundingBase || 0).toLocaleString('es-CO', {maximumFractionDigits: 2})}</TableCell>
                              <TableCell className="text-right font-bold">${data.total.toLocaleString('es-CO', {maximumFractionDigits: 2})}</TableCell>
                              <TableCell className="text-center">
                                <Button variant="ghost" size="icon" onClick={() => handleViewMonthDetails(month)} title={`Ver detalle de los créditos para ${month}`}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                      <TableFooter className="bg-blue-100 dark:bg-blue-900/30 font-bold text-blue-800 dark:text-blue-200">
                          <TableRow>
                              <TableCell colSpan={3} className="text-right">Total Costo Generado</TableCell>
                              <TableCell className="text-right">${Object.values(summary.overallMonthlyGraceCostBreakdown).reduce((sum, data) => sum + data.total, 0).toLocaleString('es-CO', {maximumFractionDigits: 2})}</TableCell>
                              <TableCell></TableCell>
                          </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>
      
      <CreditListDialog
          isOpen={isCreditListOpen}
          onClose={() => setIsCreditListOpen(false)}
          credits={selectedCreditsForDialog}
          onViewAmortization={handleViewAmortization}
      />

      {selectedCreditForAmortization && (
        <CreditAmortizationDetailDialog
          credit={selectedCreditForAmortization}
          isOpen={!!selectedCreditForAmortization}
          onClose={() => setSelectedCreditForAmortization(null)}
        />
      )}
    </>
  );
};

export default GeneralSummarySection;
