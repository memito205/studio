
"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { calculateAmortization, GeneralSummary, CreditCalculationResult, parseDateString, convertAnnualToMonthlyRate } from "@/services/creditCalculations";
import GeneralSummarySection from "@/components/financial-calculator/GeneralSummarySection";
import { showError, showSuccess } from "@/lib/toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { format, addMonths } from "date-fns"; 
import MonthlyGraceRateInput from "@/components/financial-calculator/MonthlyGraceRateInput"; 

const CreditSimulatorForm: React.FC = () => {
  const [numExpectedCredits, setNumExpectedCredits] = useState<number>(100);
  const [avgCreditValue, setAvgCreditValue] = useState<number>(5000000);
  const [quincenalPercentage, setQuincenalPercentage] = useState<number>(60);
  const [mensualPercentage, setMensualPercentage] = useState<number>(40);
  const [defaultNumCuotasQuincenal, setDefaultNumCuotasQuincenal] = useState<number>(24);
  const [defaultNumCuotasMensual, setDefaultNumCuotasMensual] = useState<number>(12);
  const [defaultTasaInteres, setDefaultTasaInteres] = useState<number>(0.02);
  const [defaultVrAdmonPercentage, setDefaultVrAdmonPercentage] = useState<number>(0.12);
  const [defaultIvaRate, setDefaultIvaRate] = useState<number>(0.19);
  
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
  const [simulatedSummary, setSimulatedSummary] = useState<GeneralSummary | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedResults, setSimulatedResults] = useState<CreditCalculationResult[]>([]);


  const handleSimulate = () => {
    setIsSimulating(true);
    setSimulatedSummary(null);

    if (quincenalPercentage + mensualPercentage > 100) {
      showError("La suma de los porcentajes quincenal y mensual no puede exceder 100%.");
      setIsSimulating(false);
      return;
    }

    if (Object.keys(monthlyGraceRates).length === 0) {
      showError("Por favor, añade al menos una tasa de período de gracia mensual.");
      setIsSimulating(false);
      return;
    }

    if (numExpectedCredits <= 0 || avgCreditValue <= 0 || defaultNumCuotasQuincenal <= 0 || defaultNumCuotasMensual <= 0 || defaultTasaInteres <= 0 || defaultVrAdmonPercentage < 0 || defaultIvaRate < 0) {
      showError("Por favor, ingresa valores positivos para todos los campos numéricos (excepto porcentajes que pueden ser 0).");
      setIsSimulating(false);
      return;
    }

    const currentSimulatedResults: CreditCalculationResult[] = [];
    let totalInterestPaidOverall = 0;
    let totalIvaFinancOverall = 0;
    let totalGracePeriodCostOverall = 0;
    let totalUncollectedAmountGracePeriodOverall = 0;
    let totalValorCreditoOverall = 0;
    let totalVrAdmonOverall = 0;
    let totalIvaAdmonOverall = 0;
    let totalValorCreditoSumForAverage = 0;
    const paymentModalityDistribution = { quincenal: 0, mensual: 0, other: 0 };
    const quincenalInstallmentCounts: Record<number, number> = {};
    const mensualInstallmentCounts: Record<number, number> = {};
    const overallMonthlyGraceCostBreakdown: Record<string, { total: number; quincenal: number; mensual: number; other: number }> = {}; 

    const today = new Date();
    const formattedToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const numQuincenal = Math.round(numExpectedCredits * (quincenalPercentage / 100));
    const numMensual = Math.round(numExpectedCredits * (mensualPercentage / 100));

    for (let i = 0; i < numExpectedCredits; i++) {
      let modality = "other";
      let numCuotas = 0;

      if (i < numQuincenal) {
        modality = "quincenal";
        numCuotas = defaultNumCuotasQuincenal;
        paymentModalityDistribution.quincenal++;
      } else if (i < numQuincenal + numMensual) {
        modality = "mensual";
        numCuotas = defaultNumCuotasMensual;
        paymentModalityDistribution.mensual++;
      } else {
        modality = "other";
        numCuotas = defaultNumCuotasMensual; 
        paymentModalityDistribution.other++;
      }

      if (numCuotas === 0) continue;

      const creditId = `SIM-${i + 1}`;
      const puntoDeVenta = `POS-${Math.floor(Math.random() * 5) + 1}`;
      const documento = `DOC-${Math.floor(Math.random() * 1000000)}`;

      const vrAdmonCalculated = avgCreditValue * defaultVrAdmonPercentage;
      const ivaAdmonCalculated = vrAdmonCalculated * defaultIvaRate;

      const { amortizationTable, totalValorPagar, totalInterestPaid, totalGracePeriodCost, totalIvaFinancPaid, monthlyGraceCostBreakdown, uncollectedAmountGracePeriod } = calculateAmortization(
        creditId,
        avgCreditValue,
        modality,
        numCuotas,
        defaultTasaInteres,
        vrAdmonCalculated,
        ivaAdmonCalculated,
        formattedToday,
        defaultIvaRate,
        monthlyGraceRates
      );

      if (amortizationTable.length > 0) {
        currentSimulatedResults.push({
          creditId,
          puntoDeVenta,
          documento,
          fechaCredito: formattedToday,
          valorCredito: avgCreditValue,
          modalidadPago: modality,
          numCuotas,
          tasaInteres: defaultTasaInteres,
          vrAdmon: vrAdmonCalculated,
          ivaAdmon: ivaAdmonCalculated,
          amortizationTable,
          totalValorPagar,
          totalInterestPaid,
          totalGracePeriodCost,
          totalIvaFinancPaid,
          monthlyGraceCostBreakdown,
          uncollectedAmountGracePeriod
        });

        totalInterestPaidOverall += totalInterestPaid;
        totalIvaFinancOverall += totalIvaFinancPaid;
        totalGracePeriodCostOverall += totalGracePeriodCost;
        totalUncollectedAmountGracePeriodOverall += uncollectedAmountGracePeriod;
        totalValorCreditoOverall += avgCreditValue;
        totalVrAdmonOverall += vrAdmonCalculated;
        totalIvaAdmonOverall += ivaAdmonCalculated;
        totalValorCreditoSumForAverage += avgCreditValue;

        if (monthlyGraceCostBreakdown) {
          Object.entries(monthlyGraceCostBreakdown).forEach(([monthKey, costs]) => {
            if (!overallMonthlyGraceCostBreakdown[monthKey]) {
              overallMonthlyGraceCostBreakdown[monthKey] = { total: 0, quincenal: 0, mensual: 0, other: 0 };
            }
            overallMonthlyGraceCostBreakdown[monthKey].total += costs.total;
            overallMonthlyGraceCostBreakdown[monthKey].quincenal += costs.quincenal;
            overallMonthlyGraceCostBreakdown[monthKey].mensual += costs.mensual;
            overallMonthlyGraceCostBreakdown[monthKey].other += costs.other;
          });
        }

        if (modality.includes('quincenal')) {
          quincenalInstallmentCounts[numCuotas] = (quincenalInstallmentCounts[numCuotas] || 0) + 1;
        } else if (modality.includes('mensual')) {
          mensualInstallmentCounts[numCuotas] = (mensualInstallmentCounts[numCuotas] || 0) + 1;
        }
      }
    }
    
    setSimulatedResults(currentSimulatedResults);

    const quincenalP = numExpectedCredits > 0 ? (paymentModalityDistribution.quincenal / numExpectedCredits) * 100 : 0;
    const mensualP = numExpectedCredits > 0 ? (paymentModalityDistribution.mensual / numExpectedCredits) * 100 : 0;
    const otherP = numExpectedCredits > 0 ? (paymentModalityDistribution.other / numExpectedCredits) * 100 : 0;
    const averageValorCredito = currentSimulatedResults.length > 0 ? totalValorCreditoSumForAverage / currentSimulatedResults.length : 0;

    setSimulatedSummary({
      totalCredits: currentSimulatedResults.length,
      paymentModalityDistribution,
      quincenalPercentage: quincenalP,
      mensualPercentage: mensualP,
      otherPercentage: otherP,
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

    showSuccess(`Simulación completada para ${currentSimulatedResults.length} créditos.`);
    setIsSimulating(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card className="shadow-lg border-gray-200 dark:border-gray-700">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-center text-green-700 dark:text-green-400">Parámetros de Simulación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Accordion type="multiple" defaultValue={["item-1", "item-2", "item-3", "item-4"]} className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger className="text-lg font-semibold text-gray-800 dark:text-gray-200">Parámetros Generales</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="numExpectedCredits">Cantidad de Créditos a Simular</Label>
                  <Input
                    id="numExpectedCredits"
                    type="number"
                    value={numExpectedCredits}
                    onChange={(e) => setNumExpectedCredits(parseInt(e.target.value) || 0)}
                    min="0"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="avgCreditValue">Valor Promedio por Crédito ($)</Label>
                  <Input
                    id="avgCreditValue"
                    type="number"
                    value={avgCreditValue}
                    onChange={(e) => setAvgCreditValue(parseFloat(e.target.value) || 0)}
                    min="0"
                    className="mt-1"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger className="text-lg font-semibold text-gray-800 dark:text-gray-200">Distribución de Modalidades de Pago (%)</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="quincenalPercentage">Quincenal</Label>
                    <Input
                      id="quincenalPercentage"
                      type="number"
                      value={quincenalPercentage}
                      onChange={(e) => setQuincenalPercentage(parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="mensualPercentage">Mensual</Label>
                    <Input
                      id="mensualPercentage"
                      type="number"
                      value={mensualPercentage}
                      onChange={(e) => setMensualPercentage(parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      className="mt-1"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger className="text-lg font-semibold text-gray-800 dark:text-gray-200">Valores por Defecto</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="defaultNumCuotasQuincenal">Cuotas por Defecto (Quincenal)</Label>
                  <Input
                    id="defaultNumCuotasQuincenal"
                    type="number"
                    value={defaultNumCuotasQuincenal}
                    onChange={(e) => setDefaultNumCuotasQuincenal(parseInt(e.target.value) || 0)}
                    min="1"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultNumCuotasMensual">Cuotas por Defecto (Mensual)</Label>
                  <Input
                    id="defaultNumCuotasMensual"
                    type="number"
                    value={defaultNumCuotasMensual}
                    onChange={(e) => setDefaultNumCuotasMensual(parseInt(e.target.value) || 0)}
                    min="1"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultTasaInteres">Tasa de Interés Mensual por Defecto (ej. 0.02 para 2%)</Label>
                  <Input
                    id="defaultTasaInteres"
                    type="number"
                    step="0.0001"
                    value={defaultTasaInteres}
                    onChange={(e) => setDefaultTasaInteres(parseFloat(e.target.value) || 0)}
                    min="0"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultVrAdmonPercentage">Porcentaje de Administración (Aval) por Defecto (ej. 0.12 para 12%)</Label>
                  <Input
                    id="defaultVrAdmonPercentage"
                    type="number"
                    step="0.01"
                    value={defaultVrAdmonPercentage}
                    onChange={(e) => setDefaultVrAdmonPercentage(parseFloat(e.target.value) || 0)}
                    min="0"
                    max="1"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultIvaRate">Tasa de IVA por Defecto (ej. 0.19 para 19%)</Label>
                  <Input
                    id="defaultIvaRate"
                    type="number"
                    step="0.01"
                    value={defaultIvaRate}
                    onChange={(e) => setDefaultIvaRate(parseFloat(e.target.value) || 0)}
                    min="0"
                    max="1"
                    className="mt-1"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger className="text-lg font-semibold text-gray-800 dark:text-gray-200">Configuración de Tasa de Gracia</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <MonthlyGraceRateInput
                  monthlyRates={monthlyGraceRates}
                  onRatesChange={setMonthlyGraceRates}
                  disabled={isSimulating}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <Button onClick={handleSimulate} disabled={isSimulating} className="w-full bg-green-600 hover:bg-green-700 text-white">
            {isSimulating ? "Simulando..." : "Simular Operación"}
          </Button>
        </CardContent>
      </Card>

      <div className="lg:col-span-1">
        {simulatedSummary ? (
          <GeneralSummarySection summary={simulatedSummary} results={simulatedResults} />
        ) : (
          <Card className="h-full flex items-center justify-center text-center text-gray-500 dark:text-gray-400 shadow-lg border-gray-200 dark:border-gray-700">
            <CardContent className="p-8">
              <p>Ingresa los parámetros y haz clic en "Simular Operación" para ver los resultados.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default CreditSimulatorForm;
