"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCalculationResult } from "@/types";

interface CreditValueByDateChartProps {
  results: CreditCalculationResult[];
}

const CreditValueByDateChart: React.FC<CreditValueByDateChartProps> = ({ results }) => {
  const dateData = results.reduce((acc, credit) => {
    const date = credit.fechaCredito; // Use the formatted date string for grouping
    if (!acc[date]) {
      acc[date] = { name: date, totalValorCredito: 0 };
    }
    acc[date].totalValorCredito += credit.valorCredito;
    return acc;
  }, {} as Record<string, { name: string; totalValorCredito: number }>);

  const data = Object.values(dateData).sort((a, b) => new Date(a.name).getTime() - new Date(b.name).getTime());

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className="mt-8 shadow-lg border-gray-200 dark:border-gray-700">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-blue-700 dark:text-blue-400">
          Valor Total de Créditos por Fecha de Crédito
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[350px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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
            <Line type="monotone" dataKey="totalValorCredito" name="Valor Crédito" stroke="hsl(var(--primary))" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default CreditValueByDateChart;
