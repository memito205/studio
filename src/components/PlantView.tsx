"use client";

import React, { useEffect, useState } from 'react';
import type { PackerProductivity, ProcessedReportData } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, CheckCircle, Clock, Package, Trophy } from 'lucide-react';
import { StatCard } from './StatCard';
import { Progress } from './ui/progress';

interface PlantViewProps {
  data: ProcessedReportData;
  onReturnToDashboard: () => void;
  theme: 'light' | 'dark';
}

/** Empacadores visibles a la vez en modo TV (letra grande). */
const PAGE_SIZE = 3;
/** Segundos entre cada slice del carrusel. */
const SLICE_SECONDS = 8;

export const PlantView: React.FC<PlantViewProps> = ({ data, onReturnToDashboard }) => {
  const { packerProductivity, overallCompliance } = data;

  const rankedPackers = [...packerProductivity].sort((a, b) => {
    if (b.compliance !== a.compliance) return b.compliance - a.compliance;
    return b.productivity - a.productivity;
  });

  const totalPairs = rankedPackers.reduce((sum, packer) => sum + packer.totalQuantity, 0);
  const totalHours = rankedPackers.reduce((sum, packer) => sum + packer.hoursWorked, 0);
  const avgProductivity = totalHours > 0 ? totalPairs / totalHours : 0;

  const totalPages = Math.max(1, Math.ceil(rankedPackers.length / PAGE_SIZE));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [rankedPackers.length]);

  useEffect(() => {
    if (totalPages <= 1) return;
    const id = window.setInterval(() => {
      setPage((prev) => (prev + 1) % totalPages);
    }, SLICE_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [totalPages]);

  const pagePackers = rankedPackers.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const getComplianceColor = (compliance: number): string => {
    if (compliance >= 100) return 'text-green-500';
    if (compliance >= 85) return 'text-amber-500';
    return 'text-red-500';
  };

  const getProgressColor = (compliance: number): string => {
    if (compliance >= 100) return 'bg-green-500';
    if (compliance >= 85) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const rankOf = (packer: PackerProductivity) =>
    rankedPackers.findIndex((p) => p.packerName === packer.packerName) + 1;

  return (
    <div className="min-h-[80vh] space-y-5 bg-slate-100 dark:bg-gray-900 p-4 sm:p-6 lg:p-8 rounded-lg">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-3 pb-2">
          <div>
            <CardTitle className="text-3xl md:text-5xl font-extrabold text-foreground">
              Productividad del Día
            </CardTitle>
            <CardDescription className="text-lg md:text-xl text-muted-foreground mt-2">
              Modo TV: se muestran {Math.min(PAGE_SIZE, rankedPackers.length || PAGE_SIZE)} operarios a la vez
              {totalPages > 1 ? ` · rotación cada ${SLICE_SECONDS}s` : ''}.
            </CardDescription>
          </div>
          <Button onClick={onReturnToDashboard} variant="outline" size="lg" className="mt-2 md:mt-0">
            <ArrowLeft className="mr-2 h-5 w-5" />
            Volver al Dashboard
          </Button>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Unidades Totales" value={totalPairs.toLocaleString()} icon={<Package />} color="text-amber-500" />
        <StatCard title="Operarios Activos" value={String(rankedPackers.length)} icon={<Clock />} color="text-blue-500" />
        <StatCard title="Productividad Media" value={`${avgProductivity.toFixed(2)} u/hr`} icon={<CheckCircle />} color="text-green-500" />
        <StatCard title="Cumplimiento General" value={`${overallCompliance.toFixed(1)}%`} icon={<Trophy />} color={getComplianceColor(overallCompliance)} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-3 py-4">
          <CardTitle className="text-2xl md:text-3xl">Ranking de Productividad</CardTitle>
          {totalPages > 1 && (
            <div className="flex items-center gap-3 text-sm md:text-base text-muted-foreground">
              <span className="font-semibold tabular-nums">
                Grupo {page + 1} / {totalPages}
              </span>
              <div className="flex gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={`dot-${i}`}
                    type="button"
                    aria-label={`Ir al grupo ${i + 1}`}
                    onClick={() => setPage(i)}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      i === page ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/70'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="pb-8">
          {pagePackers.length === 0 ? (
            <p className="text-center text-muted-foreground text-xl py-16">Sin operarios para mostrar.</p>
          ) : (
            <div
              key={page}
              className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-in fade-in duration-500"
            >
              {pagePackers.map((packer) => {
                const rank = rankOf(packer);
                return (
                  <div
                    key={packer.packerName}
                    className="rounded-2xl border bg-card p-5 md:p-6 shadow-sm flex flex-col justify-between min-h-[280px] md:min-h-[320px]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-4xl md:text-5xl font-black text-muted-foreground/80 tabular-nums">
                        #{rank}
                      </span>
                      <span className={`text-3xl md:text-4xl font-black tabular-nums ${getComplianceColor(packer.compliance)}`}>
                        {packer.compliance.toFixed(0)}%
                      </span>
                    </div>

                    <p className="mt-4 text-2xl md:text-3xl lg:text-4xl font-extrabold leading-tight break-words">
                      {packer.packerName}
                    </p>

                    <div className="mt-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <Progress
                          value={Math.min(packer.compliance, 100)}
                          className="h-4 w-full"
                          indicatorClassName={getProgressColor(packer.compliance)}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">Horas</p>
                          <p className="text-2xl md:text-3xl font-bold tabular-nums">{packer.hoursWorked.toFixed(1)}</p>
                        </div>
                        <div>
                          <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">u/hr</p>
                          <p className="text-2xl md:text-3xl font-bold tabular-nums">{packer.productivity.toFixed(0)}</p>
                        </div>
                        <div>
                          <p className="text-xs md:text-sm text-muted-foreground uppercase tracking-wide">Unid.</p>
                          <p className="text-2xl md:text-3xl font-bold tabular-nums">
                            {packer.totalQuantity.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
