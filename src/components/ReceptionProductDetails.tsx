/** @jsxImportSource react */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductDatabaseItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Edit } from 'lucide-react';
import { EditProductDialog } from '@/components/EditProductDialog'; // Assuming this will be created
import { useAuth } from '@/hooks/use-auth-context';

interface ReceptionProductDetailsProps {
  currentScannedProductDetails: ProductDatabaseItem | null;
  onProductUpdated: () => void;
  lastScannedItemLocationName: string | null;
}

export const ReceptionProductDetails: React.FC<ReceptionProductDetailsProps> = ({ currentScannedProductDetails, onProductUpdated, lastScannedItemLocationName }) => {
  const { role } = useAuth();
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = React.useState(false);
  
  const displayProductName = currentScannedProductDetails?.item || currentScannedProductDetails?.name || 'N/A';
  const displayProductDescription = currentScannedProductDetails?.description || currentScannedProductDetails?.item || 'N/A';
  const displayProductReference = currentScannedProductDetails?.referencia || currentScannedProductDetails?.reference || 'N/A';
  const displayProductSize = currentScannedProductDetails?.talla || currentScannedProductDetails?.size || 'N/A';
  const displayLocation = lastScannedItemLocationName || currentScannedProductDetails?.location || 'N/A';

  return (
    <>
      {currentScannedProductDetails && (
        <EditProductDialog
          open={isEditProductDialogOpen}
          onOpenChange={setIsEditProductDialogOpen}
          product={currentScannedProductDetails}
          onSave={onProductUpdated}
        >
          {/* The trigger is now outside, where the button is rendered */}
        </EditProductDialog>
      )}
      <div className="border rounded-md p-4 bg-muted/50 dark:bg-muted/20 h-full flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold">Detalles del Producto Escaneado</h3>
          {currentScannedProductDetails && role === 'admin' && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setIsEditProductDialogOpen(true)}>
                <Edit className="h-4 w-4 mr-1" /> Editar
              </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm flex-grow">
          <p><strong>Item:</strong> {displayProductName}</p>
          <p><strong>Descripción:</strong> {displayProductDescription}</p>
          
          <p className="col-span-2 mt-2">
            <strong className="text-lg">Ubicación:</strong> <span className="text-4xl font-bold">{displayLocation}</span>
          </p>
          <p className="col-span-2 mt-2">
            <strong className="text-lg">Referencia:</strong> <span className="text-4xl font-bold">{displayProductReference}</span>
          </p>
          <p className="col-span-2">
            <strong className="text-lg">Talla:</strong> <span className="text-4xl font-bold">{displayProductSize}</span>
          </p>
        </div>
      </div>
    </>
  );
};
