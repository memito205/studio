
"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CreditCalculationResult } from "@/types";

interface CreditValueByPOSChartProps {
  results: CreditCalculationResult[];
}

const CreditValueByPOSChart: React.FC<CreditValueByPOSChartProps> = ({ results }) => {
  const posData = results.reduce((acc, credit) => {
    const pos = credit.puntoDeVenta;
    if (!acc[pos]) {
      acc[pos] = { name: pos, totalValorCredito: 0 };
    }
    acc[pos].totalValorCredito += credit.valorCredito;
    return acc;
  }, {} as Record<string, { name: string; totalValorCredito: number }>);

  const data = Object.values(posData).sort((a, b) => b.totalValorCredito - a.totalValorCredito);

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">
          Valor Total de Créditos por Punto de Venta
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[350px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
            <YAxis tickFormatter={(value) => `$${value.toLocaleString('es-CO')}`} tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
            <Tooltip formatter={(value: number) => `$${value.toLocaleString('es-CO')}`} />
            <Legend />
            <Bar dataKey="totalValorCredito" name="Valor Crédito" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default CreditValueByPOSChart;
