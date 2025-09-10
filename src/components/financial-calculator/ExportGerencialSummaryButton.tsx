"use client";

import React from "react";
import * as XLSX from "xlsx";
import type { GeneralSummary } from "@/types";
import { Button } from "@/components/ui/button";

const ExportGerencialSummaryButton: React.FC<{ summary: GeneralSummary | null }> = ({ summary }) => {
  
  const handleExportSummary = () => {
    if (!summary) return;

    // Sheet 1: Main Summary
    const mainSummaryData = [
      { Métrica: "Total de Créditos Procesados", Valor: summary.totalCredits },
      { Métrica: "Valor Promedio de Crédito (Capital)", Valor: summary.averageValorCredito },
      { Métrica: "Total Colocado (Capital)", Valor: summary.totalValorCredito },
      { Métrica: "Total Administración (Aval)", Valor: summary.totalVrAdmon },
      { Métrica: "Total IVA Administración", Valor: summary.totalIvaAdmon },
      { Métrica: "Total Intereses Generados", Valor: summary.totalInterestPaid },
      { Métrica: "Total IVA Financiero", Valor: summary.totalIvaFinancPaid },
      { Métrica: "Costo Financiero Total por Gracia", Valor: summary.totalGracePeriodCost },
      { Métrica: "Modalidad Quincenal (%)", Valor: `${summary.quincenalPercentage.toFixed(2)}%` },
      { Métrica: "Modalidad Mensual (%)", Valor: `${summary.mensualPercentage.toFixed(2)}%` },
    ];
    
    // Sheet 2: Grace Period Cost Breakdown
    const graceBreakdownData = Object.entries(summary.overallMonthlyGraceCostBreakdown)
        .map(([month, data]) => ({
            "Mes": month,
            "Costo Gracia Total": data.total,
            "Costo Gracia Quincenal": data.quincenal,
            "Costo Gracia Mensual": data.mensual,
            "Costo Gracia Otro": data.other,
        }))
        .sort((a, b) => a.Mes.localeCompare(b.Mes));

    const workbook = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(mainSummaryData);
    const wsGrace = XLSX.utils.json_to_sheet(graceBreakdownData);

    // Auto-fit columns for summary sheet
    const summaryFit = [
      { wch: "Total de Créditos Procesados".length + 5 },
      { wch: 20 }
    ];
    wsSummary['!cols'] = summaryFit;
    
    // Auto-fit columns for grace breakdown sheet
    const graceFit = [
      { wch: "Mes".length + 5 },
      { wch: "Costo Gracia Total".length + 5 },
      { wch: "Costo Gracia Quincenal".length + 5 },
      { wch: "Costo Gracia Mensual".length + 5 },
      { wch: "Costo Gracia Otro".length + 5 },
    ];
    wsGrace['!cols'] = graceFit;

    XLSX.utils.book_append_sheet(workbook, wsSummary, "Resumen");
    XLSX.utils.book_append_sheet(workbook, wsGrace, "Detalle de Costo por Gracia");
    XLSX.writeFile(workbook, "resumen_gerencial.xlsx");
  };

  return (
    <Button onClick={handleExportSummary} disabled={!summary}>
      Exportar Resumen Gerencial (Excel)
    </Button>
  );
};

export default ExportGerencialSummaryButton;
