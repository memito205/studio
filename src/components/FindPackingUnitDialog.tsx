/** @jsxImportSource react */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search } from 'lucide-react';

interface FindPackingUnitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFind: (unitNumber: number) => void;
  isLoading: boolean;
}

export const FindPackingUnitDialog: React.FC<FindPackingUnitDialogProps> = ({
  open,
  onOpenChange,
  onFind,
  isLoading,
}) => {
  const [unitNumber, setUnitNumber] = useState('');

  const handleFind = () => {
    const num = parseInt(unitNumber, 10);
    if (!isNaN(num) && num > 0) {
      onFind(num);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buscar Unidad de Empaque</DialogTitle>
          <DialogDescription>
            Ingrese el número de la caja que desea consultar.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unit-number">Número de Caja</Label>
            <Input
              id="unit-number"
              type="number"
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="Ej: 5"
              min="1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleFind(); }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleFind} disabled={isLoading || !unitNumber}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Buscar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
