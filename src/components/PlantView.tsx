"use client";

import React, { useEffect, useMemo, useState } from 'react';
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

/** Dos operarios por pantalla: más espacio y lectura en TV. */
const PAGE_SIZE = 2;
/** Rotación más pausada (+2s vs. versión anterior). */
const SLICE_SECONDS = 10;

export const PlantView: React.FC<PlantViewProps> = React.memo(({ data, onReturnToDashboard }) => {
  const { packerProductivity, overallCompliance, deadTimeReport = [], microPausesReport = [] } = data;

  const rankedPackers = useMemo(
    () =>
      [...packerProductivity].sort((a, b) => {
        if (b.compliance !== a.compliance) return b.compliance - a.compliance;
        return b.productivity - a.productivity;
      }),
    [packerProductivity]
  );

  const totalPairs = rankedPackers.reduce((sum, packer) => sum + packer.totalQuantity, 0);
  const totalHours = rankedPackers.reduce((sum, packer) => sum + packer.hoursWorked, 0);
  const avgProductivity = totalHours > 0 ? totalPairs / totalHours : 0;

  const totalPages = Math.max(1, Math.ceil(rankedPackers.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  const packerSignature = useMemo(
    () => rankedPackers.map((p) => p.packerName).join('|'),
    [rankedPackers]
  );

  useEffect(() => {
    setPage(0);
  }, [packerSignature]);

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

  const pauseStatsFor = (packerName: string) => {
    const dead = deadTimeReport.filter((p) => p.packerName === packerName);
    const micro = microPausesReport.filter((p) => p.packerName === packerName);
    const pauseCount = dead.length + micro.length;
    const pauseMinutes =
      dead.reduce((s, p) => s + (p.duration || 0), 0) +
      micro.reduce((s, p) => s + (p.duration || 0), 0);
    return { pauseCount, pauseMinutes };
  };

  return (
    <div className="min-h-[85vh] space-y-4 bg-slate-100 dark:bg-gray-900 p-3 sm:p-5 lg:p-6 rounded-lg">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-3 py-2">
          <div>
            <CardTitle className="text-3xl md:text-4xl font-extrabold text-foreground">
              Productividad del Día
            </CardTitle>
            <CardDescription className="text-base md:text-lg text-muted-foreground mt-1">
              Modo TV · {PAGE_SIZE} operarios por pantalla
              {totalPages > 1 ? ` · cambio cada ${SLICE_SECONDS}s` : ''}
            </CardDescription>
          </div>
          <Button onClick={onReturnToDashboard} variant="outline" size="lg">
            <ArrowLeft className="mr-2 h-5 w-5" />
            Volver al Dashboard
          </Button>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Unidades Totales" value={totalPairs.toLocaleString()} icon={<Package />} color="text-amber-500" />
        <StatCard title="Operarios Activos" value={String(rankedPackers.length)} icon={<Clock />} color="text-blue-500" />
        <StatCard title="Productividad Media" value={`${avgProductivity.toFixed(1)} u/hr`} icon={<CheckCircle />} color="text-green-500" />
        <StatCard title="Cumplimiento General" value={`${overallCompliance.toFixed(0)}%`} icon={<Trophy />} color={getComplianceColor(overallCompliance)} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
          <CardTitle className="text-2xl md:text-3xl">Ranking de Productividad</CardTitle>
          {totalPages > 1 && (
            <div className="flex items-center gap-3 text-base md:text-lg text-muted-foreground">
              <span className="font-bold tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <div className="flex gap-2">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={`dot-${i}`}
                    type="button"
                    aria-label={`Ir al grupo ${i + 1}`}
                    onClick={() => setPage(i)}
                    className={`h-3 w-3 rounded-full transition-colors ${
                      i === page ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/70'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="pb-6">
          {pagePackers.length === 0 ? (
            <p className="text-center text-muted-foreground text-2xl py-16">Sin operarios para mostrar.</p>
          ) : (
            <div
              key={page}
              className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-700"
            >
              {pagePackers.map((packer) => {
                const rank = rankOf(packer);
                const { pauseCount, pauseMinutes } = pauseStatsFor(packer.packerName);
                const deducted = Math.round(packer.totalDeductedMinutes || 0);
                const microMin = Math.round(packer.totalMicroPausesMinutes || 0);

                return (
                  <div
                    key={packer.packerName}
                    className="rounded-2xl border-2 bg-card p-6 md:p-8 shadow-md flex flex-col min-h-[360px] md:min-h-[420px]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-5xl md:text-6xl font-black text-muted-foreground/70 tabular-nums leading-none">
                        #{rank}
                      </span>
                      <div className="text-right">
                        <p className="text-sm md:text-base uppercase tracking-wide text-muted-foreground font-semibold">
                          Cumplimiento
                        </p>
                        <p className={`text-5xl md:text-6xl font-black tabular-nums leading-none ${getComplianceColor(packer.compliance)}`}>
                          {packer.compliance.toFixed(0)}%
                        </p>
                      </div>
                    </div>

                    <p className="mt-5 text-3xl md:text-4xl lg:text-5xl font-black leading-tight break-words">
                      {packer.packerName}
                    </p>

                    <div className="mt-5">
                      <Progress
                        value={Math.min(packer.compliance, 100)}
                        className="h-5 w-full"
                        indicatorClassName={getProgressColor(packer.compliance)}
                      />
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-4 flex-1 content-start">
                      <div className="rounded-xl bg-muted/40 border px-4 py-3">
                        <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
                          Horas trabajadas
                        </p>
                        <p className="text-4xl md:text-5xl font-black tabular-nums mt-1">
                          {packer.hoursWorked.toFixed(1)}
                          <span className="text-xl md:text-2xl font-bold text-muted-foreground ml-1">h</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-muted/40 border px-4 py-3">
                        <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
                          Unidades
                        </p>
                        <p className="text-4xl md:text-5xl font-black tabular-nums mt-1">
                          {packer.totalQuantity.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-xl bg-muted/40 border px-4 py-3">
                        <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
                          Productividad
                        </p>
                        <p className="text-4xl md:text-5xl font-black tabular-nums mt-1">
                          {packer.productivity.toFixed(0)}
                          <span className="text-xl md:text-2xl font-bold text-muted-foreground ml-1">u/hr</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-muted/40 border px-4 py-3">
                        <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
                          Meta base
                        </p>
                        <p className="text-4xl md:text-5xl font-black tabular-nums mt-1">
                          {Math.round(packer.baseGoal || 0)}
                          <span className="text-xl md:text-2xl font-bold text-muted-foreground ml-1">u/hr</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-muted/40 border px-4 py-3 col-span-2">
                        <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-muted-foreground">
                          Pausas
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
                          <p className="text-4xl md:text-5xl font-black tabular-nums">
                            {pauseCount}
                            <span className="text-xl md:text-2xl font-bold text-muted-foreground ml-2">cant.</span>
                          </p>
                          <p className="text-3xl md:text-4xl font-black tabular-nums text-foreground/90">
                            {pauseMinutes}
                            <span className="text-lg md:text-xl font-bold text-muted-foreground ml-2">min total</span>
                          </p>
                          <p className="text-2xl md:text-3xl font-bold tabular-nums text-muted-foreground">
                            {microMin} min micro · {deducted} min descontados
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
});

PlantView.displayName = 'PlantView';
