

import { format, parse, addMonths, addDays, differenceInDays, setDate, setMonth, getYear, getDate, setYear, lastDayOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { showError } from "@/lib/toast";
import type { AmortizationRow, CreditCalculationResult } from "@/types";
import { parseFlexibleDate, excelSerialDateToJSDate } from "@/lib/parsingUtils";

// Function to convert annual effective rate to monthly effective rate (now exported)
export const convertAnnualToMonthlyRate = (annualRate: number): number => {
  return Math.pow(1 + annualRate, 1/12) - 1;
};

export const calculateAmortization = (
  creditId: string,
  valorCredito: number,
  modalidadPago: string,
  numCuotas: number,
  tasaInteresMensual: number,
  vrAdmonTotal: number,
  ivaAdmonTotal: number,
  fechaCreditoStr: string,
  ivaFinancieroRate: number,
  gracePeriodMonthlyRates: Record<string, number>
): { 
    amortizationTable: AmortizationRow[]; 
    totalValorPagar: number; 
    totalInterestPaid: number; 
    totalGracePeriodCost: number; 
    totalIvaFinancPaid: number; 
    monthlyGraceCostBreakdown: Record<string, { total: number; baseAmount: number; compoundingBase: number; quincenal: number; mensual: number; other: number }>;
    uncollectedAmountGracePeriod: number;
} => {
  const amortizationTable: AmortizationRow[] = [];
  let totalValorPagar = 0;
  let totalInterestAccumulated = 0;
  let totalIvaFinancAccumulated = 0;
  let uncollectedAmountGracePeriod = 0;
  const monthlyGraceCostBreakdown: Record<string, { total: number; baseAmount: number; compoundingBase: number; quincenal: number; mensual: number; other: number }> = {};
  const emptyReturn = { amortizationTable: [], totalValorPagar: 0, totalInterestPaid: 0, totalGracePeriodCost: 0, totalIvaFinancPaid: 0, monthlyGraceCostBreakdown: {}, uncollectedAmountGracePeriod: 0 };

  const startDate = parseFlexibleDate(fechaCreditoStr);
  if (!startDate || isNaN(startDate.getTime())) {
    console.warn(`Crédito ${creditId}: Formato de fecha inválido para '${fechaCreditoStr}'. Fila saltada.`);
    return emptyReturn;
  }
  
  if (numCuotas <= 0 || isNaN(numCuotas)) {
    console.warn(`Crédito ${creditId}: Número de cuotas inválido (${numCuotas}). Fila saltada.`);
    return emptyReturn;
  }

  const isQuincenal = modalidadPago.toLowerCase().includes('quincenal');
  
  // Robust calculation of first payment date
  let actualFirstPaymentDate: Date;
  const startDay = getDate(startDate);

  if (isQuincenal) {
      if (startDay <= 15) {
          actualFirstPaymentDate = setDate(startDate, lastDayOfMonth(startDate).getDate());
      } else {
          actualFirstPaymentDate = setDate(addMonths(startDate, 1), 15);
      }
  } else { // Mensual o cualquier otro caso
      actualFirstPaymentDate = addMonths(startDate, 1);
  }


  const monthlyInterestRate = tasaInteresMensual;
  const avalPerCuota = vrAdmonTotal / numCuotas;
  const ivaAvalPerCuota = ivaAdmonTotal / numCuotas;
  const effectiveMonthlyRateForPMT = monthlyInterestRate * (1 + ivaFinancieroRate);

  if (isNaN(effectiveMonthlyRateForPMT) || effectiveMonthlyRateForPMT <= 0) {
    console.error(`Crédito ${creditId}: Tasa de interés mensual efectiva inválida (${effectiveMonthlyRateForPMT}).`);
    return emptyReturn;
  }
  
  const denominator = (Math.pow(1 + effectiveMonthlyRateForPMT, numCuotas) - 1);
  if (denominator === 0) {
     console.error(`Crédito ${creditId}: Denominador cero en cálculo de cuota.`);
     return emptyReturn;
  }

  const fixedPrincipalInterestIvaInstallment = valorCredito * (effectiveMonthlyRateForPMT * Math.pow(1 + effectiveMonthlyRateForPMT, numCuotas)) / denominator;
  const fixedTotalInstallment = fixedPrincipalInterestIvaInstallment + avalPerCuota + ivaAvalPerCuota;

  let outstandingBalance = valorCredito;
  let lastPaymentDate = actualFirstPaymentDate;

  for (let k = 1; k <= numCuotas; k++) {
    let cuotaDate: Date;
    if (k === 1) {
        cuotaDate = actualFirstPaymentDate;
    } else {
        if (isQuincenal) {
             if (getDate(lastPaymentDate) <= 15) {
                cuotaDate = setDate(lastPaymentDate, lastDayOfMonth(lastPaymentDate).getDate());
            } else {
                cuotaDate = setDate(addMonths(lastPaymentDate, 1), 15);
            }
        } else {
            cuotaDate = addMonths(lastPaymentDate, 1);
        }
    }
    lastPaymentDate = cuotaDate;
    
    const financiacion = outstandingBalance * monthlyInterestRate;
    const ivaFinanc = financiacion * ivaFinancieroRate;
    const capital = fixedPrincipalInterestIvaInstallment - financiacion - ivaFinanc;
    
    totalInterestAccumulated += financiacion;
    totalIvaFinancAccumulated += ivaFinanc;
    
    amortizationTable.push({
      cuota: k,
      fecha: format(cuotaDate, "dd/MM/yyyy"),
      valorCuota: parseFloat(fixedTotalInstallment.toFixed(2)),
      capital: parseFloat(capital.toFixed(2)),
      financiacion: parseFloat(financiacion.toFixed(2)),
      ivaFinanc: parseFloat(ivaFinanc.toFixed(2)),
      aval: parseFloat(avalPerCuota.toFixed(2)),
      ivaAval: parseFloat(ivaAvalPerCuota.toFixed(2)),
      gracePeriodCostPerInstallment: 0,
    });

    outstandingBalance -= capital;
    totalValorPagar += fixedTotalInstallment;
  }
  
  if (Math.abs(outstandingBalance) > 0.01) {
    const lastRow = amortizationTable[amortizationTable.length - 1];
    if (lastRow) lastRow.capital = parseFloat((lastRow.capital + outstandingBalance).toFixed(2));
  }
  
  let totalGracePeriodCost = 0;
  const gracePeriodInstallmentsCount = isQuincenal ? 4 : 2;

  amortizationTable.slice(0, gracePeriodInstallmentsCount).forEach(installment => {
      uncollectedAmountGracePeriod += installment.valorCuota;
      
      const cuotaDueDate = parseFlexibleDate(installment.fecha);
      if(!cuotaDueDate || isNaN(cuotaDueDate.getTime())) return;

      let compoundingCapital = installment.valorCuota;
      let installmentGraceCost = 0;

      for (let m = 0; m < 2; m++) {
          const interestPeriodDate = addMonths(cuotaDueDate, m + 1);
          const monthKey = format(interestPeriodDate, 'yyyy-MM');
          
          const annualRate = gracePeriodMonthlyRates[monthKey] ?? 0;
          const monthlyRate = convertAnnualToMonthlyRate(annualRate);
          const interestForMonth = compoundingCapital * monthlyRate;
          
          installmentGraceCost += interestForMonth;
          
          if (!monthlyGraceCostBreakdown[monthKey]) {
            monthlyGraceCostBreakdown[monthKey] = { total: 0, baseAmount: 0, compoundingBase: 0, quincenal: 0, mensual: 0, other: 0 };
          }
          
          monthlyGraceCostBreakdown[monthKey].total += interestForMonth;
          
          if (m === 0) { 
             monthlyGraceCostBreakdown[monthKey].baseAmount += installment.valorCuota;
             monthlyGraceCostBreakdown[monthKey].compoundingBase += installment.valorCuota;
          } else {
             monthlyGraceCostBreakdown[monthKey].compoundingBase += compoundingCapital;
          }
          
          if(isQuincenal) monthlyGraceCostBreakdown[monthKey].quincenal += interestForMonth;
          else monthlyGraceCostBreakdown[monthKey].mensual += interestForMonth;

          compoundingCapital += interestForMonth; 
      }
      
      installment.gracePeriodCostPerInstallment = parseFloat(installmentGraceCost.toFixed(2));
      totalGracePeriodCost += installmentGraceCost;
  });

  return {
    amortizationTable,
    totalValorPagar: parseFloat(totalValorPagar.toFixed(2)),
    totalInterestPaid: parseFloat(totalInterestAccumulated.toFixed(2)),
    totalGracePeriodCost: parseFloat(totalGracePeriodCost.toFixed(2)),
    totalIvaFinancPaid: parseFloat(totalIvaFinancAccumulated.toFixed(2)),
    monthlyGraceCostBreakdown,
    uncollectedAmountGracePeriod: parseFloat(uncollectedAmountGracePeriod.toFixed(2)),
  };
};

