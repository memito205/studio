

"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { lookupBarcode } from '@/app/reception/actions';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2 } from 'lucide-react';
import type { PackingUnit, ProductDatabaseItem, PackingScanResult, ReceptionExpectedItem } from '@/types';
import { UnexpectedItemDialog } from './UnexpectedItemDialog';


interface ReceptionScanInputProps {
  receptionId: string;
  onItemScanned: (product: ProductDatabaseItem) => Promise<{ accepted: boolean }>;
  onItemScannedWithNovelty: (product: ProductDatabaseItem) => Promise<{ accepted: boolean }>;
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

  const expectedBarcodes = useMemo(() => new Set(expectedItems.map(item => String(item.barcode).trim())), [expectedItems]);
  const expectedRefSizePairs = useMemo(() => new Set(expectedItems.map(item => `${String(item.reference || '').trim()}|${String(item.size || '').trim()}`)), [expectedItems]);

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
    const result: PackingScanResult = await lookupBarcode(scannedBarcode, receptionId);

    if (result.status === 'success' && result.item) {
        const itemRef = (result.item.referencia || result.item.reference || '').trim();
        const itemSize = (result.item.talla || result.item.size || 'N/A').trim();
        const refSizeKey = `${itemRef}|${itemSize}`;
        
        const isExpected = expectedBarcodes.has(result.item.codigoBarras) || expectedRefSizePairs.has(refSizeKey);
        
        const productWithCorrectedLocation = { ...result.item };
        const knownLocation = referenceLocationMap.get(itemRef);

        if (isExpected) {
             if (knownLocation) productWithCorrectedLocation.location = knownLocation;
            // Solo actualizar el panel visual si el escaneo fue aceptado en la caja.
            // Si se rechaza por mezcla de referencias, mantener ref/ubicación de la caja activa.
            const scanResult = await onItemScanned(productWithCorrectedLocation);
            if (scanResult?.accepted) {
                onProductLookedUp(productWithCorrectedLocation);
            }
        } else {
            productWithCorrectedLocation.location = knownLocation || 'SIGUIENTE';
            setUnexpectedItem(productWithCorrectedLocation);
        }
    } else {
      onProductLookedUp(null);
      onProductNotFound(scannedBarcode);
    }
    
    setBarcodeInput('');
    setIsSubmitting(false);
    if(inputRef.current) {
        inputRef.current.focus();
    }
  };
  
  const productsData = useMemo(() => {
    if (!expectedItems) return [];
    
    const referenceLocationMap = new Map<string, string>();
    
    expectedItems.forEach(item => {
        const ref = (item.reference || '').trim();
    });

    return expectedItems.map(item => ({
        ...item,
        referencia: item.reference,
    }));
  }, [expectedItems]);

  const handleConfirmUnexpectedItem = async () => {
      if (unexpectedItem) {
        const scanResult = await onItemScannedWithNovelty(unexpectedItem);
        if (scanResult?.accepted) {
          onProductLookedUp(unexpectedItem);
          toast({ title: 'Ítem Añadido con Novedad', description: `Se registró el ítem inesperado ${unexpectedItem.referencia || unexpectedItem.reference}.` });
          setBarcodeInput('');
        }
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
        
        <div className="w-full max-w-sm text-center space-y-1 h-24 flex flex-col items-center justify-center">
            {activePackingUnit ? (
                <>
                    <p className="text-lg">Unidad de Empaque Activa: 
                        <span className="text-primary text-3xl font-bold"> {activePackingUnit.id} </span>
                    </p>
                    <p className="text-7xl font-bold text-primary leading-none">
                        {totalItemsInActiveUnit}
                        <span className="text-2xl font-normal text-muted-foreground ml-2">items</span>
                    </p>
                </>
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

      

    
