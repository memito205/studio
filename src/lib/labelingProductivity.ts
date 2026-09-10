import type { LabelingActivityLog, LabelingOperation, OperationPulse } from '@/types';

export type LabelingProductivityMetrics = {
  productiveTimeMinutes: number;
  unitsPerHour: number;
  compliance: number;
};

/**
 * Tiempo productivo desde START hasta FINISH (o ahora), restando pausas de la tarea y pulses.
 */
export function computeLabelingProductiveMinutes(
  logs: LabelingActivityLog[],
  operation: LabelingOperation,
  allExternalPulses: OperationPulse[] = [],
  nowMs: number = Date.now()
): number | null {
  const startLog = logs.find((l) => l.type === 'START');
  if (!startLog) return null;

  const finishLog = logs.find((l) => l.type === 'FINISH');
  const startTimeMs = new Date(startLog.timestamp).getTime();
  const finishTime = finishLog ? new Date(finishLog.timestamp).getTime() : nowMs;

  const relevantPulses = allExternalPulses.filter(
    (p) => p.isGlobal || p.userId === operation.assignedOperatorId
  );
  const activePulseFromContext = allExternalPulses.find(
    (p) => !p.endTime && (p.isGlobal || p.userId === operation.assignedOperatorId)
  );

  const rawIntervals = [
    ...logs
      .filter((l) => l.type === 'PAUSE')
      .map((p) => {
        const res = logs.find(
          (l) =>
            l.type === 'RESUME' &&
            new Date(l.timestamp).getTime() > new Date(p.timestamp).getTime()
        );
        return {
          start: new Date(p.timestamp).getTime(),
          end: res ? new Date(res.timestamp).getTime() : finishTime,
        };
      }),
    ...relevantPulses.map((p: OperationPulse) => ({
      start: new Date(p.startTime).getTime(),
      end: p.endTime ? new Date(p.endTime).getTime() : finishTime,
    })),
  ];

  if (
    activePulseFromContext &&
    !rawIntervals.some((r) => r.start === new Date(activePulseFromContext.startTime).getTime())
  ) {
    rawIntervals.push({
      start: new Date(activePulseFromContext.startTime).getTime(),
      end: finishTime,
    });
  }

  rawIntervals.sort((a, b) => a.start - b.start);
  const mergedIntervals: { start: number; end: number }[] = [];

  if (rawIntervals.length > 0) {
    let current = { ...rawIntervals[0] };
    for (let i = 1; i < rawIntervals.length; i++) {
      if (rawIntervals[i].start <= current.end) {
        current.end = Math.max(current.end, rawIntervals[i].end);
      } else {
        mergedIntervals.push(current);
        current = { ...rawIntervals[i] };
      }
    }
    mergedIntervals.push(current);
  }

  let totalPauseMillis = 0;
  mergedIntervals.forEach((p) => {
    const effStart = Math.max(p.start, startTimeMs);
    const effEnd = Math.min(p.end, finishTime);
    if (effEnd > effStart) {
      totalPauseMillis += effEnd - effStart;
    }
  });

  const totalMillis = finishTime - startTimeMs;
  return (totalMillis - totalPauseMillis) / 60000;
}

/** Unidades a usar para u/h: live en pack_units en curso; completed al finalizar. */
export function labelingUnitsForProductivity(operation: LabelingOperation): number {
  if (operation.status === 'Completada') {
    return operation.completedUnits ?? operation.totalUnits ?? 0;
  }
  if (operation.trackingMode === 'pack_units') {
    return operation.completedUnitsLive ?? 0;
  }
  return operation.completedUnits ?? 0;
}

export function computeLabelingProductivity(
  logs: LabelingActivityLog[],
  operation: LabelingOperation,
  allExternalPulses: OperationPulse[] = [],
  nowMs: number = Date.now()
): LabelingProductivityMetrics | null {
  const productiveMinutes = computeLabelingProductiveMinutes(
    logs,
    operation,
    allExternalPulses,
    nowMs
  );
  if (productiveMinutes == null) return null;
  if (productiveMinutes <= 0) {
    return { productiveTimeMinutes: 0, unitsPerHour: 0, compliance: 0 };
  }

  const unitsCompleted = labelingUnitsForProductivity(operation);
  const unitsPerHour = (unitsCompleted / productiveMinutes) * 60;
  const standard = operation.standard_units_per_hour || 0;
  const compliance = standard > 0 ? (unitsPerHour / standard) * 100 : 0;

  return {
    productiveTimeMinutes: productiveMinutes,
    unitsPerHour,
    compliance,
  };
}
