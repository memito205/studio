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
import { showError } from '@/lib/toast';
import type { ReceptionOperation, ScannedItem, OperationPause, AppUser, ProductivitySettings, UserGoal, UserProductivity, HourlyOperatorDetail } from '@/types';
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

const calculateUserHourlyPerformance = (
  userItems: ScannedItem[],
  userPauses: OperationPause[],
  goal: number,
  userFirstActivity: Date,
  sessionEndTime: Date,
): { hourlyProductivity: { [hourKey: string]: HourlyOperatorDetail }, allHours: string[] } => {
  const hourlyPerformance: { [hourKey: string]: HourlyOperatorDetail } = {};
  if (userItems.length === 0 && userPauses.length === 0) return { hourlyProductivity: {}, allHours: [] };

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
      userPauses.forEach(p => {
          const pauseStart = p.start_time.getTime();
          const pauseEnd = p.end_time?.getTime() ?? sessionEndTime.getTime();
          
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

        if (userItems.length === 0 && userPauses.length === 0) continue;
        
        const activityTimes = [
            ...userItems.map(i => new Date(i.scanned_at).getTime()),
            ...userPauses.map(p => p.start_time.getTime())
        ].filter(t => !isNaN(t));

        if(activityTimes.length === 0) continue;
        
        const userFirstActivityTime = new Date(Math.min(...activityTimes));
        
        let sessionEndTime = opData.status === 'in_progress' ? new Date() : userFirstActivityTime;
        if (opData.end_time) {
            sessionEndTime = new Date(opData.end_time);
        } else {
             const lastActivityTimes = [
                ...userItems.map(i => new Date(i.scanned_at).getTime()),
                ...userPauses.filter(p => p.end_time).map(p => new Date(p.end_time!).getTime()),
             ].filter(t => !isNaN(t));
             if(lastActivityTimes.length > 0) {
                 sessionEndTime = new Date(Math.max(...lastActivityTimes));
             }
             if (opData.status === 'in_progress') {
                 sessionEndTime = new Date(); // Override to now if still in progress
             }
        }

        const grossDurationMs = sessionEndTime.getTime() - userFirstActivityTime.getTime();
        
        let totalPauseDurationMs = 0;
        userPauses.forEach(p => {
          const pauseStart = p.start_time.getTime();
          const pauseEnd = p.end_time?.getTime() ?? sessionEndTime.getTime();
          totalPauseDurationMs += (pauseEnd - pauseStart);
        });

        const effectiveTimeMinutes = Math.max(0, (grossDurationMs - totalPauseDurationMs) / 60000);
        const totalScanned = userItems.reduce((sum, i) => sum + i.quantity, 0);
        const productivityPerHour = effectiveTimeMinutes > 0 ? (totalScanned / effectiveTimeMinutes) * 60 : 0;
        
        const userGoals = goalsByUserId.get(userId);
        const goal = opData.standard_units_per_hour ?? userGoals?.hourly_productivity_goal ?? settingsResult.data?.standard_per_hour_goal ?? 0;
        const compliance = goal > 0 ? (productivityPerHour / goal) * 100 : 0;

        const { hourlyProductivity, allHours } = calculateUserHourlyPerformance(userItems, userPauses, goal, userFirstActivityTime, sessionEndTime);
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
          pausesCount: userPauses.length,
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
