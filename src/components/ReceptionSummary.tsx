

/** @jsxImportSource react */
import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ProductDatabaseItem, ReceptionOperation, ScannedItem, ReceptionExpectedItem, PackingUnit } from '@/types';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, Target, Percent, Package, Boxes } from 'lucide-react';

// Define the possible variant types for the Badge component
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface ReceptionSummaryProps {
  operation: ReceptionOperation | null;
  totalUserScannedQuantity: number;
  userProductivity: {
      timeSpentInMinutes: number;
      actualProductivity: number;
  };
  isOperationPaused: boolean;
  currentScannedProductDetails: ProductDatabaseItem | null;
  productivityGoal: number;
  allScannedItemsForOperation: ScannedItem[];
  expectedItems: ReceptionExpectedItem[];
  packingUnits: PackingUnit[];
}

export const ReceptionSummary: React.FC<ReceptionSummaryProps> = ({
  operation,
  totalUserScannedQuantity,
  userProductivity,
  isOperationPaused,
  currentScannedProductDetails,
  productivityGoal,
  allScannedItemsForOperation,
  expectedItems,
  packingUnits
}) => {
    
  const { timeSpentInMinutes, actualProductivity: userActualProductivity } = userProductivity;

  const { totalScannedForReference, uniquePackingUnitsForReference } = useMemo(() => {
    const currentReference = currentScannedProductDetails?.referencia;
    if (!currentReference || !allScannedItemsForOperation) {
        return { totalScannedForReference: 0, uniquePackingUnitsForReference: 0 };
    }
    
    const itemsForRef = allScannedItemsForOperation.filter(item => item.reference === currentReference);
    
    const totalForRef = itemsForRef.reduce((sum, item) => sum + item.quantity, 0);

    const uniqueUnits = new Set(itemsForRef.map(item => item.packing_unit_id));
    
    const packingUnitIdMap = new Map(packingUnits.map(unit => [unit.firestoreId, unit.id]));
    const uniqueSequentialIds = new Set(Array.from(uniqueUnits).map(firestoreId => packingUnitIdMap.get(firestoreId) || 'N/A'));

    return {
        totalScannedForReference: totalForRef,
        uniquePackingUnitsForReference: uniqueSequentialIds.size
    };
}, [allScannedItemsForOperation, currentScannedProductDetails, packingUnits]);


 const { expectedQuantityForCurrentReference } = useMemo(() => {
    const currentReference = currentScannedProductDetails?.referencia;
    if (!currentReference || !expectedItems) return { expectedQuantityForCurrentReference: 0 };

    const totalExpected = expectedItems
      .filter(item => item.reference === currentReference)
      .reduce((sum, item) => sum + item.expected_quantity, 0);
      
    return { expectedQuantityForCurrentReference: totalExpected };
  }, [currentScannedProductDetails, expectedItems]);


  const formatTime = (minutes: number) => {
    if (isNaN(minutes) || minutes < 0) return "00:00:00";
    const totalSeconds = Math.floor(minutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const remainingSecondsAfterHours = totalSeconds % 3600;
    const mins = Math.floor(remainingSecondsAfterHours / 60);
    const secs = remainingSecondsAfterHours % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  };
  
  const compliancePercentage = productivityGoal > 0 ? (userActualProductivity / productivityGoal) * 100 : 0;
  
  const getComplianceColor = (compliance: number): string => {
    if (compliance >= 100) return 'text-green-500';
    if (compliance >= 85) return 'text-amber-500';
    return 'text-red-500';
  };

  type BarcodeQuantityStatusReturn = {
    text: string;
    variant: BadgeVariant;
    className: string;
    icon?: React.ReactNode;
  };

  const referenceQuantityStatus = (): BarcodeQuantityStatusReturn => {
    if (!currentScannedProductDetails) return { text: 'N/A', variant: 'default', className: '' };
    if (expectedQuantityForCurrentReference === 0 && totalScannedForReference > 0) {
      return { text: 'Sobrante Inesperado', variant: 'destructive', className: 'bg-purple-500 text-white', icon: <AlertTriangle className="mr-1 h-3 w-3" /> };
    }
    if (expectedQuantityForCurrentReference === 0) {
      return { text: 'Sin Pedido', variant: 'secondary', className: '', icon: <AlertTriangle className="mr-1 h-3 w-3" /> };
    }
    if (totalScannedForReference === expectedQuantityForCurrentReference) {
      return { text: 'Cant. Exacta', variant: 'default', className: 'bg-green-500 text-white', icon: <CheckCircle className="mr-1 h-3 w-3" /> };
    } else if (totalScannedForReference < expectedQuantityForCurrentReference) {
      return { text: 'Cant. Faltante', variant: 'secondary', className: 'bg-orange-500 text-white', icon: <AlertTriangle className="mr-1 h-3 w-3" /> };
    } else { // scannedQuantityForCurrentBarcode > expectedQuantityForCurrentBarcode
      return { text: 'Cant. Sobrante', variant: 'destructive', className: 'bg-red-500 text-white', icon: <AlertTriangle className="mr-1 h-3 w-3" /> };
    }
  };

  return (
    <div className="border rounded-md p-4 bg-muted/50 dark:bg-muted/20 h-full flex flex-col">
      <h3 className="text-lg font-semibold mb-2">Resumen de la Sesión</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm flex-grow">
        <p><strong>Mis Items Leídos:</strong> {totalUserScannedQuantity.toLocaleString()}</p>
        <p><strong>Mi Tiempo Efectivo:</strong> {formatTime(timeSpentInMinutes)}</p>
        <p><strong>Mi Productividad:</strong> {userActualProductivity.toFixed(2)} ítems/hora</p>
        
        <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <p><strong>Mi Meta:</strong> {productivityGoal.toFixed(0)} u/hr</p>
        </div>
        <div className="col-span-2 flex items-center gap-2">
            <Percent className="h-4 w-4 text-muted-foreground" />
            <p className="text-lg"><strong>Mi Cumplimiento:</strong> 
                <span className={cn("font-bold text-3xl", getComplianceColor(compliancePercentage))}>
                  {' '}{compliancePercentage.toFixed(1)}%
                </span>
            </p>
        </div>
        
        {currentScannedProductDetails && (
          <div className="col-span-2 border-t pt-4 mt-4">
            <h4 className="text-md font-semibold mb-2">Resumen de Referencia: {currentScannedProductDetails.referencia}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <p><strong>Esperado Total:</strong> {expectedQuantityForCurrentReference}</p>
                <p><strong>Leído Total:</strong> {totalScannedForReference}</p>
                <p className="flex items-center gap-1">
                    <Boxes className="h-4 w-4" />
                    <strong>En Cajas:</strong> {uniquePackingUnitsForReference}
                </p>
            </div>
             <div className="flex items-center gap-2 mt-2">
                <strong>Estado General:</strong>
                <Badge variant={referenceQuantityStatus().variant} className={referenceQuantityStatus().className}>
                    {referenceQuantityStatus().icon}{referenceQuantityStatus().text}
                </Badge>
            </div>
          </div>
        )}
      </div>
      {isOperationPaused && (
        <Badge variant="destructive" className="mt-4 text-center text-lg py-2">
          OPERACIÓN PAUSADA
        </Badge>
      )}
    </div>
  );
};

export default ReceptionSummary;
