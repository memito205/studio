
"use client";

import React from 'react';
import { CartesianGrid, Label, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { HourlyProductivity, IncidentLogEntry } from '@/types';

const chartConfig = {
  totalQuantity: {
    label: 'Unidades',
    color: 'hsl(var(--chart-1))',
  },
  compliance: {
    label: 'Cumplimiento',
    color: 'hsl(var(--chart-2))',
  },
  incident: {
      label: 'Incidencia',
      color: 'hsl(var(--destructive))',
  }
} satisfies ChartConfig;

// This custom dot logic is complex and specific, so we'll keep it,
// but adapt it to get colors from the chartConfig.
const CustomizedDotWithLabels = (props: any) => {
    const { cx, cy, payload, isPeak, isValley } = props;

    if (!payload || cx === undefined || cy === undefined) {
        return null;
    }

    const { totalQuantity, operatorCount, productivityPerOperator, compliance } = payload;
    if (totalQuantity === undefined || operatorCount === undefined || productivityPerOperator === undefined || compliance === undefined) {
        return null;
    }
    
    const getComplianceColor = (c: number) => {
      if (c >= 100) return 'hsl(var(--chart-2))';
      if (c >= 85) return 'hsl(var(--chart-4))';
      return 'hsl(var(--destructive))';
    };

    let dot;
    if (isPeak) {
        dot = <circle cx={cx} cy={cy} r={8} stroke="hsl(var(--chart-2))" strokeWidth={3} fill="hsla(var(--chart-2), 0.5)" />;
    } else if (isValley) {
        dot = <circle cx={cx} cy={cy} r={8} stroke="hsl(var(--destructive))" strokeWidth={3} fill="hsla(var(--destructive), 0.5)" />;
    } else {
        dot = <circle cx={cx} cy={cy} r={5} stroke="hsl(var(--chart-1))" strokeWidth={2} fill="hsl(var(--background))" />;
    }
    
    return (
        <g>
            {dot}
            <text x={cx} y={cy - 40} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={16} fontWeight="bold">
                {totalQuantity.toLocaleString()}
            </text>
            <text x={cx} y={cy - 24} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={11}>
                ({productivityPerOperator.toFixed(1)} p/op)
            </text>
            <text x={cx} y={cy - 9} textAnchor="middle" fill={getComplianceColor(compliance)} fontSize={12} fontWeight="bold">
                 {compliance.toFixed(1)}%
            </text>
             { operatorCount > 1 &&
                <text x={cx} y={cy + 22} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}>
                    {`${operatorCount} ${operatorCount === 1 ? 'op.' : 'ops.'}`}
                </text>
             }
        </g>
    );
};


export const HourlyProductivityChart: React.FC<{ data: HourlyProductivity[], incidentLog: IncidentLogEntry[], theme: 'light' | 'dark' }> = ({ data, incidentLog }) => {
    if (!data || data.length < 1) { 
        return (
            <div className="text-center py-8">
                <p className="text-muted-foreground">No hay suficientes datos para mostrar la evolución de la productividad para esta selección.</p>
            </div>
        );
    }

    const peakProductivity = Math.max(...data.map(d => d.totalQuantity));
    const valleyProductivity = Math.min(...data.map(d => d.totalQuantity));

    return (
        <ChartContainer config={chartConfig} className="min-h-[400px] w-full">
            <LineChart
                data={data}
                margin={{ top: 60, right: 40, left: 10, bottom: 30 }}
                accessibilityLayer
            >
                <CartesianGrid vertical={false} />
                <XAxis 
                    dataKey="hour" 
                    tickFormatter={(hour) => `${hour}:00`}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval="preserveStartEnd"
                    padding={{ left: 30, right: 30 }}
                />
                <YAxis 
                    yAxisId="left"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickCount={6}
                    allowDecimals={false}
                />
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickCount={6}
                    tickFormatter={(value) => `${Math.round(value)}%`}
                    domain={[0, 'dataMax + 10']}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent 
                      indicator="line"
                      labelFormatter={ (label, payload) => `Hora: ${payload?.[0]?.payload.hour}:00 - ${payload?.[0]?.payload.hour + 1}:00`}
                      formatter={(value, name, item) => (
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label}</span>
                            <span className="font-bold">{value}{name === 'compliance' ? '%' : ''}</span>
                          </div>
                          {name === 'totalQuantity' && (
                             <>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Productividad/Op</span>
                                <span>{item.payload.productivityPerOperator.toFixed(1)}</span>
                              </div>
                               <div className="flex justify-between">
                                <span className="text-muted-foreground">Operarios</span>
                                <span>{item.payload.operatorCount}</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    />
                  }
                />
                <Legend />
                
                {incidentLog.map(incident => {
                     const incidentTime = new Date(incident.timestamp);
                     const incidentHour = incidentTime.getHours() + incidentTime.getMinutes() / 60;
                     return (
                         <ReferenceLine 
                            key={incident.id} 
                            yAxisId="left" 
                            x={incidentHour} 
                            stroke="var(--color-incident)"
                            strokeDasharray="4 4"
                            strokeWidth={1.5}
                         >
                            <Label 
                                value={incident.text}
                                position="insideTopLeft"
                                fill="var(--color-incident)"
                                fontSize={11}
                                angle={-45}
                                offset={10}
                            />
                         </ReferenceLine>
                     );
                })}

                <Line
                    dataKey="totalQuantity"
                    type="monotone"
                    yAxisId="left"
                    stroke="var(--color-totalQuantity)"
                    strokeWidth={2.5}
                    name="Unidades Totales"
                    dot={(props) => {
                        const { key, ...rest } = props;
                        return (
                            <CustomizedDotWithLabels
                                key={key}
                                {...rest}
                                isPeak={props.payload.totalQuantity === peakProductivity && data.length > 1}
                                isValley={props.payload.totalQuantity === valleyProductivity && data.length > 1}
                            />
                        );
                    }}
                    isAnimationActive={false}
                />
                <Line
                    dataKey="compliance"
                    type="monotone"
                    yAxisId="right"
                    stroke="var(--color-compliance)"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    name="Cumplimiento"
                    dot={false}
                    activeDot={{ r: 6 }}
                />
            </LineChart>
        </ChartContainer>
    );
};
