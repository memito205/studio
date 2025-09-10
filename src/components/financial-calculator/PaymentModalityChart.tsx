"use client";

import React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GeneralSummary } from "@/types";

interface PaymentModalityChartProps {
  summary: GeneralSummary;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28']; // Blue, Green, Yellow

const PaymentModalityChart: React.FC<PaymentModalityChartProps> = ({ summary }) => {
  const data = [
    { name: 'Quincenal', value: summary.paymentModalityDistribution.quincenal },
    { name: 'Mensual', value: summary.paymentModalityDistribution.mensual },
    { name: 'Otras', value: summary.paymentModalityDistribution.other },
  ].filter(item => item.value > 0); // Only show modalities with credits

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-md hover:shadow-lg transition-all duration-200 h-full">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-center text-gray-800 dark:text-gray-200">
          Distribución de Créditos por Modalidad de Pago
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[250px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => value.toLocaleString('es-CO')} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default PaymentModalityChart;
