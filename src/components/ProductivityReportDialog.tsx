/** @jsxImportSource react */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from './ui/button';
import { Loader2 } from 'lucide-react';
import { getPausesForOperation, getScannedItemsByReception, getAllUserProfiles, getUserGoals, getProductivitySettings } from '@/app/reception/actions';
import { getUserPulsesForDay } from '@/app/actions';
import { showError } from '@/lib/toast';
import type { ReceptionOperation, ScannedItem, OperationPause, AppUser, ProductivitySettings, UserGoal, UserProductivity, HourlyOperatorDetail, OperationPulse } from '@/types';
import { UserProductivityTable } from './UserProductivityTable';
import { UserHourlyPerformanceTable } from './UserHourlyPerformanceTable';
import PauseDetailsDialog from './PauseDetailsDialog';

interface ProductivityReportDialogProps {
  operation: ReceptionOperation;
  children: React.ReactNode;
}

interface UserHourlyPerformance {
  userId: string;
  userName: string;
  hourlyProductivity: { [hourKey: string]: HourlyOperatorDetail };
}

type PauseInterval = { start: number; end: number };

const toMs = (value: any): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const isPauseLikePulse = (pulse: OperationPulse) =>
  pulse.type === 'pause' || pulse.status === 'Pausado' || pulse.status === 'En Remisión';

const mergeIntervals = (intervals: PauseInterval[]): PauseInterval[] => {
  const sorted = intervals
    .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];

  const merged: PauseInterval[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= current.end) current.end = Math.max(current.end, sorted[i].end);
    else {
      merged.push(current);
      current = { ...sorted[i] };
    }
  }
  merged.push(current);
  return merged;
};

const calculateUserHourlyPerformance = (
  userItems: ScannedItem[],
  pauseIntervals: PauseInterval[],
  goal: number,
  userFirstActivity: Date,
  sessionEndTime: Date,
): { hourlyProductivity: { [hourKey: string]: HourlyOperatorDetail }, allHours: string[] } => {
  const hourlyPerformance: { [hourKey: string]: HourlyOperatorDetail } = {};
  if (userItems.length === 0 && pauseIntervals.length === 0) return { hourlyProductivity: {}, allHours: [] };

  const startHour = userFirstActivity.getHours();
  const endHour = sessionEndTime.getMinutes() > 0 || sessionEndTime.getSeconds() > 0
      ? sessionEndTime.getHours()
      : sessionEndTime.getHours() - 1;

  const allHours: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
      const hourDate = new Date(userFirstActivity.getFullYear(), userFirstActivity.getMonth(), userFirstActivity.getDate(), h);
      const hourKey = `${hourDate.getFullYear()}-${String(hourDate.getMonth() + 1).padStart(2, '0')}-${String(hourDate.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
      allHours.push(hourKey);

      const hourStartMs = Math.max(
          userFirstActivity.getTime(),
          new Date(userFirstActivity.getFullYear(), userFirstActivity.getMonth(), userFirstActivity.getDate(), h, 0, 0, 0).getTime()
      );
      
      const hourEndMs = Math.min(
          sessionEndTime.getTime(),
          new Date(userFirstActivity.getFullYear(), userFirstActivity.getMonth(), userFirstActivity.getDate(), h, 59, 59, 999).getTime()
      );

      if (hourEndMs <= hourStartMs) continue;

      const grossMinutesInHour = (hourEndMs - hourStartMs) / 60000;
      
      let pauseMinutesInHour = 0;
      pauseIntervals.forEach(p => {
          const pauseStart = p.start;
          const pauseEnd = p.end;
          
          const overlapStart = Math.max(hourStartMs, pauseStart);
          const overlapEnd = Math.min(hourEndMs, pauseEnd);

          if (overlapEnd > overlapStart) {
              pauseMinutesInHour += (overlapEnd - overlapStart) / 60000;
          }
      });
      
      const productiveMinutes = Math.max(0, grossMinutesInHour - pauseMinutesInHour);
      
      const itemsInHour = userItems.filter(item => {
          const scanTime = new Date(item.scanned_at).getTime();
          return scanTime >= hourStartMs && scanTime < hourEndMs;
      });

      const unitsInHour = itemsInHour.reduce((sum, item) => sum + item.quantity, 0);
      
      if (productiveMinutes > 0.001 || unitsInHour > 0) {
          const productivity = productiveMinutes > 0 ? (unitsInHour / productiveMinutes) * 60 : 0;
          const compliance = goal > 0 ? (productivity / goal) * 100 : 0;
          hourlyPerformance[hourKey] = {
              units: unitsInHour,
              productiveMinutes: productiveMinutes,
              baseGoal: goal,
              productivity: productivity,
              compliance: compliance,
              trend: null,
          };
      }
  }

  return { hourlyProductivity: hourlyPerformance, allHours };
};


const ProductivityReportDialog: React.FC<ProductivityReportDialogProps> = ({
  operation,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userProductivityData, setUserProductivityData] = useState<UserProductivity[]>([]);
  const [userHourlyPerformanceData, setUserHourlyPerformanceData] = useState<UserHourlyPerformance[]>([]);
  const [hours, setHours] = useState<string[]>([]);
  const [productivitySettings, setProductivitySettings] = useState<ProductivitySettings | null>(null);
  const [isPauseDetailsOpen, setIsPauseDetailsOpen] = useState(false);
  const [selectedPauseDetails, setSelectedPauseDetails] = useState<{ operation_rk_identifier: string; pauses: OperationPause[]; userName: string; } | null>(null);

 const fetchData = useCallback(async () => {
    if (!open) return;
    setLoading(true);

    try {
      const [allScannedItemsResult, allPausesResult, settingsResult, allUsersResult] = await Promise.all([
        getScannedItemsByReception(operation.id),
        getPausesForOperation(operation.id),
        getProductivitySettings(),
        getAllUserProfiles(),
      ]);

      const opData = operation;
      if (!opData) {
        throw new Error("Operación no encontrada.");
      }
      setProductivitySettings(settingsResult.data || null);

      const allItems = allScannedItemsResult.data || [];
      const allPausesForOperation = (allPausesResult.data || []).map(p => ({
          ...p,
          start_time: new Date(p.start_time),
          end_time: p.end_time ? new Date(p.end_time) : null
      }));
      const usersMap = new Map((allUsersResult || []).map(u => [u.uid, u.displayName || u.email || 'Desconocido']));
      
      const userIdsFromScans = new Set(allItems.map(item => item.user_id));
      const userIdsFromPauses = new Set(allPausesForOperation.map(pause => pause.user_id));
      const allRelevantUserIds = new Set([...userIdsFromScans, ...userIdsFromPauses]);
      
      const goalsByUserId = new Map<string, UserGoal>();
      const userGoalsPromises = Array.from(allRelevantUserIds).map(uid => getUserGoals(uid));
      const userGoalsResults = await Promise.all(userGoalsPromises);
      userGoalsResults.forEach((res, index) => {
        if (res.success && res.data) {
          goalsByUserId.set(Array.from(allRelevantUserIds)[index], res.data);
        }
      });
      
      const productivityData: UserProductivity[] = [];
      const hourlyPerformanceData: UserHourlyPerformance[] = [];
      const operationHoursSet = new Set<string>();
      
      for (const userId of allRelevantUserIds) {
        const userName = usersMap.get(userId) || userId;
        const userItems = allItems.filter(i => i.user_id === userId);
        const userPauses = allPausesForOperation.filter(p => p.user_id === userId);

        if (userItems.length === 0) continue;
        
        const scanTimes = userItems
            .map(i => toMs(i.scanned_at))
            .filter((t): t is number => t !== null);

        if (scanTimes.length === 0) continue;
        
        const firstScanMs = Math.min(...scanTimes);
        const userFirstActivityTime = new Date(firstScanMs);
        
        const nowMs = Date.now();
        let sessionEndMs = nowMs;
        if (opData.end_time) {
            sessionEndMs = toMs(opData.end_time) ?? nowMs;
        } else if (opData.status !== 'in_progress' && opData.status !== 'paused') {
            const lastActivityTimes = [
                ...scanTimes,
                ...userPauses
                    .filter(p => p.end_time)
                    .map(p => toMs(p.end_time))
                    .filter((t): t is number => t !== null),
            ];
            sessionEndMs = lastActivityTimes.length > 0 ? Math.max(...lastActivityTimes) : firstScanMs;
        }
        const sessionEndTime = new Date(sessionEndMs);

        const operationPauseIntervals: PauseInterval[] = userPauses
            .map(p => ({
                start: toMs(p.start_time) ?? NaN,
                end: toMs(p.end_time) ?? nowMs,
            }))
            .filter(p => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start);

        const pulseDate = userFirstActivityTime.toLocaleDateString('sv-SE');
        const pulseResult = await getUserPulsesForDay(userId, pulseDate);
        const pulsePauseIntervals: PauseInterval[] = (pulseResult.data || [])
            .filter(isPauseLikePulse)
            .map(p => ({
                start: toMs(p.startTime) ?? NaN,
                end: toMs(p.endTime) ?? nowMs,
            }))
            .filter(p => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start);

        const mergedPauseIntervals = mergeIntervals([...operationPauseIntervals, ...pulsePauseIntervals]);
        const grossDurationMs = Math.max(0, sessionEndTime.getTime() - userFirstActivityTime.getTime());

        let totalPauseDurationMs = 0;
        mergedPauseIntervals.forEach(p => {
          const overlapStart = Math.max(p.start, userFirstActivityTime.getTime());
          const overlapEnd = Math.min(p.end, sessionEndTime.getTime());
          if (overlapEnd > overlapStart) totalPauseDurationMs += (overlapEnd - overlapStart);
        });

        const effectiveTimeMinutes = Math.max(0, (grossDurationMs - totalPauseDurationMs) / 60000);
        const totalScanned = userItems.reduce((sum, i) => sum + i.quantity, 0);
        const productivityPerHour = effectiveTimeMinutes > 0 ? (totalScanned / effectiveTimeMinutes) * 60 : 0;
        
        const userGoals = goalsByUserId.get(userId);
        const goal = opData.standard_units_per_hour ?? userGoals?.hourly_productivity_goal ?? settingsResult.data?.standard_per_hour_goal ?? 0;
        const compliance = goal > 0 ? (productivityPerHour / goal) * 100 : 0;

        const { hourlyProductivity, allHours } = calculateUserHourlyPerformance(userItems, mergedPauseIntervals, goal, userFirstActivityTime, sessionEndTime);
        allHours.forEach(hourKey => operationHoursSet.add(hourKey));
        
        hourlyPerformanceData.push({
            userId: userId,
            userName: userName,
            hourlyProductivity: hourlyProductivity,
        });

        productivityData.push({
          userId: userId,
          userName: userName,
          totalScanned,
          effectiveTimeMinutes,
          pausesCount: userPauses.length + pulsePauseIntervals.length,
          productivityPerHour,
          compliance,
          operation_rk_identifier: opData.rk_identifier,
          pauses: userPauses,
        });
      }
      
      setUserProductivityData(productivityData.sort((a, b) => b.totalScanned - a.totalScanned));
      setUserHourlyPerformanceData(hourlyPerformanceData);
      setHours(Array.from(operationHoursSet).sort());

    } catch (e: any) {
      showError("Error al cargar datos del reporte", e.message);
    } finally {
      setLoading(false);
    }
  }, [operation, open]);

  useEffect(() => {
    if(open) {
      fetchData();
    }
  }, [fetchData, open]);
  
  const handleViewPauseDetails = (user: UserProductivity) => {
    setSelectedPauseDetails({
        operation_rk_identifier: user.operation_rk_identifier,
        pauses: user.pauses,
        userName: user.userName,
    });
    setIsPauseDetailsOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Reporte de Productividad</DialogTitle>
            <DialogDescription>
              {operation ? `RK: ${operation.rk_identifier} - ${operation.supplier}` : 'Cargando...'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-grow overflow-y-auto space-y-6 pr-6">
              {loading ? (
                  <div className="flex justify-center items-center h-full">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  </div>
              ) : (
                  <>
                      <UserProductivityTable data={userProductivityData} goal={operation?.standard_units_per_hour ?? productivitySettings?.standard_per_hour_goal ?? null} onViewPauses={handleViewPauseDetails} />
                      <UserHourlyPerformanceTable data={userHourlyPerformanceData} hours={hours} />
                  </>
              )}
          </div>
        </DialogContent>
      </Dialog>
      
      {selectedPauseDetails && (
        <PauseDetailsDialog
            open={isPauseDetailsOpen}
            onOpenChange={setIsPauseDetailsOpen}
            report={selectedPauseDetails}
        />
      )}
    </>
  );
};

export default ProductivityReportDialog;
