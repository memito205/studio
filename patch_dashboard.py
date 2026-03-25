import os

file_path = "src/components/HistoricalDashboard.tsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Inject hourlyTrendData
product_hook_end = "  }, [trendsData, selectedOperator]);"
hourly_hook = """  }, [trendsData, selectedOperator]);

  const hourlyTrendData = useMemo(() => {
      const hoursMap: Record<number, { units: number, productiveMinutes: number, validCount: number }> = {};
      
      trendsData.forEach(d => {
          if (selectedOperator === 'all') {
             d.packerHourlyPerformance?.forEach(packerGroup => {
                 Object.entries(packerGroup.hourlyDetails).forEach(([hourStr, details]) => {
                     const hour = parseInt(hourStr);
                     if (details.units > 0 || details.productiveMinutes > 0) {
                         if (!hoursMap[hour]) hoursMap[hour] = { units: 0, productiveMinutes: 0, validCount: 0 };
                         hoursMap[hour].units += details.units;
                         hoursMap[hour].productiveMinutes += details.productiveMinutes;
                         hoursMap[hour].validCount++;
                     }
                 });
             });
          } else {
             const operatorData = d.packerHourlyPerformance?.find(p => p.packerName === selectedOperator);
             if (operatorData) {
                 Object.entries(operatorData.hourlyDetails).forEach(([hourStr, details]) => {
                     const hour = parseInt(hourStr);
                     if (details.units > 0 || details.productiveMinutes > 0) {
                         if (!hoursMap[hour]) hoursMap[hour] = { units: 0, productiveMinutes: 0, validCount: 0 };
                         hoursMap[hour].units += details.units;
                         hoursMap[hour].productiveMinutes += details.productiveMinutes;
                         hoursMap[hour].validCount++;
                     }
                 });
             }
          }
      });
      
      return Object.entries(hoursMap).map(([hourStr, data]) => {
          const u = data.units / (data.validCount || 1);
          return {
              hour: `${hourStr}:00`,
              unitsAvg: Number(u.toFixed(0)),
          };
      }).sort((a,b) => parseInt(a.hour) - parseInt(b.hour));
  }, [trendsData, selectedOperator]);"""
content = content.replace(product_hook_end, hourly_hook, 1) # Only replace the first occurrence (which is brandPieData end... wait! productPieData uses the same ending string!)

# To be safe, let's find the exact productPieData block and replace it.
import re
content = re.sub(r'(const productPieData = useMemo[\s\S]*?\}, \[trendsData, selectedOperator\]\);)', r'\1\n\n' + hourly_hook.replace("  }, [trendsData, selectedOperator]);\n\n", ""), content, count=1)


# 2. Inject UI Layout
old_layout_regex = r'<div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">.*?\{/\* THE TRUE MATRIX: OPERATOR BREAKDOWN \*/\}'

new_layout = """<div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-500">
                            {/* DUAL COMPLIANCE CHART */}
                            <Card className="overflow-hidden shadow-sm border-muted/60">
                                <CardHeader className="bg-gradient-to-r from-blue-500/10 to-transparent">
                                  <CardTitle className="flex items-center justify-between text-xl">
                                      Evolución Diaria: Volumen vs Cumplimiento
                                      {selectedOperator !== 'all' && <Badge variant="outline" className="text-primary border-primary">Filtro: {selectedOperator}</Badge>}
                                  </CardTitle>
                                  <CardDescription>Muestra tus Unidades Físicas totales (Sombra Azul) vs la Tasa de Cumplimiento Lograda (Línea Naranja).</CardDescription>
                                </CardHeader>
                                <CardContent className="h-[400px] pt-4">
                                 <ResponsiveContainer width="100%" height="100%">
                                     <ComposedChart data={volumeTrendData}>
                                         <defs>
                                             <linearGradient id="colorUnidades" x1="0" y1="0" x2="0" y2="1">
                                             <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                             <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                             </linearGradient>
                                         </defs>
                                         <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                                         <XAxis dataKey="date" tick={{fontSize: 12, fill: '#888'}} axisLine={false} tickLine={false} dy={10} />
                                         <YAxis yAxisId="left" tickFormatter={(v) => v.toLocaleString('es-CO')} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                         <YAxis yAxisId="right" orientation="right" domain={[0, 'dataMax + 20']} tickFormatter={(v) => `${v}%`} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                         <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} />
                                         <Legend wrapperStyle={{paddingTop: '20px'}} />
                                         <Bar yAxisId="left" dataKey="unidades" name="Unidades Físicas" fill="url(#colorUnidades)" radius={[4, 4, 0, 0]}>
                                             <LabelList dataKey="unidades" position="top" fill="#3b82f6" fontSize={11} formatter={(v) => v > 0 ? v.toLocaleString('es-CO') : ''} />
                                         </Bar>
                                         <Line yAxisId="right" type="monotone" dataKey="cumplimiento" name="Tasa Cumplimiento (%)" stroke="#f59e0b" strokeWidth={4} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}}>
                                             <LabelList dataKey="cumplimiento" position="bottom" fill="#f59e0b" fontSize={12} formatter={(v) => v + '%'} />
                                         </Line>
                                     </ComposedChart>
                                 </ResponsiveContainer>
                                </CardContent>
                            </Card>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                                {/* BRAND PIE CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg">Distribución por Marca</CardTitle>
                                        <CardDescription>Mercancía procesada total.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 flex-grow relative pb-0">
                                        {brandPieData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                 <PieChart>
                                                     <Pie data={brandPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" >
                                                         {brandPieData.map((entry, index) => (
                                                             <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                         ))}
                                                         <LabelList dataKey="name" position="outside" fontSize={11} fill="#888" stroke="none" />
                                                     </Pie>
                                                     <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(value) => value.toLocaleString('es-CO')} />
                                                 </PieChart>
                                             </ResponsiveContainer>
                                        ) : (
                                             <div className="flex h-full items-center justify-center bg-muted/20 rounded-lg text-muted-foreground text-sm">Sin datos</div>
                                        )}
                                    </CardContent>
                                </Card>
                                
                                {/* CATEGORY PIE CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg">Mix de Categorías</CardTitle>
                                        <CardDescription>Ropa vs Calzado.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 flex-grow relative pb-0">
                                        {productPieData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                 <PieChart>
                                                     <Pie data={productPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" >
                                                         {productPieData.map((entry, index) => (
                                                             <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                         ))}
                                                         <LabelList dataKey="name" position="outside" fontSize={11} fill="#888" stroke="none" />
                                                     </Pie>
                                                     <RechartsTooltip contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(value) => value.toLocaleString('es-CO')} />
                                                 </PieChart>
                                             </ResponsiveContainer>
                                        ) : (
                                             <div className="flex h-full items-center justify-center bg-muted/20 rounded-lg text-muted-foreground text-sm">Sin datos</div>
                                        )}
                                    </CardContent>
                                </Card>
                                
                                {/* PRODUCTIVITY HEATMAP / HOURLY CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg text-indigo-500">Carga por Hora</CardTitle>
                                        <CardDescription>Unidades Promedio Empacadas.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 pb-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                             <BarChart data={hourlyTrendData}>
                                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                                 <XAxis dataKey="hour" tick={{fill: '#888', fontSize: 11}} axisLine={false} tickLine={false} dy={5} />
                                                 <YAxis hide={true} />
                                                 <RechartsTooltip cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(v) => [`${v} UPH Promedio`, 'Carga']} />
                                                 <Bar dataKey="unitsAvg" fill="#6366f1" radius={[4, 4, 0, 0]} name="Promedio">
                                                     <LabelList dataKey="unitsAvg" position="top" fill="#6366f1" fontSize={11} formatter={(v) => v > 0 ? v : ''} />
                                                 </Bar>
                                             </BarChart>
                                         </ResponsiveContainer>
                                    </CardContent>
                                </Card>

                                {/* DEAD TIMES / FUGAS DE TIEMPO CHART */}
                                <Card className="shadow-sm border-muted/60 flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="text-lg flex items-center text-rose-500">Radar de Fugas Acum.</CardTitle>
                                        <CardDescription>Suma de paralizaciones.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="h-64 pb-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                             <BarChart data={deadTimeTrendData} layout="vertical" margin={{ left: 15 }}>
                                                 <CartesianGrid strokeDasharray="3 3" opacity={0.1} horizontal={false} />
                                                 <XAxis type="number" tickFormatter={(v) => `${v}h`} tick={{fill: '#888'}} axisLine={false} tickLine={false} />
                                                 <YAxis dataKey="reason" type="category" width={85} tick={{ fontSize: 11, fill: '#555', fontWeight: 500 }} axisLine={false} tickLine={false} />
                                                 <RechartsTooltip cursor={{fill: 'hsl(var(--muted))', opacity: 0.3}} contentStyle={{ borderRadius: '12px', background: 'hsl(var(--card))' }} formatter={(v) => [`${v} Horas`, 'Tiempo']} />
                                                 <Bar dataKey="horas" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={20} name="Horas Muertas">
                                                     <LabelList dataKey="horas" position="right" fill="#f43f5e" fontSize={10} formatter={(v) => v + 'h'} />
                                                 </Bar>
                                             </BarChart>
                                         </ResponsiveContainer>
                                    </CardContent>
                                </Card>
                            </div>
                            
                            {/* THE TRUE MATRIX: OPERATOR BREAKDOWN */}\n"""

content = re.sub(old_layout_regex, new_layout.replace('\\', '\\\\'), content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Dashboard architecture patched.")
