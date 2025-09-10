import { format, parse, addMonths, addDays, differenceInDays, setDate, setMonth, getYear, getDate, setYear } from "date-fns";
import { es } from "date-fns/locale";
import { showError } from "@/lib/toast";
import type { AmortizationRow, CreditCalculationResult } from "@/types";

// Function to convert annual effective rate to monthly effective rate (now exported)
export const convertAnnualToMonthlyRate = (annualRate: number): number => {
  return Math.pow(1 + annualRate, 1/12) - 1;
};

// Robustly parse the date string - NOW EXPORTED
export const parseDateString = (dateStr: string): Date => {
  let parsedDate: Date;

  const formatsToTry = [
    'dd/MM/yyyy',
    'yyyy-MM-dd',
    'MM/dd/yyyy',
    'M/d/yy',
    'dd-MMM-yyyy',
    'MMM-dd-yyyy'
  ];

  for (const fmt of formatsToTry) {
    parsedDate = parse(dateStr, fmt, new Date(2000, 0, 1), { locale: es });
    if (!isNaN(parsedDate.getTime())) {
      if (parsedDate.getFullYear() < 100) {
        parsedDate = setYear(parsedDate, parsedDate.getFullYear() + 2000);
      }
      return parsedDate;
    }
  }

  showError(`Error de fecha: No se pudo interpretar la fecha '${dateStr}'. Asegúrate de que el formato sea válido (ej. DD/MM/YYYY, YYYY-MM-DD).`);
  return new Date(NaN);
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
    monthlyGraceCostBreakdown: Record<string, { total: number; quincenal: number; mensual: number; other: number }>;
    uncollectedAmountGracePeriod: number;
} => {
  const amortizationTable: AmortizationRow[] = [];
  let totalValorPagar = 0;
  let totalInterestAccumulated = 0;
  let totalIvaFinancAccumulated = 0;
  let uncollectedAmountGracePeriod = 0; // Sum of installments during grace period
  const monthlyGraceCostBreakdown: Record<string, { total: number; quincenal: number; mensual: number; other: number }> = {};
  const emptyReturn = { amortizationTable: [], totalValorPagar: 0, totalInterestPaid: 0, totalGracePeriodCost: 0, totalIvaFinancPaid: 0, monthlyGraceCostBreakdown: {}, uncollectedAmountGracePeriod: 0 };


  const startDate = parseDateString(fechaCreditoStr);

  if (isNaN(startDate.getTime())) {
    const message = `Crédito ${creditId}: Formato de fecha inválido para '${fechaCreditoStr}'. Fila saltada.`;
    console.warn(message);
    return emptyReturn;
  }

  let actualFirstPaymentDate = new Date(startDate);
  const lowerCaseModalidadPago = modalidadPago.toLowerCase();

  if (lowerCaseModalidadPago.includes('quincenal')) {
    const dayOfMonth = getDate(startDate);
    if (dayOfMonth <= 15) {
      actualFirstPaymentDate = setDate(startDate, 30);
    } else {
      actualFirstPaymentDate = setDate(addMonths(startDate, 1), 15);
    }
  } else if (lowerCaseModalidadPago.includes('mensual')) {
    actualFirstPaymentDate = addMonths(startDate, 1);
    if (getDate(actualFirstPaymentDate) !== getDate(startDate)) {
      actualFirstPaymentDate = setDate(actualFirstPaymentDate, 0);
    }
  } else {
    actualFirstPaymentDate = addMonths(startDate, 2);
  }

  if (actualFirstPaymentDate.getTime() < startDate.getTime()) {
      actualFirstPaymentDate = addMonths(actualFirstPaymentDate, 1);
  }

  const monthlyInterestRate = tasaInteresMensual;
  const avalPerCuota = vrAdmonTotal / numCuotas;
  const ivaAvalPerCuota = ivaAdmonTotal / numCuotas;
  const effectiveMonthlyRateForPMT = monthlyInterestRate * (1 + ivaFinancieroRate);

  if (numCuotas <= 0 || isNaN(effectiveMonthlyRateForPMT) || effectiveMonthlyRateForPMT === 0) {
    const message = `Crédito ${creditId}: Datos inválidos para cálculo de cuota (numCuotas: ${numCuotas}, tasaInteresMensual: ${tasaInteresMensual}).`;
    console.error(message);
    showError(message);
    return emptyReturn;
  }

  const denominator = (Math.pow(1 + effectiveMonthlyRateForPMT, numCuotas) - 1);
  if (denominator === 0) {
    const message = `Crédito ${creditId}: Denominador cero en cálculo de cuota.`;
    console.error(message);
    showError(message);
    return emptyReturn;
  }

  const fixedPrincipalInterestIvaInstallment = valorCredito * (effectiveMonthlyRateForPMT * Math.pow(1 + effectiveMonthlyRateForPMT, numCuotas)) / denominator;
  const fixedTotalInstallment = fixedPrincipalInterestIvaInstallment + avalPerCuota + ivaAvalPerCuota;

  let outstandingBalance = valorCredito;

  for (let k = 1; k <= numCuotas; k++) {
    const cuotaDate = addMonths(actualFirstPaymentDate, k - 1);
    const financiacion = outstandingBalance * monthlyInterestRate;
    const ivaFinanc = financiacion * ivaFinancieroRate;
    const capital = fixedPrincipalInterestIvaInstallment - financiacion - ivaFinanc;
    
    totalInterestAccumulated += financiacion;
    totalIvaFinancAccumulated += ivaFinanc;

    // Check if the installment is within the grace period
    const isQuincenal = lowerCaseModalidadPago.includes('quincenal');
    const isMensual = lowerCaseModalidadPago.includes('mensual');
    if ((isQuincenal && k <= 4) || (isMensual && k <= 2)) {
        uncollectedAmountGracePeriod += fixedTotalInstallment;
    }

    amortizationTable.push({
      cuota: k,
      fecha: format(cuotaDate, "MMM. dd, yyyy", { locale: es }),
      valorCuota: parseFloat(fixedTotalInstallment.toFixed(2)),
      capital: parseFloat(capital.toFixed(2)),
      financiacion: parseFloat(financiacion.toFixed(2)),
      ivaFinanc: parseFloat(ivaFinanc.toFixed(2)),
      aval: parseFloat(avalPerCuota.toFixed(2)),
      ivaAval: parseFloat(ivaAvalPerCuota.toFixed(2)),
      gracePeriodCostPerInstallment: 0, // Cost is now calculated on the total
    });

    outstandingBalance -= capital;
    totalValorPagar += fixedTotalInstallment;
  }

  if (Math.abs(outstandingBalance) > 0.01) { // Allow for small rounding differences
    const lastRow = amortizationTable[amortizationTable.length - 1];
    if (lastRow) {
      lastRow.capital = parseFloat((lastRow.capital + outstandingBalance).toFixed(2));
    }
  }
  
  // Calculate total grace cost on the accumulated uncollected amount
  let totalGracePeriodCost = 0;
  
  if (uncollectedAmountGracePeriod > 0) {
      const graceStartDate = actualFirstPaymentDate;
      const graceMonth1Key = format(graceStartDate, 'yyyy-MM');
      const graceMonth2Date = addMonths(graceStartDate, 1);
      const graceMonth2Key = format(graceMonth2Date, 'yyyy-MM');
      
      const annualRateForMonth1 = gracePeriodMonthlyRates[graceMonth1Key] ?? 0;
      const monthlyRateForMonth1 = convertAnnualToMonthlyRate(annualRateForMonth1);

      const annualRateForMonth2 = gracePeriodMonthlyRates[graceMonth2Key] ?? 0;
      const monthlyRateForMonth2 = convertAnnualToMonthlyRate(annualRateForMonth2);
      
      const interestMonth1 = uncollectedAmountGracePeriod * monthlyRateForMonth1;
      const principalPlusInterestMonth1 = uncollectedAmountGracePeriod + interestMonth1;
      const interestMonth2 = principalPlusInterestMonth1 * monthlyRateForMonth2;
      
      totalGracePeriodCost = interestMonth1 + interestMonth2;
      
      monthlyGraceCostBreakdown[graceMonth1Key] = {
          total: interestMonth1, 
          quincenal: lowerCaseModalidadPago.includes('quincenal') ? interestMonth1 : 0, 
          mensual: lowerCaseModalidadPago.includes('mensual') ? interestMonth1 : 0, 
          other: 0
      };
       monthlyGraceCostBreakdown[graceMonth2Key] = {
          total: interestMonth2, 
          quincenal: lowerCaseModalidadPago.includes('quincenal') ? interestMonth2 : 0, 
          mensual: lowerCaseModalidadPago.includes('mensual') ? interestMonth2 : 0, 
          other: 0
      };
  }

  return {
    amortizationTable,
    totalValorPagar: parseFloat(totalValorPagar.toFixed(2)),
    totalInterestPaid: parseFloat(totalInterestAccumulated.toFixed(2)),
    totalGracePeriodCost: parseFloat(totalGracePeriodCost.toFixed(2)),
    totalIvaFinancPaid: parseFloat(totalIvaFinancAccumulated.toFixed(2)),
    monthlyGraceCostBreakdown: monthlyGraceCostBreakdown,
    uncollectedAmountGracePeriod: parseFloat(uncollectedAmountGracePeriod.toFixed(2)),
  };
};
