

"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, AlertTriangle } from 'lucide-react';
import { getReceptionOperationById, getExpectedItemsByReception, getProductsByBarcodes, getLocations, createPackingUnit, startOperationPause, endOperationPause, updateReceptionOperation, addScannedItem, deleteScannedItem, getActivePauseForUser, updatePackingUnit, registerNovelty, getScannedItemsByReception } from '@/app/reception/actions';
import { getUserGoals, getProductivitySettings, getUserPulsesForDay } from '@/app/actions';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import type { ReceptionOperation, ScannedItem, ProductDatabaseItem, PackingUnit, Location, OperationPause, ReceptionExpectedItem, UserGoal, PackedItem, ProductivitySettings, OperationPulse } from '@/types';
import { ReceptionScanInput } from './ReceptionScanInput';
import ReceptionScannedItemsList from './ReceptionScannedItemsList';
import ReceptionSummary from './ReceptionSummary';
import { ReceptionProductDetails } from './ReceptionProductDetails';
import { ReceptionControlButtons } from './ReceptionControlButtons';
import { CreateProductDialog } from './CreateProductDialog';
import PauseReasonDialog from './PauseReasonDialog';
import { firestore } from '@/services/firebase'; 
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'; 
import { UnexpectedItemDialog } from './UnexpectedItemDialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';


interface ReceptionReadingScreenProps {
  operationId: string;
  onReturnToOperations: () => void;
}

interface UserProductivityMetrics {
    timeSpentInMinutes: number;
    actualProductivity: number;
}


export const ReceptionReadingScreen: React.FC<ReceptionReadingScreenProps> = ({ operationId, onReturnToOperations }) => {
  const { user, role } = useAuth();
  const { toast } = useToast();

  const [operation, setOperation] = useState<ReceptionOperation | null>(null);
  const [userScannedItems, setUserScannedItems] = useState<ScannedItem[]>([]);
  const [currentReferenceStats, setCurrentReferenceStats] = useState<{ totalScanned: number, uniquePackingUnitsCount: number } | null>(null);
  const [allPauses, setAllPauses] = useState<OperationPause[]>([]);
  const [activePause, setActivePause] = useState<OperationPause | null>(null);
  const [expectedItems, setExpectedItems] = useState<ReceptionExpectedItem[]>([]);
  const [packingUnits, setPackingUnits] = useState<PackingUnit[]>([]);
  const [userGoals, setUserGoals] = useState<UserGoal | null>(null);
  const [productivitySettings, setProductivitySettings] = useState<ProductivitySettings | null>(null);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  
  const [currentScannedProductDetails, setCurrentScannedProductDetails] = useState<ProductDatabaseItem | null>(null);
  const [productNotFoundBarcode, setProductNotFoundBarcode] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [userProductivity, setUserProductivity] = useState<UserProductivityMetrics>({ timeSpentInMinutes: 0, actualProductivity: 0 });

  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
  const [unexpectedItem, setUnexpectedItem] = useState<ProductDatabaseItem | null>(null);
  const [productDB, setProductDB] = useState<ProductDatabaseItem[]>([]);
  const [mixedReferenceError, setMixedReferenceError] = useState<{ show: boolean, expected: string, scanned: string } | null>(null);


  
  const { isPaused, currentPulse, globalPulse, allPulses } = useSuitePulse();

  const fetchInitialData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
        const opResult = await getReceptionOperationById(operationId);
        if (opResult.success && opResult.data) {
            setOperation(opResult.data);
        } else {
            throw new Error(opResult.error || 'No se pudo cargar la operación.');
        }
        
        const goalsResult = await getUserGoals(user.uid);
        if(goalsResult.success && goalsResult.data) {
            setUserGoals(goalsResult.data);
        }

        const settingsResult = await getProductivitySettings();
        if(settingsResult.success && settingsResult.data) {
            setProductivitySettings(settingsResult.data);
        }
        
        const expectedItemsResult = await getExpectedItemsByReception(operationId);
        const fetchedExpectedItems = expectedItemsResult.data || [];
        setExpectedItems(fetchedExpectedItems);
        
        const scannedItemsResult = await getScannedItemsByReception(operationId);
        const fetchedScannedItems = scannedItemsResult.data || [];

        const expectedBarcodes = new Set(fetchedExpectedItems.map(item => item.barcode));
        const scannedBarcodes = new Set(fetchedScannedItems.map(item => item.barcode));
        const uniqueBarcodes = [...new Set([...expectedBarcodes, ...scannedBarcodes])];
        
        if (uniqueBarcodes.length > 0) {
            const productsResult = await getProductsByBarcodes(uniqueBarcodes);
            if(productsResult.data) {
                setProductDB(productsResult.data);
            }
        }

        const locationsResult = await getLocations();
        if(locationsResult.success && locationsResult.data) {
          setAllLocations(locationsResult.data);
        }
        

    } catch(e: any) {
        setError(e.message);
        toast({ variant: 'destructive', title: 'Error al cargar datos', description: e.message });
    } finally {
        setIsLoading(false);
    }
  }, [operationId, user, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  
  // Real-time listener for SCANS
  useEffect(() => {
    if (!operationId || !user?.uid) return;

    // Listener for current user's scans
    const qUserScans = query(
        collection(firestore, "scannedItems"), 
        where("reception_id", "==", operationId),
        where("user_id", "==", user.uid)
    );
    const unsubscribeUserScans = onSnapshot(qUserScans, (querySnapshot) => {
        const items: ScannedItem[] = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), scanned_at: doc.data().scanned_at } as ScannedItem));
        items.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
        setUserScannedItems(items);
    }, (err) => console.error("Error escuchando los items del usuario:", err));
    
    // Listener for operation document changes (like totalScannedQuantity)
    const opDocRef = doc(firestore, "receptionOperations", operationId);
    const unsubscribeOpDoc = onSnapshot(opDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const opData = docSnap.data() as ReceptionOperation;
            setOperation(prev => prev ? { ...prev, totalScannedQuantity: opData.totalScannedQuantity, status: opData.status, start_time: opData.start_time, end_time: opData.end_time } : opData);
        }
    });

    return () => {
      unsubscribeUserScans();
      unsubscribeOpDoc();
    }
  }, [operationId, user?.uid]);
  
  // NEW: Real-time listener for just the current reference's totals!
  useEffect(() => {
      if (!operationId || !currentScannedProductDetails) {
          setCurrentReferenceStats(null);
          return;
      }
      const safeRefId = (currentScannedProductDetails.referencia || currentScannedProductDetails.reference || 'UNKNOWN').trim().replace(/\//g, '-');
      const statsRef = doc(firestore, 'receptionOperations', operationId, 'referenceStats', safeRefId);
      
      const unsubscribeStats = onSnapshot(statsRef, (docSnap) => {
          if (docSnap.exists()) {
              const data = docSnap.data();
              setCurrentReferenceStats({
                  totalScanned: data.totalScanned || 0,
                  uniquePackingUnitsCount: Array.isArray(data.packingUnits) ? data.packingUnits.length : 0
              });
          } else {
              setCurrentReferenceStats({ totalScanned: 0, uniquePackingUnitsCount: 0 });
          }
      });
      
      return () => unsubscribeStats();
  }, [operationId, currentScannedProductDetails]);
  
  // Real-time listener for PAUSES and PACKING UNITS
  useEffect(() => {
    if (!operationId || !user?.uid) return;

    const qPauses = query(
        collection(firestore, "operationPauses"), 
        where("reception_id", "==", operationId),
        where("user_id", "==", user.uid)
    );
    const unsubscribePauses = onSnapshot(qPauses, (querySnapshot) => {
        const userPauses: OperationPause[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                start_time: data.start_time.toDate(),
                end_time: data.end_time ? data.end_time.toDate() : null,
            } as OperationPause;
        });
        setAllPauses(userPauses);
        setActivePause(userPauses.find(p => !p.end_time) || null);
    });
    
    const qUnits = query(collection(firestore, "packingUnits"), where("reception_id", "==", operationId));
    const unsubscribeUnits = onSnapshot(qUnits, (querySnapshot) => {
      const units: PackingUnit[] = querySnapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() } as PackingUnit));
      setPackingUnits(units);
    }, (err) => console.error("Error escuchando las unidades de empaque:", err))

    return () => {
      unsubscribePauses();
      unsubscribeUnits();
    }
  }, [operationId, user?.uid]);
  
  // USER-SPECIFIC REAL-TIME PRODUCTIVITY CALCULATION
  useEffect(() => {
      const calculateUserMetrics = () => {
          if (!user || !operation) {
              setUserProductivity({ timeSpentInMinutes: 0, actualProductivity: 0 });
              return;
          }

          const userPauses = allPauses; // Already filtered for the user
          const userItems = userScannedItems; // Use the dedicated state for user's items

          if (userItems.length === 0 && userPauses.length === 0) {
              setUserProductivity({ timeSpentInMinutes: 0, actualProductivity: 0 });
              return;
          }

          const parseDate = (val: any) => {
              if (!val) return null;
              if (val instanceof Date) return val.getTime();
              if (typeof val?.toDate === 'function') return val.toDate().getTime();
              const date = new Date(val);
              return isNaN(date.getTime()) ? null : date.getTime();
          };

          const activityTimes = [
              ...userItems.map(i => parseDate(i.scanned_at)),
              ...userPauses.map(p => parseDate(p.start_time))
          ].filter((t): t is number => t !== null);

          if (activityTimes.length === 0) {
             setUserProductivity({ timeSpentInMinutes: 0, actualProductivity: 0 });
             return;
          }
          
          const firstScanTime = Math.min(...activityTimes);

          const now = new Date().getTime();
          let endTime = now;
          if (operation.status !== 'in_progress' && operation.status !== 'paused' && operation.end_time) {
              const opEnd = parseDate(operation.end_time);
              endTime = opEnd || now;
          } else if (operation.status !== 'in_progress' && operation.status !== 'paused') {
              const lastActivityTimes = [
                ...userItems.map(i => parseDate(i.scanned_at)),
                ...userPauses.filter(p => p.end_time).map(p => parseDate(p.end_time)),
             ].filter((t): t is number => t !== null);
              endTime = lastActivityTimes.length > 0 ? Math.max(...lastActivityTimes) : firstScanTime;
          }

          const grossDurationMs = Math.max(0, endTime - firstScanTime);

          // 1. Collect all pause intervals
          const activePulseFromContext = globalPulse || currentPulse;
          const rawIntervals = [
            ...userPauses.map(p => ({ start: parseDate(p.start_time)!, end: p.end_time ? parseDate(p.end_time)! : now })),
            ...allPulses.map(p => ({ start: parseDate(p.startTime)!, end: p.endTime ? parseDate(p.endTime)! : now }))
          ];

          // Explicitly add the current active pulse interval if we are paused
          if (isPaused && activePulseFromContext) {
              rawIntervals.push({
                  start: activePulseFromContext.startTime.getTime(),
                  end: now
              });
          }

          // 2. Sort and Merge Overlapping Intervals
          rawIntervals.sort((a, b) => a.start - b.start);
          const mergedIntervals: {start: number, end: number}[] = [];
          
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

          // 3. Sum non-overlapping pause durations within the scan window
          let totalPauseDurationMs = 0;
          mergedIntervals.forEach(p => {
              const effectiveStart = Math.max(p.start, firstScanTime);
              const effectiveEnd = Math.min(p.end, endTime);
              if (effectiveEnd > effectiveStart) {
                totalPauseDurationMs += (effectiveEnd - effectiveStart);
              }
          });

          const effectiveTimeMinutes = Math.max(0, (grossDurationMs - totalPauseDurationMs) / 60000);
          const totalScanned = userItems.reduce((sum, i) => sum + i.quantity, 0);
          const actualProductivity = effectiveTimeMinutes > 0 ? (totalScanned / effectiveTimeMinutes) * 60 : 0;
          
      setUserProductivity({ timeSpentInMinutes: effectiveTimeMinutes, actualProductivity });
      };

      const interval = setInterval(calculateUserMetrics, 2000); // Recalculate every 2 seconds for a live feel
      
      return () => clearInterval(interval);

  }, [user, operation, userScannedItems, allPauses, allPulses]);


  const activePackingUnit: PackingUnit | null = useMemo(() => {
    if (!user) return null;
    return packingUnits.find(u => u.status === 'open' && u.createdBy === user.uid) || null;
  }, [packingUnits, user]);
  
  const createNewPackingUnitForUser = useCallback(async (): Promise<PackingUnit | null> => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Error', description: 'Usuario no autenticado.' });
        return null;
    }
    const result = await createPackingUnit(operationId, user.uid);
    if(result.success && result.newUnit) {
        toast({ title: 'Éxito', description: `Nueva unidad de empaque #${result.newUnit.id} creada.` });
        return result.newUnit;
    } else {
        toast({ variant: 'destructive', title: 'Error Crítico', description: `No se pudo crear la unidad de empaque: ${result.error}` });
        return null;
    }
  }, [operationId, user, toast]);

  const handleCreateNewUnit = async () => {
    setIsSubmitting(true);
    await createNewPackingUnitForUser();
    setIsSubmitting(false);
  }

  const handleItemScanned = async (product: ProductDatabaseItem) => {
    if (!user || !operation) return;

    let unitToUse = activePackingUnit;
    // --- START: SINGLE REFERENCE VALIDATION ---
    const productRef = (product.referencia || product.reference || '').trim();
    const productSize = (product.talla || product.size || '').trim();
    const productName = (product.item || product.name || '').trim();

    if (unitToUse) {
        const itemsInActiveUnit = userScannedItems.filter(item => item.packing_unit_id === unitToUse?.firestoreId);
        if (itemsInActiveUnit.length > 0) {
            const expectedReference = itemsInActiveUnit[0].reference.trim();

            if (productRef !== expectedReference) {
                setMixedReferenceError({ show: true, expected: expectedReference, scanned: productRef });
                return; // Stop processing
            }
        }
    }
    // --- END: SINGLE REFERENCE VALIDATION ---

    setIsSubmitting(true);
    
    try {
        if (!unitToUse) {
            unitToUse = await createNewPackingUnitForUser();
            if(!unitToUse) {
                setIsSubmitting(false);
                return;
            }
        }
        
        if (operation.status === 'pending') {
            await updateReceptionOperation(operationId, { status: 'in_progress', start_time: new Date().toISOString() });
            toast({ title: 'Operación iniciada', description: 'El estado ha cambiado a "En Curso".' });
        }
        
        let expectedItemData = expectedItems.find(item => item.barcode === product.codigoBarras);
        
        // FALLBACK: If barcode not in expected (alternate code), find by Reference + Size
        if (!expectedItemData && productRef && productSize) {
            expectedItemData = expectedItems.find(item => {
                const itemRef = (item.reference || (item as any).referencia || '').trim().toUpperCase();
                const itemSize = (item.size || (item as any).talla || '').trim().toUpperCase();
                return itemRef === productRef.toUpperCase() && itemSize === productSize.toUpperCase();
            });
        }

        const itemToAdd = {
            reception_id: operation.id,
            packing_unit_id: unitToUse.firestoreId,
            barcode: product.codigoBarras,
            user_id: user.uid,
            reference: productRef || 'N/A',
            talla: productSize || 'N/A',
            item: productName || 'N/A',
            location_id: expectedItemData?.location || undefined
        };
                
        const result = await addScannedItem(itemToAdd);
        
        if (result.success) {
            toast({ title: 'Éxito', description: `Item ${productRef} añadido a la unidad ${unitToUse.id}.` });
        } else {
            toast({ variant: 'destructive', title: 'Error al Guardar', description: result.error });
        }
    } catch(e: any) {
        toast({ variant: 'destructive', title: 'Error inesperado', description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleItemScannedWithNovelty = async (product: ProductDatabaseItem) => {
    await handleItemScanned(product);
    if(user?.uid) {
        await registerNovelty({
            reception_id: operationId,
            barcode: product.codigoBarras,
            novelty_type: 'Ítem fuera de operación',
            description: `El operario añadió el ítem ${product.referencia} (${product.codigoBarras}) que no se esperaba en la orden.`,
        }, user.uid);
    }
  };

  const handlePause = async (reason: string) => {
    if (!user || !operation || activePause) return;
    setIsSubmitting(true);
    const result = await startOperationPause(operation.id, user.uid, reason);
    if (result.success) {
      toast({ title: 'Éxito', description: 'La operación ha sido pausada.' });
      // The onSnapshot listener will update the state, no need to setActivePause here
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
    setIsPauseDialogOpen(false);
  };
  
  const handleResume = async () => {
    if (!user || !activePause?.id) return;
    setIsSubmitting(true);
    const result = await endOperationPause(activePause.id, user.uid);
    if(result.success) {
      toast({ title: 'Éxito', description: 'La operación ha sido reanudada.' });
      // The onSnapshot listener will update the state
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
  };

  const handleProductNotFound = (barcode: string) => {
    setProductNotFoundBarcode(barcode);
  };
  
  const onProductCreated = () => {
    setProductNotFoundBarcode(null);
  };
  
  const handleProductLookedUp = (product: ProductDatabaseItem | null) => {
    setCurrentScannedProductDetails(product);
  }

  const handleItemDeleted = async (itemId: string) => {
    const result = await deleteScannedItem(itemId);
    if (result.success) {
        toast({ title: 'Éxito', description: 'Ítem escaneado eliminado.' });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
  }
  
  const handleItemUpdated = async () => {
    // onSnapshot will handle the update.
  }

  const handleClosePackingUnit = async (destination?: string) => {
    if (!activePackingUnit) {
      toast({ variant: "destructive", title: "Error", description: "No hay ninguna unidad de empaque activa para cerrar." });
      return;
    }
    
    const updates: Partial<PackingUnit> = {
        status: 'closed',
        closed_at: new Date().toISOString(),
    };

    if (destination) {
        updates.destination = destination;
    }
    
    const result = await updatePackingUnit(activePackingUnit.firestoreId, updates);
    
    if (result.success) {
      toast({ title: 'Unidad de empaque cerrada', description: `La unidad ${activePackingUnit.id} ha sido cerrada. El próximo ítem creará una nueva.` });
    } else {
       toast({ variant: "destructive", title: "Error al cerrar", description: result.error });
    }
  };

  const handleCompleteOperation = async () => {
    if (!operationId) return;
    setIsSubmitting(true);
    const result = await updateReceptionOperation(operationId, { 
      status: 'completed',
      end_time: new Date().toISOString(),
    });
    if (result.success) {
      toast({ title: 'Operación Finalizada', description: 'La operación ha sido marcada como completada.' });
      onReturnToOperations();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
  };

  const { totalUserScannedQuantity } = useMemo(() => {
    if (userScannedItems.length === 0) {
        return { totalUserScannedQuantity: 0 };
    }
    return {
        totalUserScannedQuantity: userScannedItems.reduce((sum, item) => sum + item.quantity, 0)
    };
  }, [userScannedItems]);
  
  const productivityGoal = useMemo(() => {
    return operation?.standard_units_per_hour ?? userGoals?.hourly_productivity_goal ?? productivitySettings?.standard_per_hour_goal ?? 350;
  }, [operation, userGoals, productivitySettings]);
  
  const lastScannedItemLocationName = useMemo(() => {
    if (!currentScannedProductDetails) return null;

    // PRIORITY 1: Find in the current operation's expected items by barcode.
    const expectedItemByBarcode = expectedItems.find(
      (item) => item.barcode === currentScannedProductDetails.codigoBarras
    );
    if (expectedItemByBarcode && expectedItemByBarcode.location) {
        return expectedItemByBarcode.location;
    }
    
    // NEW PRIORITY 2: Find in the current operation's expected items by reference and size.
    const ref = (currentScannedProductDetails.referencia || currentScannedProductDetails.reference || '').trim().toUpperCase();
    const size = (currentScannedProductDetails.talla || currentScannedProductDetails.size || '').trim().toUpperCase();
    
    if(ref && size) {
        const expectedItemByRef = expectedItems.find(item => {
            const itemRef = (item.reference || (item as any).referencia || '').trim().toUpperCase();
            const itemSize = (item.size || (item as any).talla || '').trim().toUpperCase();
            return itemRef === ref && itemSize === size;
        });
        
        if (expectedItemByRef && expectedItemByRef.location) {
            return expectedItemByRef.location;
        }
    }

    // PRIORITY 3 (Fallback): Use the general location from the product master database.
    return currentScannedProductDetails.location || 'N/A';
  }, [currentScannedProductDetails, expectedItems]);
  
  const referenceLocationMap = useMemo(() => {
      const map = new Map<string, string>();
      if (!productDB || productDB.length === 0) return map;
      productDB.forEach(product => {
          if (product.referencia && product.location) {
              map.set(product.referencia.trim(), product.location);
          }
      });
      return map;
  }, [productDB]);

  const totalItemsInActiveUnit = useMemo(() => {
    if (!activePackingUnit) return 0;
    
    // Sum quantities of items directly associated with the currently active PackingUnit.
    // This requires iterating through all scanned items that belong to this unit.
    return userScannedItems
        .filter(item => item.packing_unit_id === activePackingUnit.firestoreId)
        .reduce((sum, item) => sum + item.quantity, 0);

  }, [activePackingUnit, userScannedItems]);
  
  const packingUnitIdMap = useMemo(() => new Map(packingUnits.map(unit => [unit.firestoreId, unit.id])), [packingUnits]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4">Cargando datos de la operación...</p>
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-center p-8">{error}</div>;
  }
  
  if (!operation) {
    return <div className="text-muted-foreground text-center p-8">No se encontró la operación.</div>;
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
       <AlertDialog open={mixedReferenceError?.show} onOpenChange={() => setMixedReferenceError(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center text-destructive">
                        <AlertTriangle className="mr-2 h-8 w-8" />
                        ¡Alerta: Referencia Incorrecta!
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-lg pt-4 text-foreground">
                        Esta caja es para la referencia <strong className="text-xl text-primary">{mixedReferenceError?.expected}</strong>.
                        <br />
                        No puedes empacar la referencia <strong className="text-xl text-destructive">{mixedReferenceError?.scanned}</strong> aquí.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={() => setMixedReferenceError(null)}>Entendido</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
       <CreateProductDialog 
          open={!!productNotFoundBarcode}
          onOpenChange={(open) => !open && setProductNotFoundBarcode(null)}
          onSave={onProductCreated}
          initialBarcode={productNotFoundBarcode || ''}
          receptionId={operation.id}
       />
       <PauseReasonDialog 
          open={isPauseDialogOpen}
          onOpenChange={setIsPauseDialogOpen}
          onConfirm={handlePause}
       />
       <UnexpectedItemDialog
            isOpen={!!unexpectedItem}
            onClose={() => setUnexpectedItem(null)}
            onConfirm={handleItemScannedWithNovelty}
            item={unexpectedItem!}
       />
      <div className="text-center">
        <h1 className="text-3xl font-bold">Lectura de Recepción: {operation.rk_identifier}</h1>
        <p className="text-muted-foreground">Proveedor: {operation.supplier}</p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ReceptionScanInput 
            receptionId={operation.id}
            onItemScanned={handleItemScanned}
            onItemScannedWithNovelty={handleItemScannedWithNovelty}
            activePackingUnit={activePackingUnit}
            onProductNotFound={handleProductNotFound}
            onProductLookedUp={handleProductLookedUp}
            isOperationPaused={!!activePause}
            expectedItems={expectedItems}
            referenceLocationMap={referenceLocationMap}
            totalItemsInActiveUnit={totalItemsInActiveUnit}
          />
         <ReceptionSummary 
            operation={operation}
            totalUserScannedQuantity={totalUserScannedQuantity}
            userProductivity={userProductivity}
            isOperationPaused={!!activePause}
            currentScannedProductDetails={currentScannedProductDetails}
            productivityGoal={productivityGoal}
            currentReferenceStats={currentReferenceStats}
            expectedItems={expectedItems}
            packingUnits={packingUnits}
        />
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ReceptionScannedItemsList 
             receptionId={operation.id}
             scannedItems={userScannedItems}
             packingUnits={packingUnits}
             onItemDeleted={handleItemDeleted}
             onItemUpdated={handleItemUpdated}
             onNoveltyRegistered={() => {}}
             totalScannedQuantity={totalUserScannedQuantity}
             packingUnitIdMap={packingUnitIdMap}
          />
          <ReceptionProductDetails
            currentScannedProductDetails={currentScannedProductDetails}
            onProductUpdated={() => {}}
            lastScannedItemLocationName={lastScannedItemLocationName}
          />
       </div>

      <ReceptionControlButtons
        onBack={onReturnToOperations}
        onCancel={() => {}}
        onComplete={handleCompleteOperation}
        onClosePackingUnit={handleClosePackingUnit}
        hasActivePackingUnit={!!activePackingUnit}
        isOperationPaused={!!activePause}
        onPause={() => setIsPauseDialogOpen(true)}
        onResume={handleResume}
        totalItemsInActiveUnit={totalItemsInActiveUnit}
      />
       {(role === 'admin' || role === 'supervisor') && !activePackingUnit && (
            <div className="mt-4 flex justify-center">
                <Button onClick={handleCreateNewUnit} variant="secondary" disabled={isSubmitting}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Crear Nueva Unidad Manualmente
                </Button>
            </div>
        )}
    </div>
  );
};
