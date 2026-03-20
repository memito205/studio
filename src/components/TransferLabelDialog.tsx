
"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TransferEntry } from '@/types';
import { Printer, Loader2 } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useToast } from '@/hooks/use-toast';

interface TransferLabelProps {
  transfer: TransferEntry;
}

const TransferLabel: React.FC<TransferLabelProps> = ({ transfer }) => {
  const barcodeRef = React.useRef<HTMLCanvasElement>(null);
  const barcodeValue = `${transfer.bodegaDestino}-${transfer.numeroTF}`.toUpperCase();

  React.useEffect(() => {
    if (barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, barcodeValue, {
          format: "CODE128",
          displayValue: false, // The value is displayed separately
          margin: 0,
          height: 30,
          width: 1.5,
        });
      } catch (e) {
        console.error('Error generating barcode', e);
      }
    }
  }, [barcodeValue]);

  return (
    <div id="transfer-label-to-print" className="p-3 border border-gray-300 rounded-lg bg-white text-black flex flex-col" style={{ width: '10cm', height: '5cm' }}>
      <div className="flex justify-between items-start text-xs font-sans border-b pb-1 mb-1">
        <p className="font-bold">TRANSFERENCIA INTERNA</p>
        <p>Fecha: <span className="font-semibold">{transfer.fecha.toLocaleDateString('es-CO')}</span></p>
      </div>
      <div className="flex-grow flex flex-col items-center justify-center pt-1">
        <div className="flex justify-around w-full items-center">
            <div>
                <p className="font-sans text-lg font-semibold">Destino:</p>
                <p className="font-sans text-2xl font-bold">{transfer.bodegaDestino}</p>
            </div>
            <div>
                <p className="font-sans text-lg font-semibold">Unidades:</p>
                <p className="font-sans text-2xl font-bold">{transfer.cantidad || 1}</p>
            </div>
        </div>
        <div className="text-center font-sans text-3xl font-bold tracking-wider my-2">
          {barcodeValue}
        </div>
        <canvas ref={barcodeRef} />
      </div>
      <div className="mt-1 border-t pt-1">
        <p className="text-xs font-semibold">Recibido por:</p>
        <div className="h-4 border-b border-black"></div>
      </div>
    </div>
  );
};


interface TransferLabelDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transfer: TransferEntry | null;
  onPrintConfirm: (transfer: TransferEntry) => Promise<void>;
}

export const TransferLabelDialog: React.FC<TransferLabelDialogProps> = ({ isOpen, onOpenChange, transfer, onPrintConfirm }) => {
  const { toast } = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    if (!transfer) return;
    setIsPrinting(true);

    await onPrintConfirm(transfer);
    
    const input = document.getElementById('transfer-label-to-print');
    if (!input) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo encontrar el elemento del rótulo para imprimir.' });
        setIsPrinting(false);
        return;
    }

    try {
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow component to render
        const canvas = await html2canvas(input, {
            scale: 3, 
            useCORS: true,
            backgroundColor: '#ffffff',
        });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'cm',
            format: [10, 5]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, 10, 5);
        
        pdf.autoPrint();
        window.open(pdf.output('bloburl'), '_blank');
        
    } catch (error) {
        console.error("Error al generar PDF del rótulo:", error);
        toast({ variant: 'destructive', title: 'Error de Impresión', description: 'No se pudo generar el PDF del rótulo.' });
    } finally {
        setIsPrinting(false);
        onOpenChange(false);
    }
  };

  if (!transfer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rótulo para Transferencia</DialogTitle>
          <DialogDescription>
            Rótulo para el TF: {transfer.numeroTF} con destino a {transfer.bodegaDestino}. Al imprimir se marcará como recibido.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 flex justify-center">
          <TransferLabel transfer={transfer} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={handlePrint} disabled={isPrinting}>
            {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Printer className="mr-2 h-4 w-4"/>}
            Imprimir y Marcar como Recibido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
