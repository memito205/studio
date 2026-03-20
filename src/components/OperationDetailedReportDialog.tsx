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
import { OperationDetailedReport } from './OperationDetailedReport';
import type { ReceptionOperation, ScannedItem, ItemNovelty, PackingUnit, ProductivitySettings, AppUser, ProductDatabaseItem, ReceptionExpectedItem, Location } from '@/types';
import { getNoveltiesByReception, getPackingUnitsForOperation, getProductsByBarcodes, getLocations, getScannedItemsByReception, exportBasicOperationReport, getProductivitySettings, getAllUserProfiles } from '@/app/reception/actions';
import { Loader2, Download } from 'lucide-react';
import { showError } from '@/lib/toast';
import { exportToXlsx } from '@/services/export';
import { Button } from './ui/button';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

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
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const { toast } = useToast();

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
  
  const handleExportBasic = async () => {
    if (!operation.id) return;
    setIsExporting(operation.id);
    const result = await exportBasicOperationReport(operation.id);

    if (result.success && result.sheets) {
        const workbook = XLSX.utils.book_new();
        result.sheets.forEach(sheetInfo => {
            const worksheet = XLSX.utils.json_to_sheet(sheetInfo.data);
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetInfo.sheetName);
        });
        XLSX.writeFile(workbook, `Reporte_Completo_${operation.rk_identifier}.xlsx`);
        toast({ title: 'Éxito', description: 'El reporte completo ha sido exportado.' });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'No se pudo generar el reporte completo.' });
    }
    setIsExporting(null);
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
            <Button onClick={handleExportBasic} variant="outline" disabled={isExporting === operation.id || loading}>
               {isExporting === operation.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="mr-2 h-4 w-4" />}
               Exportar Completo
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
