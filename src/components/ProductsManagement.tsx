

"use client";

import React, { useState, useCallback, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Link2, Loader2, Edit, UploadCloud } from 'lucide-react';
import type { ReceptionProduct as Product, AlternateBarcodeUploadRow } from '@/types';
import { lookupBarcode, createProduct, getProductByRefAndSize, bulkCreateAlternateBarcodes } from '@/app/actions';
import { EditProductDialog } from './EditProductDialog';


interface ProductsManagementProps {
    onReturn: () => void;
}

export const ProductsManagement: React.FC<ProductsManagementProps> = ({ onReturn }) => {
  const [alternateBarcode, setAlternateBarcode] = useState('');
  const [mainBarcode, setMainBarcode] = useState('');
  const [mainReference, setMainReference] = useState('');
  const [mainSize, setMainSize] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [mainProductDetails, setMainProductDetails] = useState<Product | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  const handleLookupMainProduct = useCallback(async (method: 'barcode' | 'refSize') => {
      let result;
      setIsLoading(true);

      if (method === 'barcode') {
          if (!mainBarcode.trim()) {
              toast({ variant: 'destructive', title: 'Error', description: 'Por favor, ingrese el código de barras principal.' });
              setIsLoading(false);
              return;
          }
          result = await lookupBarcode(mainBarcode.trim());
      } else { // refSize
          if (!mainReference.trim() || !mainSize.trim()) {
              toast({ variant: 'destructive', title: 'Error', description: 'Por favor, ingrese la referencia y la talla principal.' });
              setIsLoading(false);
              return;
          }
          result = await getProductByRefAndSize(mainReference.trim(), mainSize.trim());
      }

      if (result.status === 'success' && result.item) {
          setMainProductDetails(result.item as Product);
          toast({ title: 'Producto Principal Encontrado', description: `Se cargaron los datos de ${result.item.referencia} - ${result.item.talla}.` });
      } else {
          setMainProductDetails(null);
          toast({ variant: 'destructive', title: 'No Encontrado', description: result.message });
      }
      setIsLoading(false);
  }, [mainBarcode, mainReference, mainSize, toast]);

  const handleAssociate = async () => {
    if (!alternateBarcode.trim() || !mainProductDetails) {
        toast({ variant: 'destructive', title: 'Datos Faltantes', description: 'Asegúrese de ingresar un código alterno y de haber buscado y encontrado un producto principal válido.'});
        return;
    }
    
    setIsLoading(true);
    
    const alternateExistsResult = await lookupBarcode(alternateBarcode.trim());
    if (alternateExistsResult.status === 'success') {
        toast({ variant: 'destructive', title: 'Código Alterno ya Existe', description: `El código de barras '${alternateBarcode.trim()}' ya está registrado a nombre de ${alternateExistsResult.item?.referencia}.`});
        setIsLoading(false);
        return;
    }

    const productToCreate: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'user_id'> = {
        name: mainProductDetails.name || mainProductDetails.item || '',
        barcode: alternateBarcode.trim(),
        description: mainProductDetails.description || null,
        reference: mainProductDetails.reference || mainProductDetails.referencia || '',
        size: mainProductDetails.size || mainProductDetails.talla || '',
        merchandise_type: mainProductDetails.merchandise_type || mainProductDetails.marca || null,
        location: mainProductDetails.location || null,
    };
    
    const createResult = await createProduct(productToCreate);

    if (createResult.success) {
        toast({ title: 'Éxito', description: `El código alterno '${alternateBarcode.trim()}' fue asociado exitosamente.`});
        setAlternateBarcode('');
        setMainBarcode('');
        setMainReference('');
        setMainSize('');
        setMainProductDetails(null);
    } else {
        toast({ variant: 'destructive', title: 'Error', description: createResult.error });
    }
    setIsLoading(false);
  };
  
  const handleBulkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsBulkLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);

      const uploadData: AlternateBarcodeUploadRow[] = json.map((row) => ({
        referencia: String(row['referencia'] || ''),
        talla: String(row['talla'] || ''),
        codigo_alterno: String(row['codigo_alterno'] || ''),
      })).filter(row => row.referencia && row.talla && row.codigo_alterno);

      if (uploadData.length === 0) {
        throw new Error("El archivo no contiene filas válidas con las columnas 'referencia', 'talla' y 'codigo_alterno'.");
      }

      const result = await bulkCreateAlternateBarcodes(uploadData);
      
      if (result.success) {
        toast({
          title: 'Carga Masiva Completada',
          description: `${result.summary?.successCount} códigos alternos creados. ${result.summary?.failedCount} fallaron.`,
        });
        if (result.errors && result.errors.length > 0) {
          console.error("Errores en la carga masiva:", result.errors);
          // Optionally show more detailed errors in another dialog/toast
        }
      } else {
        throw new Error(result.error);
      }

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error en Carga Masiva', description: error.message });
    } finally {
      setIsBulkLoading(false);
       if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset file input
      }
    }
  };

  const onProductUpdated = () => {
    if (mainProductDetails?.codigoBarras) {
      handleLookupMainProduct('barcode');
    }
    setIsEditDialogOpen(false);
  }

  return (
    <>
      {mainProductDetails && (
        <EditProductDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          product={mainProductDetails}
          onSave={onProductUpdated}
        >
        </EditProductDialog>
      )}

      <div className="space-y-8 max-w-7xl mx-auto">
        <Card>
          <CardHeader className="flex flex-row justify-between items-center">
              <div>
                <CardTitle className="text-2xl">Gestión de Productos y Códigos Alternos</CardTitle>
                <CardDescription>Asocie nuevos códigos de barras o realice una carga masiva desde un archivo Excel.</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                  <Button onClick={onReturn} variant="outline">
                      <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Recepción
                  </Button>
              </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Manual Association Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Asociación Manual de Código Alterno</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Paso 1: Buscar Producto Principal</h3>
                        
                        <div className="space-y-2 p-4 border rounded-md">
                            <Label htmlFor="main-barcode">Opción A: Buscar por Código Principal (Recomendado)</Label>
                            <div className="flex gap-2">
                                <Input 
                                    id="main-barcode"
                                    value={mainBarcode}
                                    onChange={e => setMainBarcode(e.target.value)}
                                    placeholder="Escanear o digitar código existente..."
                                />
                                <Button onClick={() => handleLookupMainProduct('barcode')} disabled={isLoading || !mainBarcode.trim()}>
                                    {isLoading && mainBarcode ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Buscar'}
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-4 p-4 border rounded-md">
                        <Label>Opción B: Buscar por Referencia y Talla</Label>
                        <div className="flex gap-2">
                            <Input 
                                    id="main-reference"
                                    value={mainReference}
                                    onChange={e => setMainReference(e.target.value)}
                                    placeholder="Referencia"
                                />
                                <Input 
                                    id="main-size"
                                    value={mainSize}
                                    onChange={e => setMainSize(e.target.value)}
                                    placeholder="Talla"
                                    className="w-24"
                                />
                        </div>
                            <Button onClick={() => handleLookupMainProduct('refSize')} disabled={isLoading || !mainReference.trim() || !mainSize.trim()} className="w-full">
                                {isLoading && (mainReference || mainSize) ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Buscar por Referencia'}
                            </Button>
                        </div>

                        {isLoading ? (
                            <div className="h-40 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
                                <Loader2 className="h-6 w-6 animate-spin"/>
                            </div>
                        ) : mainProductDetails ? (
                            <Card className="bg-green-500/10 border-green-500/30">
                                <CardHeader className="flex flex-row justify-between items-center pb-2">
                                    <CardTitle className="text-base text-green-700 dark:text-green-300">Producto Encontrado</CardTitle>
                                    <Button variant="ghost" size="sm" onClick={() => setIsEditDialogOpen(true)}>
                                        <Edit className="mr-2 h-4 w-4" /> Editar
                                    </Button>
                                </CardHeader>
                                <CardContent className="space-y-1 text-sm">
                                <p><strong>Cód. Barras:</strong> {mainProductDetails.codigoBarras}</p>
                                <p><strong>Referencia:</strong> {mainProductDetails.reference || mainProductDetails.referencia}</p>
                                <p><strong>Talla:</strong> {mainProductDetails.size || mainProductDetails.talla}</p>
                                <p><strong>Descripción:</strong> {mainProductDetails.item || mainProductDetails.description}</p>
                                <p><strong>Marca:</strong> {mainProductDetails.marca || mainProductDetails.merchandise_type}</p>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="h-40 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
                                <p>Los detalles del producto principal aparecerán aquí.</p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Paso 2: Asociar Código Alterno</h3>
                        <div className="space-y-2">
                            <Label htmlFor="alternate-barcode">Código de Barras Alterno (Nuevo)</Label>
                            <Input 
                                id="alternate-barcode"
                                value={alternateBarcode}
                                onChange={e => setAlternateBarcode(e.target.value)}
                                placeholder="Escanear o digitar código nuevo..."
                                disabled={!mainProductDetails}
                            />
                        </div>
                        <Button onClick={handleAssociate} className="w-full" disabled={isLoading || !mainProductDetails || !alternateBarcode.trim()}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Link2 className="mr-2 h-4 w-4"/>}
                            Asociar Código Alterno
                        </Button>
                    </div>
                </CardContent>
            </Card>

             {/* Bulk Upload Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Carga Masiva de Códigos Alternos</CardTitle>
                </CardHeader>
                 <CardContent className="flex flex-col items-center justify-center h-full space-y-4">
                     <p className="text-sm text-muted-foreground text-center">
                        Suba un archivo Excel (.xlsx, .xls) con las columnas: <br/>
                        <code className="font-mono bg-muted p-1 rounded-md">referencia</code>, 
                        <code className="font-mono bg-muted p-1 rounded-md">talla</code>, 
                        <code className="font-mono bg-muted p-1 rounded-md">codigo_alterno</code>.
                    </p>
                    <input type="file" ref={fileInputRef} onChange={handleBulkUpload} className="hidden" accept=".xlsx, .xls"/>
                    <Button onClick={() => fileInputRef.current?.click()} disabled={isBulkLoading} className="w-full">
                        {isBulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                        {isBulkLoading ? 'Procesando...' : 'Seleccionar Archivo'}
                    </Button>
                </CardContent>
            </Card>
        </div>
      </div>
    </>
  );
};
