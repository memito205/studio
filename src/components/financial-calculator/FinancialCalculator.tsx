
"use client";

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { calculateAmortization, GeneralSummary, CreditCalculationResult, parseFlexibleDate, convertAnnualToMonthlyRate } from "@/services/creditCalculations";
import { FinancialCalculatorUI } from './FinancialCalculatorUI';
import { DiscardedRecordsViewer } from "@/components/discarded-records-viewer";
import { showError, showSuccess } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { DiscardedRecord } from "@/types";
import { format, addMonths } from "date-fns";
import { excelSerialDateToJSDate } from "@/lib/parsingUtils";


interface FinancialCalculatorProps {
  onReturn?: () => void;
}

export const FinancialCalculator: React.FC<FinancialCalculatorProps> = ({ onReturn }) => {
  const [calculationResults, setCalculationResults] = useState<CreditCalculationResult[]>([]);
  const [generalSummary, setGeneralSummary] = useState<GeneralSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [excelRawData, setExcelRawData] = useState<any[] | null>(null);
  const [discardedRecords, setDiscardedRecords] = useState<DiscardedRecord[]>([]);
  
  const DEFAULT_GRACE_PERIOD_ANNUAL_RATE = 0.1062; 

  const initialMonthlyGraceRates = () => {
    const today = new Date();
    const currentMonthKey = format(today, 'yyyy-MM');
    const nextMonthKey = format(addMonths(today, 1), 'yyyy-MM');
    return {
      [currentMonthKey]: DEFAULT_GRACE_PERIOD_ANNUAL_RATE,
      [nextMonthKey]: DEFAULT_GRACE_PERIOD_ANNUAL_RATE,
    };
  };

  const [monthlyGraceRates, setMonthlyGraceRates] = useState<Record<string, number>>(initialMonthlyGraceRates);

  const processData = (data: any[], currentMonthlyGraceRates: Record<string, number>) => {
    if (data.length === 0) {
      showError("El archivo Excel está vacío o no contiene datos válidos.");
      setIsLoading(false);
      return;
    }

    const newDiscardedRecords: DiscardedRecord[] = [];
    const requiredColumns = [
      "# credito", "punto de venta", "documento", "valor", "modalidadPago",
      "numCuotas", "vrAdmon", "ivaAdmon", "tasa de interes", "fecha"
    ];

    const firstRowKeys = Object.keys(data[0] || {});
    const missingHeaders = requiredColumns.filter(col => !firstRowKeys.includes(col));

    if (missingHeaders.length > 0) {
      showError(`El archivo Excel no contiene todas las columnas requeridas. Faltan: ${missingHeaders.join(", ")}. Por favor, verifica el formato.`);
      setIsLoading(false);
      return;
    }

    const results: CreditCalculationResult[] = [];
    let totalCredits = 0;
    let totalInterestPaidOverall = 0;
    let totalIvaFinancOverall = 0;
    let totalUncollectedAmountGracePeriodOverall = 0;
    let totalValorCreditoOverall = 0;
    let totalVrAdmonOverall = 0;
    let totalIvaAdmonOverall = 0;
    let totalValorCreditoSumForAverage = 0;
    const paymentModalityDistribution = { quincenal: 0, mensual: 0, other: 0 };
    const quincenalInstallmentCounts: Record<number, number> = {};
    const mensualInstallmentCounts: Record<number, number> = {};
    let totalGracePeriodCostOverall = 0;
    const overallMonthlyGraceCostBreakdown: Record<string, { total: number; baseAmount: number; compoundingBase: number; quincenal: number; mensual: number; other: number }> = {};

    const DEFAULT_IVA_FINANCIERO_RATE_EXCEL = 0.19;


    data.forEach((row, index) => {
      const creditId = row["# credito"] || `Fila ${index + 2}`;
      
      const valorCredito = parseFloat(String(row.valor).replace(",", "."));
      const modalidadPago = String(row.modalidadPago);
      const numCuotas = parseInt(String(row.numCuotas));
      const vrAdmon = parseFloat(String(row.vrAdmon).replace(",", "."));
      const ivaAdmon = parseFloat(String(row.ivaAdmon).replace(",", "."));
      
      let fechaCredito: string;
      if (typeof row.fecha === 'number') {
        const date = excelSerialDateToJSDate(row.fecha);
        fechaCredito = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      } else {
        fechaCredito = String(row.fecha);
      }

      const puntoDeVenta = String(row["punto de venta"] || '').trim();
      const documento = String(row.documento || '').trim();

      const tasaInteresStr = String(row["tasa de interes"]).replace(",", "."); 
      const tasaInteres = parseFloat(tasaInteresStr);
      
      let reason = '';
      if (isNaN(valorCredito) || valorCredito < 0) reason = 'Valor de crédito inválido';
      else if (!modalidadPago || modalidadPago.trim() === '') reason = 'Modalidad de pago vacía';
      else if (isNaN(numCuotas)) reason = 'Número de cuotas inválido';
      else if (isNaN(tasaInteres) || tasaInteres < 0) reason = 'Tasa de interés inválida';
      else if (isNaN(vrAdmon) || vrAdmon < 0) reason = 'Valor de administración inválido';
      else if (isNaN(ivaAdmon) || ivaAdmon < 0) reason = 'IVA de administración inválido';
      else if (!fechaCredito || fechaCredito.trim() === '' || !parseFlexibleDate(fechaCredito)) reason = `Fecha de crédito inválida: ${fechaCredito}`;
      else if (puntoDeVenta === '') reason = 'Punto de venta vacío';
      else if (documento === '') reason = 'Documento vacío';


      if (reason) {
          newDiscardedRecords.push({ reason, rowData: row });
          return; // Skip this row
      }

      if (numCuotas > 0) { 
        
        const { amortizationTable, totalValorPagar, totalInterestPaid, totalIvaFinancPaid, uncollectedAmountGracePeriod, totalGracePeriodCost, monthlyGraceCostBreakdown } = calculateAmortization(
          creditId,
          valorCredito,
          modalidadPago,
          numCuotas,
          tasaInteres,
          vrAdmon,
          ivaAdmon,
          fechaCredito,
          DEFAULT_IVA_FINANCIERO_RATE_EXCEL,
          currentMonthlyGraceRates
        );
        
        if (amortizationTable.length > 0) {
          totalCredits++;
          totalInterestPaidOverall += totalInterestPaid;
          totalIvaFinancOverall += totalIvaFinancPaid;
          totalUncollectedAmountGracePeriodOverall += uncollectedAmountGracePeriod;
          totalGracePeriodCostOverall += totalGracePeriodCost;
          totalValorCreditoOverall += valorCredito;
          totalVrAdmonOverall += vrAdmon;
          totalIvaAdmonOverall += ivaAdmon;
          totalValorCreditoSumForAverage += valorCredito;

          results.push({
            creditId,
            puntoDeVenta,
            documento,
            fechaCredito,
            valorCredito,
            modalidadPago,
            numCuotas,
            tasaInteres,
            vrAdmon,
            ivaAdmon,
            amortizationTable,
            totalValorPagar,
            totalInterestPaid,
            totalIvaFinancPaid,
            uncollectedAmountGracePeriod,
            totalGracePeriodCost,
            monthlyGraceCostBreakdown,
          });

          if (monthlyGraceCostBreakdown) {
            Object.entries(monthlyGraceCostBreakdown).forEach(([monthKey, costs]) => {
              if (!overallMonthlyGraceCostBreakdown[monthKey]) {
                overallMonthlyGraceCostBreakdown[monthKey] = { total: 0, baseAmount: 0, compoundingBase: 0, quincenal: 0, mensual: 0, other: 0 };
              }
              overallMonthlyGraceCostBreakdown[monthKey].total += costs.total;
              overallMonthlyGraceCostBreakdown[monthKey].baseAmount += costs.baseAmount;
              overallMonthlyGraceCostBreakdown[monthKey].compoundingBase += costs.compoundingBase;
              overallMonthlyGraceCostBreakdown[monthKey].quincenal += costs.quincenal;
              overallMonthlyGraceCostBreakdown[monthKey].mensual += costs.mensual;
              overallMonthlyGraceCostBreakdown[monthKey].other += costs.other;
            });
          }

          const modality = String(row.modalidadPago).toLowerCase();
          if (modality.includes('quincenal')) {
            paymentModalityDistribution.quincenal++;
            quincenalInstallmentCounts[numCuotas] = (quincenalInstallmentCounts[numCuotas] || 0) + 1;
          } else if (modality.includes('mensual')) {
            paymentModalityDistribution.mensual++;
            mensualInstallmentCounts[numCuotas] = (mensualInstallmentCounts[numCuotas] || 0) + 1;
          } else {
            paymentModalityDistribution.other++;
          }
        }
      }
    });

    setDiscardedRecords(newDiscardedRecords);
    const quincenalPercentage = totalCredits > 0 ? (paymentModalityDistribution.quincenal / totalCredits) * 100 : 0;
    const mensualPercentage = totalCredits > 0 ? (paymentModalityDistribution.mensual / totalCredits) * 100 : 0;
    const otherPercentage = totalCredits > 0 ? (paymentModalityDistribution.other / totalCredits) * 100 : 0;
    const averageValorCredito = totalCredits > 0 ? totalValorCreditoSumForAverage / totalCredits : 0;

    setCalculationResults(results);
    setGeneralSummary({ 
      totalCredits, 
      paymentModalityDistribution, 
      quincenalPercentage,
      mensualPercentage,
      otherPercentage,
      totalInterestPaid: totalInterestPaidOverall, 
      totalGracePeriodCost: totalGracePeriodCostOverall,
      uncollectedAmountGracePeriod: totalUncollectedAmountGracePeriodOverall,
      totalValorCredito: totalValorCreditoOverall,
      totalVrAdmon: totalVrAdmonOverall,
      totalIvaAdmon: totalIvaAdmonOverall,
      totalIvaFinancPaid: totalIvaFinancOverall,
      averageValorCredito: averageValorCredito,
      quincenalInstallmentCounts: quincenalInstallmentCounts,
      mensualInstallmentCounts: mensualInstallmentCounts,
      overallMonthlyGraceCostBreakdown: overallMonthlyGraceCostBreakdown,
    });
    showSuccess(`Procesamiento completado. ${totalCredits} créditos procesados. ${newDiscardedRecords.length} descartados.`);
    setIsLoading(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
          setExcelRawData(json);
          processData(json, monthlyGraceRates);
        } catch (error) {
          showError("Error al leer o procesar el archivo Excel. Asegúrate de que sea un archivo válido.");
          setIsLoading(false);
        }
      };
      reader.onerror = (error) => {
        showError("Error al leer el archivo. Intenta de nuevo.");
        setIsLoading(false);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleRecalculate = () => {
    if (excelRawData) {
      setIsLoading(true);
      setDiscardedRecords([]); // Clear old discarded records before recalculating
      processData(excelRawData, monthlyGraceRates);
    } else {
      showError("No hay datos cargados para recalcular. Por favor, carga un archivo Excel primero.");
    }
  };

  return (
    <FinancialCalculatorUI
        onReturn={onReturn}
        isLoading={isLoading}
        onFileUpload={handleFileUpload}
        discardedRecords={discardedRecords}
        monthlyGraceRates={monthlyGraceRates}
        onRatesChange={setMonthlyGraceRates}
        onRecalculate={handleRecalculate}
        hasDataToRecalculate={!!excelRawData}
        calculationResults={calculationResults}
        generalSummary={generalSummary}
    />
  );
};
