
import { TulaRotation, AnalysisResults } from '@/types';
import { format, startOfWeek, startOfMonth, parseISO } from 'date-fns';

export function calculateAnalysis(
  rotations: TulaRotation[],
  stockTulas: number,
  cicloTulas: number
): AnalysisResults {
  if (!rotations || rotations.length === 0) {
    return {
      peakTulasNeeded: 0,
      peakSmallPackagesNeeded: 0,
      isStockSufficient: true,
      stockDifference: stockTulas,
      smallRotationsPercentage: 0,
      smallRotationsByStore: [],
      stockByStore: [],
      rotationsByWeek: [],
      rotationsByMonth: [],
      dailyCirculationData: [],
      dailySimulationLog: []
    };
  }

  // 1. Daily simulation of circulation
  const dailyData: Record<string, { in: number; out: number }> = {};
  
  rotations.forEach(r => {
    const outDate = new Date(r.fecha);
    const dateStr = outDate.toISOString().split('T')[0];
    
    if (!dailyData[dateStr]) dailyData[dateStr] = { in: 0, out: 0 };
    dailyData[dateStr].out += r.cantidad;
    
    // Tulas return after cicloTulas days
    const inDate = new Date(outDate);
    inDate.setDate(inDate.getDate() + cicloTulas);
    const inDateStr = inDate.toISOString().split('T')[0];
    
    if (!dailyData[inDateStr]) dailyData[inDateStr] = { in: 0, out: 0 };
    dailyData[inDateStr].in += r.cantidad;
  });

  const sortedDates = Object.keys(dailyData).sort();
  let currentInCirculation = 0;
  const dailyCirculationData: { date: string; tulasEnCirculacion: number }[] = [];
  const dailySimulationLog: { date: string; tulasOut: number; tulasIn: number; tulasInCirculacion: number }[] = [];

  sortedDates.forEach(date => {
    const day = dailyData[date];
    currentInCirculation += (day.out - day.in);
    
    dailyCirculationData.push({
      date,
      tulasEnCirculacion: currentInCirculation
    });
    
    dailySimulationLog.push({
      date,
      tulasOut: day.out,
      tulasIn: day.in,
      tulasInCirculacion: currentInCirculation
    });
  });

  const peakTulasNeeded = Math.max(...dailyCirculationData.map(d => d.tulasEnCirculacion));

  // 2. Aggregations by Store
  const storeStats: Record<string, { rotationCount: number; weeklySum: number; days: Set<string> }> = {};
  rotations.forEach(r => {
    if (!storeStats[r.bodegaDestino]) {
      storeStats[r.bodegaDestino] = { rotationCount: 0, weeklySum: 0, days: new Set() };
    }
    storeStats[r.bodegaDestino].rotationCount += r.cantidad;
    storeStats[r.bodegaDestino].days.add(new Date(r.fecha).toISOString().split('T')[0]);
  });

  const stockByStore = Object.entries(storeStats).map(([store, stats]) => {
    const daysCount = stats.days.size || 1;
    const weeklyAvg = (stats.rotationCount / (daysCount / 7)) || 0;
    const dailyAvg = stats.rotationCount / daysCount;
    const recommendedStock = Math.ceil(dailyAvg * 2); // Rule of thumb: 2 days of stock
    
    return {
      store,
      recommendedStock,
      rotationCount: stats.rotationCount,
      weeklyAvg,
      dailyAvg
    };
  }).sort((a, b) => b.rotationCount - a.rotationCount);

  // 3. Time Aggregations
  const weekMap: Record<string, number> = {};
  const monthMap: Record<string, number> = {};

  rotations.forEach(r => {
    const d = new Date(r.fecha);
    const weekKey = format(startOfWeek(d), 'yyyy-MM-dd');
    const monthKey = format(startOfMonth(d), 'yyyy-MM');
    
    weekMap[weekKey] = (weekMap[weekKey] || 0) + r.cantidad;
    monthMap[monthKey] = (monthMap[monthKey] || 0) + r.cantidad;
  });

  const rotationsByWeek = Object.entries(weekMap).map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week));
  const rotationsByMonth = Object.entries(monthMap).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month));

  // 4. Small Rotations (Alerts)
  const smallRotationsByStore = stockByStore
    .filter(s => s.rotationCount < 5)
    .map(s => ({
      store: s.store,
      rotationCount: s.rotationCount,
      recommendedStock: s.recommendedStock
    }));

  return {
    peakTulasNeeded,
    peakSmallPackagesNeeded: 0, // Placeholder if needed
    isStockSufficient: stockTulas >= peakTulasNeeded,
    stockDifference: stockTulas - peakTulasNeeded,
    smallRotationsPercentage: (smallRotationsByStore.length / stockByStore.length) * 100 || 0,
    smallRotationsByStore,
    stockByStore,
    rotationsByWeek,
    rotationsByMonth,
    dailyCirculationData,
    dailySimulationLog
  };
}
