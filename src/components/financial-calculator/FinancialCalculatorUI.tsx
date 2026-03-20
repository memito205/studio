
"use client";

import React, { useRef } from "react";
import jsPDF from "jspdf";
import autoTable from 'jspdf-autotable';
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import FileUploadSection from "@/components/financial-calculator/FileUploadSection";
import { DiscardedRecordsViewer } from "@/components/discarded-records-viewer";
import MonthlyGraceRateInput from "@/components/financial-calculator/MonthlyGraceRateInput";
import GeneralSummarySection from "@/components/financial-calculator/GeneralSummarySection";
import CreditDetailsByPOSSection from "@/components/financial-calculator/CreditDetailsByPOSSection";
import CreditDetailsByDateSection from "@/components/financial-calculator/CreditDetailsByDateSection";
import CreditDetailsByMonthSection from "@/components/financial-calculator/CreditDetailsByMonthSection";
import ExportToExcelButton from "@/components/financial-calculator/ExportToExcelButton";
import ExportGerencialSummaryButton from "@/components/financial-calculator/ExportGerencialSummaryButton";
import { showError, showSuccess } from "@/lib/toast";
import type { DiscardedRecord, CreditCalculationResult, GeneralSummary } from "@/types";

interface FinancialCalculatorUIProps {
  onReturn?: () => void;
  isLoading: boolean;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  discardedRecords: DiscardedRecord[];
  monthlyGraceRates: Record<string, number>;
  onRatesChange: (newRates: Record<string, number>) => void;
  onRecalculate: () => void;
  hasDataToRecalculate: boolean;
  calculationResults: CreditCalculationResult[];
  generalSummary: GeneralSummary | null;
}

export const FinancialCalculatorUI: React.FC<FinancialCalculatorUIProps> = ({
  onReturn,
  isLoading,
  onFileUpload,
  discardedRecords,
  monthlyGraceRates,
  onRatesChange,
  onRecalculate,
  hasDataToRecalculate,
  calculationResults,
  generalSummary,
}) => {

  const handleExportPdf = () => {
      if (!generalSummary) {
          showError("No hay datos de resumen para exportar.");
          return;
      }
      
      const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      const PADDING = 20;
      const docWidth = doc.internal.pageSize.getWidth();
      let y = PADDING;

      // Title
      doc.setFontSize(18);
      doc.text("Reporte Gerencial Financiero", docWidth / 2, y, { align: "center" });
      y += 30;

      // Main Summary
      doc.setFontSize(14);
      doc.text("Resumen General", PADDING, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [22, 163, 74] },
        body: [
            ["Total Créditos Procesados", generalSummary.totalCredits.toLocaleString('es-CO')],
            ["Valor Promedio de Crédito", `$${generalSummary.averageValorCredito.toLocaleString('es-CO')}`],
            ["Total Colocado (Capital)", `$${generalSummary.totalValorCredito.toLocaleString('es-CO')}`],
            ["Total Intereses Generados", `$${generalSummary.totalInterestPaid.toLocaleString('es-CO')}`],
            ["Costo Total por Gracia", `$${generalSummary.totalGracePeriodCost.toLocaleString('es-CO')}`],
            ["% Modalidad Quincenal", `${generalSummary.quincenalPercentage.toFixed(2)}%`],
            ["% Modalidad Mensual", `${generalSummary.mensualPercentage.toFixed(2)}%`],
        ],
        columns: [{ header: 'Métrica' }, { header: 'Valor' }],
      });
      y = (doc as any).lastAutoTable.finalY + 20;
      
      const addTableToPdf = (title: string, head: any[][], body: any[][]) => {
          if (y + 40 > doc.internal.pageSize.getHeight()) { // Check for page break
              doc.addPage();
              y = PADDING;
          }
          doc.setFontSize(14);
          doc.text(title, PADDING, y);
          y += 10;
          autoTable(doc, {
              startY: y,
              head,
              body,
              theme: 'striped',
              headStyles: { fillColor: [41, 128, 185] },
          });
          y = (doc as any).lastAutoTable.finalY + 20;
      }

      // POS Summary Table
      const posSummaries = Object.entries(
        calculationResults.reduce((acc, credit) => {
          const pos = credit.puntoDeVenta;
          if (!acc[pos]) acc[pos] = { count: 0, totalValorCredito: 0, totalInterestPaid: 0, totalGracePeriodCost: 0 };
          acc[pos].count++;
          acc[pos].totalValorCredito += credit.valorCredito;
          acc[pos].totalInterestPaid += credit.totalInterestPaid;
          acc[pos].totalGracePeriodCost += credit.totalGracePeriodCost;
          return acc;
        }, {} as Record<string, { count: number; totalValorCredito: number; totalInterestPaid: number; totalGracePeriodCost: number }>)
      );
      addTableToPdf(
          "Resumen por Punto de Venta",
          [['Punto de Venta', 'Créditos', 'Valor Crédito', 'Intereses', 'Costo Gracia']],
          posSummaries.map(([posName, totals]) => [
              posName,
              totals.count,
              `$${totals.totalValorCredito.toLocaleString('es-CO')}`,
              `$${totals.totalInterestPaid.toLocaleString('es-CO')}`,
              `$${totals.totalGracePeriodCost.toLocaleString('es-CO')}`,
          ])
      );
      
      // Date Summary Table
      const dateSummaries = Object.entries(
        calculationResults.reduce((acc, credit) => {
          const date = credit.fechaCredito;
          if (!acc[date]) acc[date] = { count: 0, totalValorCredito: 0, totalInterestPaid: 0, totalGracePeriodCost: 0 };
          acc[date].count++;
          acc[date].totalValorCredito += credit.valorCredito;
          acc[date].totalInterestPaid += credit.totalInterestPaid;
          acc[date].totalGracePeriodCost += credit.totalGracePeriodCost;
          return acc;
        }, {} as Record<string, { count: number; totalValorCredito: number; totalInterestPaid: number; totalGracePeriodCost: number }>)
      ).sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime());
       addTableToPdf(
          "Resumen por Fecha de Crédito",
          [['Fecha', 'Créditos', 'Valor Crédito', 'Intereses', 'Costo Gracia']],
          dateSummaries.map(([date, totals]) => [
              date,
              totals.count,
              `$${totals.totalValorCredito.toLocaleString('es-CO')}`,
              `$${totals.totalInterestPaid.toLocaleString('es-CO')}`,
              `$${totals.totalGracePeriodCost.toLocaleString('es-CO')}`,
          ])
      );

      doc.save("Reporte_Financiero_Completo.pdf");
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-7xl">
      {onReturn && (
        <Button onClick={onReturn} variant="outline" className="mb-4 no-print">
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </Button>
      )}
      <h1 className="text-3xl font-bold mb-6 text-center text-blue-700 dark:text-blue-400">Calculador de Costo Financiero</h1>

      <div className="no-print">
        <FileUploadSection onFileUpload={onFileUpload} isLoading={isLoading} />
        
        <DiscardedRecordsViewer discardedRecords={discardedRecords} />

        <div className="mb-6 p-4 border rounded-lg shadow-sm bg-gray-50 dark:bg-gray-800">
          <MonthlyGraceRateInput
            monthlyRates={monthlyGraceRates}
            onRatesChange={onRatesChange}
            disabled={isLoading}
          />
          <Button 
            onClick={onRecalculate} 
            disabled={isLoading || !hasDataToRecalculate} 
            className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white mt-4"
          >
            {isLoading ? "Recalculando..." : "Recalcular Costos con Tasas Actualizadas"}
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <ExportToExcelButton results={calculationResults} />
          <ExportGerencialSummaryButton summary={generalSummary} />
          {generalSummary && generalSummary.totalCredits > 0 && (
            <Button onClick={handleExportPdf}>
              Exportar Reporte Completo (PDF)
            </Button>
          )}
        </div>
      </div>

      <div id="full-report-content">
          {generalSummary && <GeneralSummarySection summary={generalSummary} results={calculationResults} />}
          {calculationResults.length > 0 && <CreditDetailsByPOSSection results={calculationResults} />}
          {calculationResults.length > 0 && <CreditDetailsByDateSection results={calculationResults} />}
          {calculationResults.length > 0 && <CreditDetailsByMonthSection results={calculationResults} />}
      </div>
    </div>
  );
};
