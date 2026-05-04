
import type { StockItem, DistributionRule, Allocation, BoxCurveRule } from '../types';

// Helper to add an item to the allocation structure
const allocateItem = (
  allocs: Allocation,
  bodega: string,
  ref: string,
  talla: string,
  quantity: number
) => {
  const storeRef = allocs[bodega][ref];
  storeRef.allocated += quantity;

  const existingItem = storeRef.items.find((item) => item.talla === talla);
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    storeRef.items.push({ talla, quantity });
  }
};

// Helper to sort size strings numerically (e.g., "80", "90", "100")
const sortSizesNumerically = (sizes: string[]): string[] => {
    return sizes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
};

/**
 * Calculates box curves automatically from stock data.
 * @param stockData The stock data to analyze.
 * @returns An array of box curve rules.
 */
export const calculateAutoCurves = (stockData: StockItem[]): BoxCurveRule[] => {
  const refGroups: Record<string, Record<string, number>> = {};
  
  stockData.forEach(item => {
    const ref = String(item.REFERENCIA).trim();
    const talla = String(item.TALLA).trim();
    const cant = Number(item['CANTD LEIDA']);
    
    if (!refGroups[ref]) {
      refGroups[ref] = {};
    }
    
    refGroups[ref][talla] = (refGroups[ref][talla] || 0) + cant;
  });

  const autoCurves: BoxCurveRule[] = [];
  
  Object.entries(refGroups).forEach(([ref, sizes]) => {
    const totalUnits = Object.values(sizes).reduce((sum, qty) => sum + qty, 0);
    if (totalUnits === 0) return;

    // Normal box size is 12 as per user request
    const numBoxes = totalUnits / 12;
    
    Object.entries(sizes).forEach(([talla, cant]) => {
      const curveValue = Math.round(cant / numBoxes);
      if (curveValue > 0) {
        autoCurves.push({
          REFERENCIA: ref,
          TALLA: talla,
          CANTIDAD_CURVA: curveValue
        });
      }
    });
  });

  return autoCurves;
};

/**
 * Distributes merchandise using a hybrid strategy.
 * It first attempts to allocate full boxes based on a "box curve" if the order quantity is a multiple of the box size.
 * For remaining items or orders not matching box multiples, it uses an adaptive, balanced round-robin strategy.
 */
export const distribute = (
  stockData: StockItem[],
  planData: DistributionRule[],
  curveData: BoxCurveRule[] | null
): Allocation => {
  // 1. Process stock into a more efficient map structure
  const stockMap = new Map<string, Map<string, number>>();
  for (const item of stockData) {
    const ref = String(item.REFERENCIA).trim();
    const talla = String(item.TALLA).trim();
    if (!stockMap.has(ref)) {
      stockMap.set(ref, new Map());
    }
    const sizeMap = stockMap.get(ref)!;
    sizeMap.set(talla, (sizeMap.get(talla) || 0) + Number(item['CANTD LEIDA']));
  }

  // 1.5. Process curve data into a usable map
  const curves = new Map<string, { totalInBox: number; curve: Map<string, number> }>();
  if (curveData) {
    for (const rule of curveData) {
      const ref = String(rule.REFERENCIA).trim();
      const talla = String(rule.TALLA).trim();
      const cant = Number(rule.CANTIDAD_CURVA);

      if (cant > 0) {
        if (!curves.has(ref)) {
          curves.set(ref, { totalInBox: 0, curve: new Map() });
        }
        const curveInfo = curves.get(ref)!;
        curveInfo.curve.set(talla, (curveInfo.curve.get(talla) || 0) + cant);
      }
    }
    // Calculate totalInBox for each curve
    for (const curveInfo of curves.values()) {
        curveInfo.totalInBox = Array.from(curveInfo.curve.values()).reduce((sum, qty) => sum + qty, 0);
    }
  }

  // 2. Process the distribution plan and initialize the allocation structure
  const allocations: Allocation = {};
  const planByRef = new Map<string, { bodega: string; cant: number }[]>();
  
  for (const rule of planData) {
    const ref = String(rule.REFERENCIA).trim();
    const bodega = String(rule.BODEGA).trim();
    const cant = Number(rule.CANT);

    if (!allocations[bodega]) {
      allocations[bodega] = {};
    }
    if (!allocations[bodega][ref]) {
      allocations[bodega][ref] = {
        items: [],
        requested: 0,
        allocated: 0,
      };
    }
    allocations[bodega][ref].requested += cant;

    if (!planByRef.has(ref)) {
      planByRef.set(ref, []);
    }
    planByRef.get(ref)!.push({ bodega, cant });
  }

  // 3. Perform the distribution, reference by reference.
  for (const [ref, stores] of planByRef.entries()) {
    const currentStock = stockMap.get(ref);
    if (!currentStock || currentStock.size === 0) continue;
    
    const sortedStores = stores.sort((a, b) => a.bodega.localeCompare(b.bodega));
    const curveInfo = curves.get(ref);

    // --- Pre-allocation pass for full box curves ---
    if (curveInfo && curveInfo.totalInBox > 0) {
      for (const store of sortedStores) {
        const storeAllocation = allocations[store.bodega][ref];
        if (storeAllocation.allocated >= storeAllocation.requested) continue;

        if (store.cant > 0 && store.cant % curveInfo.totalInBox === 0) {
          const numBoxes = store.cant / curveInfo.totalInBox;
          
          let canFulfillCurve = true;
          for (const [talla, qtyPerBox] of curveInfo.curve.entries()) {
            const requiredQty = qtyPerBox * numBoxes;
            if ((currentStock.get(talla) || 0) < requiredQty) {
              canFulfillCurve = false;
              break;
            }
          }

          if (canFulfillCurve) {
            for (const [talla, qtyPerBox] of curveInfo.curve.entries()) {
              const qtyToAllocate = qtyPerBox * numBoxes;
              allocateItem(allocations, store.bodega, ref, talla, qtyToAllocate);
              currentStock.set(talla, currentStock.get(talla)! - qtyToAllocate);
            }
          }
        }
      }
    }

    // --- Adaptive round-robin for remaining items ---
    const allSizesForRef = sortSizesNumerically(Array.from(currentStock.keys()));
    const totalStockForRef = Array.from(currentStock.values()).reduce((sum, qty) => sum + qty, 0);
    const sortedStockBySize = [...currentStock.entries()].sort((a, b) => b[1] - a[1]);
    const topTwoStock = (sortedStockBySize[0]?.[1] || 0) + (sortedStockBySize[1]?.[1] || 0);
    const isUnbalanced = allSizesForRef.length > 4 && totalStockForRef > 0 && topTwoStock / totalStockForRef > 0.7;

    let stillDistributing = true;
    while(stillDistributing) {
        stillDistributing = false;

        for (const store of sortedStores) {
            const storeAllocation = allocations[store.bodega][ref];

            if (storeAllocation.allocated >= storeAllocation.requested) {
                continue;
            }

            const availableSizes = allSizesForRef.filter(s => (currentStock.get(s) || 0) > 0);
            if (availableSizes.length === 0) continue;

            const storeCounts = new Map<string, number>();
            storeAllocation.items.forEach(item => storeCounts.set(item.talla, item.quantity));
            
            let minCount = Infinity;
            for(const size of availableSizes) {
                const count = storeCounts.get(size) || 0;
                if(count < minCount) {
                    minCount = count;
                }
            }
            
            let searchOrder: string[];
            const needsDispersal = store.cant < availableSizes.length;

            if (needsDispersal) {
                const evens = availableSizes.filter((_, i) => i % 2 === 0);
                const odds = availableSizes.filter((_, i) => i % 2 !== 0);
                searchOrder = [...evens, ...odds];
            } else if (isUnbalanced) {
                searchOrder = [...availableSizes].sort((a, b) => (currentStock.get(a) || 0) - (currentStock.get(b) || 0));
            } else {
                searchOrder = availableSizes;
            }

            let bestSizeToAllocate: string | null = null;
            for (const size of searchOrder) {
                const storeCountForSize = storeCounts.get(size) || 0;
                if (storeCountForSize === minCount) {
                    bestSizeToAllocate = size;
                    break;
                }
            }
            
            if (bestSizeToAllocate) {
                allocateItem(allocations, store.bodega, ref, bestSizeToAllocate, 1);
                currentStock.set(bestSizeToAllocate, currentStock.get(bestSizeToAllocate)! - 1);
                stillDistributing = true;
            }
        }
    }
  }
  
  // 4. Final cleanup: Sort allocated items by size for consistent display.
  for (const bodega in allocations) {
    for (const ref in allocations[bodega]) {
      allocations[bodega][ref].items.sort((a, b) => a.talla.localeCompare(b.talla, undefined, { numeric: true }));
    }
  }

  return allocations;
};