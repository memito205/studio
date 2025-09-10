/** @jsxImportSource react */
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { OperationDetailedReport } from './OperationDetailedReport';
import type { ReceptionOperation, ScannedItem, ItemNovelty, PackingUnit, ProductivitySettings, AppUser, ProductDatabaseItem, ReceptionExpectedItem, Location } from '@/types';
import { getScannedItemsByReception, getNoveltiesByReception, getPackingUnitsForOperation, getProductivitySettings, getAllUserProfiles, getProductsByBarcodes, getLocations } from '@/app/actions';
import { Loader2, Download } from 'lucide-react';
import { showError } from '@/lib/toast';
import { exportToXlsx } from '@/services/export';

interface OperationDetailedReportDialogProps {
  operation: ReceptionOperation;
  children: React.ReactNode;
}

export const OperationDetailedReportDialog: React.FC<OperationDetailedReportDialogProps> = ({
  operation,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<{
      allScannedItems: ScannedItem[];
      allNovelties: ItemNovelty[];
      allPackingUnits: PackingUnit[];
      allUsers: AppUser[];
      productivitySettings: ProductivitySettings | null;
      productDB: ProductDatabaseItem[];
      allLocations: Location[];
  } | null>(null);

  const fetchDialogData = useCallback(async () => {
    if (!open || !operation) return;
    setLoading(true);
    try {
        const expectedItems = operation.expectedItems || [];
        // The list of barcodes now comes from both expected and what was already scanned.
        const allScannedItemsResponse = await getScannedItemsByReception(operation.id);
        const scannedItemsData = allScannedItemsResponse.data || [];
        
        const uniqueBarcodes = [...new Set([
            ...expectedItems.map(item => item.barcode),
            ...scannedItemsData.map(item => item.barcode)
        ])];
        
        const [
            noveltiesResult,
            packingUnitsResult,
            settingsResult,
            usersResult,
            productsResult,
            locationsResult,
        ] = await Promise.all([
            getNoveltiesByReception(operation.id),
            getPackingUnitsForOperation(operation.id),
            getProductivitySettings(),
            getAllUserProfiles(),
            getProductsByBarcodes(uniqueBarcodes),
            getLocations()
        ]);
        
        if (productsResult.error) {
            showError("Error al cargar la base de datos de productos", productsResult.error);
        }

        setReportData({
            allScannedItems: scannedItemsData,
            allNovelties: noveltiesResult.data || [],
            allPackingUnits: packingUnitsResult.data || [],
            allUsers: usersResult || [],
            productivitySettings: settingsResult.data || null,
            productDB: productsResult.data || [],
            allLocations: locationsResult.data || []
        });

    } catch (e: any) {
        showError("Error al cargar los datos del reporte", e.message);
        setReportData(null);
    } finally {
        setLoading(false);
    }
  }, [open, operation]);
  
  const handleExportBasic = () => {
    if (!reportData) return;

    const locationMap = new Map<string, string>();
    reportData.productDB.forEach(p => {
        const key = `${(p.referencia || p.reference || '').trim()}-${(p.talla || p.size || '').trim()}`;
        if (key !== '-') {
            locationMap.set(key, p.location || 'N/A');
        }
    });

    const unitIdMap = new Map<string, number>(
        reportData.allPackingUnits.map(unit => [unit.firestoreId, unit.id])
    );

    const summary = new Map<string, { referencia: string; talla: string; caja: number; cantidadLeida: number }>();

    reportData.allScannedItems.forEach(item => {
      const cajaId = unitIdMap.get(item.packing_unit_id) || 0;
      const key = `${(item.reference || '').trim()}-${(item.talla || '').trim()}-${cajaId}`;
      
      const entry = summary.get(key) || {
        referencia: item.reference,
        talla: item.talla,
        caja: cajaId,
        cantidadLeida: 0,
      };

      entry.cantidadLeida += item.quantity;
      summary.set(key, entry);
    });

    const dataToExport = Array.from(summary.values())
      .map(item => {
          const locationKey = `${(item.referencia || '').trim()}-${(item.talla || '').trim()}`;
          return {
            'Referencia': item.referencia,
            'Talla': item.talla,
            'Ubicacion': locationMap.get(locationKey) || 'N/A',
            'Caja': item.caja,
            'Cantidad Leida': item.cantidadLeida,
          };
      })
      .sort((a, b) => {
        const refCompare = a['Referencia'].localeCompare(b['Referencia']);
        if (refCompare !== 0) return refCompare;
        return a['Caja'] - b['Caja'];
      });

    exportToXlsx(dataToExport, `Reporte_Basico_${operation.rk_identifier}`);
  };


  useEffect(() => {
    if(open) {
        fetchDialogData();
    }
  }, [open, fetchDialogData]);


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex justify-between items-center">
            <div>
              <DialogTitle>Reporte Detallado de Operación</DialogTitle>
              <DialogDescription>
                RK: {operation.rk_identifier} - {operation.supplier}
              </DialogDescription>
            </div>
            <Button onClick={handleExportBasic} variant="outline" disabled={!reportData || loading}>
              <Download className="mr-2 h-4 w-4" /> Exportar Básico
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-grow overflow-hidden">
          {loading ? (
             <div className="flex justify-center items-center h-full">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
             </div>
          ) : reportData ? (
             <OperationDetailedReport 
                operation={operation}
                allScannedItems={reportData.allScannedItems}
                allNovelties={reportData.allNovelties}
                allPackingUnits={reportData.allPackingUnits}
                allUsers={reportData.allUsers}
                productivitySettings={reportData.productivitySettings}
                onRefresh={fetchDialogData}
                productDB={reportData.productDB}
                allLocations={reportData.allLocations}
             />
          ) : (
            <p className="text-center text-destructive">No se pudieron cargar los datos del reporte.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
