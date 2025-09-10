

"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lookupBarcode } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2 } from 'lucide-react';
import type { PackingUnit, ProductDatabaseItem, PackingScanResult, ReceptionExpectedItem } from '@/types';
import { UnexpectedItemDialog } from './UnexpectedItemDialog';


interface ReceptionScanInputProps {
  receptionId: string;
  onItemScanned: (product: ProductDatabaseItem) => void;
  onItemScannedWithNovelty: (product: ProductDatabaseItem) => void;
  activePackingUnit: PackingUnit | null;
  onProductNotFound: (barcode: string) => void;
  onProductLookedUp: (product: ProductDatabaseItem | null) => void;
  isOperationPaused: boolean;
  expectedItems: ReceptionExpectedItem[];
  referenceLocationMap: Map<string, string>;
  totalItemsInActiveUnit: number; // Propiedad añadida para recibir el conteo correcto
}

export const ReceptionScanInput: React.FC<ReceptionScanInputProps> = ({
  receptionId,
  onItemScanned,
  onItemScannedWithNovelty,
  activePackingUnit,
  onProductNotFound,
  onProductLookedUp,
  isOperationPaused,
  expectedItems,
  referenceLocationMap,
  totalItemsInActiveUnit, // Usar esta propiedad
}) => {
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [unexpectedItem, setUnexpectedItem] = useState<ProductDatabaseItem | null>(null);

  const expectedBarcodes = useMemo(() => new Set(expectedItems.map(item => item.barcode)), [expectedItems]);
  const expectedRefSizePairs = useMemo(() => new Set(expectedItems.map(item => `${(item.reference || '').trim()}|${String(item.size || '').trim()}`)), [expectedItems]);

  useEffect(() => {
    if (!isSubmitting) {
        inputRef.current?.focus();
    }
  }, [isSubmitting, activePackingUnit]); // Refocus when unit changes too

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOperationPaused) {
      toast({ variant: 'destructive', title: 'Operación Pausada', description: 'Reanuda la operación para escanear.' });
      return;
    }
    if (!barcodeInput.trim()) {
      toast({ variant: 'destructive', title: 'Entrada Vacía', description: 'Por favor, ingresa un código de barras.' });
      return;
    }

    setIsSubmitting(true);
    const scannedBarcode = barcodeInput.trim();
    const result: PackingScanResult = await lookupBarcode(scannedBarcode);

    if (result.status === 'success' && result.item) {
        const itemRef = result.item.referencia || result.item.reference || '';
        const itemSize = result.item.talla || result.item.size || '';
        const refSizeKey = `${itemRef.trim()}|${String(itemSize).trim()}`;
        
        const isExpectedByBarcode = expectedBarcodes.has(result.item.codigoBarras);
        const isExpectedByRefSize = expectedRefSizePairs.has(refSizeKey);
        const isExpected = isExpectedByBarcode || isExpectedByRefSize;
        
        const productWithCorrectedLocation = { ...result.item };
        const knownLocation = referenceLocationMap.get(itemRef.trim());

        if (isExpected) {
             if (knownLocation) productWithCorrectedLocation.location = knownLocation;
            onItemScanned(productWithCorrectedLocation);
            onProductLookedUp(productWithCorrectedLocation);
            setBarcodeInput('');
        } else {
            productWithCorrectedLocation.location = knownLocation || 'SIGUIENTE';
            setUnexpectedItem(productWithCorrectedLocation);
        }
    } else {
      onProductLookedUp(null);
      onProductNotFound(scannedBarcode);
    }
    setIsSubmitting(false);
  };
  
  const productsData = useMemo(() => {
    if (!expectedItems) return [];
    
    // Create a Map to store unique references and their first location found.
    const referenceLocationMap = new Map<string, string>();
    
    expectedItems.forEach(item => {
        const ref = (item.reference || '').trim();
        // Assuming location is part of ReceptionExpectedItem, if not, we need to adjust this.
        // For now, let's assume `item.location` exists or can be derived.
        // As it's not on the type, I will assume it's not there and this logic needs to be simpler
        // or the data source for locations needs to be provided. Let's fallback to a simpler logic.
    });

    return expectedItems.map(item => ({
        ...item,
        referencia: item.reference,
        // location: referenceLocationMap.get((item.reference || '').trim()) || 'N/A' 
        // This mapping logic is complex without a direct location source on expectedItems.
        // Let's assume for now that if an item is unexpected, the location is handled as per the new logic.
    }));
  }, [expectedItems]);

  const handleConfirmUnexpectedItem = () => {
      if (unexpectedItem) {
        onItemScannedWithNovelty(unexpectedItem);
        onProductLookedUp(unexpectedItem); // Show the details of the item added, including its corrected location.
        toast({ title: 'Ítem Añadido con Novedad', description: `Se registró el ítem inesperado ${unexpectedItem.referencia || unexpectedItem.reference}.` });
        setBarcodeInput('');
      }
      setUnexpectedItem(null);
  }
  
  const handleProductLookup = async () => {
    if (isOperationPaused) {
      toast({ variant: 'destructive', title: 'Operación Pausada' });
      return;
    }
    if (!barcodeInput.trim()) {
      toast({ variant: 'destructive', title: 'Entrada Vacía', description: 'Ingresa un código para buscar.' });
      onProductLookedUp(null);
      return;
    }
    const result = await lookupBarcode(barcodeInput.trim());
    if (result.status === 'success' && result.item) {
      onProductLookedUp(result.item);
      toast({ title: 'Producto Encontrado', description: `${result.item.referencia} (${result.item.talla})` });
    } else {
      onProductLookedUp(null);
      toast({ variant: 'destructive', title: 'No Encontrado', description: result.message });
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4">
        {unexpectedItem && (
            <UnexpectedItemDialog 
                isOpen={!!unexpectedItem}
                onClose={() => setUnexpectedItem(null)}
                onConfirm={handleConfirmUnexpectedItem}
                item={unexpectedItem}
            />
        )}
        <Label htmlFor="barcode-input" className="text-lg font-semibold">Escanear o Ingresar Código de Barras</Label>
        <form onSubmit={handleScanSubmit} className="flex w-full max-w-sm space-x-2">
            <Input
                ref={inputRef}
                id="barcode-input"
                type="text"
                placeholder="Escanea o ingresa el código..."
                className="flex-grow text-center text-lg py-6"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                autoFocus
                disabled={isOperationPaused || isSubmitting}
            />
            <Button variant="outline" size="icon" type="button" onClick={handleProductLookup} title="Buscar Producto" disabled={isOperationPaused || !barcodeInput.trim()}>
                <Search className="h-4 w-4" />
            </Button>
        </form>
        
        <div className="w-full max-w-sm text-center space-y-1 h-12 flex items-center justify-center">
            {activePackingUnit ? (
                <p>Unidad de Empaque Activa: 
                    <span className="text-primary text-3xl font-bold"> {activePackingUnit.id} </span>
                    <span className="text-muted-foreground text-lg">({totalItemsInActiveUnit} items)</span>
                </p>
            ) : (
                <p className="text-muted-foreground italic">No hay unidad activa. El próximo escaneo creará una.</p>
            )}
        </div>

        <Button onClick={handleScanSubmit} className="w-full max-w-sm" disabled={isSubmitting || isOperationPaused}>
            {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
            {isSubmitting ? 'Agregando...' : 'Agregar Item'}
        </Button>
    </div>
  );
};
