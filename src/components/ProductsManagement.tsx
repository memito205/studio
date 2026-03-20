
"use client";

import React, { useState, useCallback, useRef, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Link2, Loader2, Edit, UploadCloud, PlusCircle } from 'lucide-react';
import type { ReceptionProduct as Product, AlternateBarcodeUploadRow, ProductDatabaseItem } from '@/types';
import { lookupBarcode, createProduct, getProductByRefAndSize, bulkCreateAlternateBarcodes, bulkCreateProducts } from '@/app/reception/actions';
import { EditProductDialog } from './EditProductDialog';
import { Textarea } from './ui/textarea';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAuth } from '@/hooks/use-auth-context';


interface ProductsManagementProps {
    onReturn: () => void;
}

const newProductSchema = z.object({
  name: z.string().min(1, { message: 'El nombre del producto es requerido.' }),
  barcode: z.string().min(1, { message: 'El código de barras es requerido.' }),
  description: z.string().optional(),
  reference: z.string().optional(),
  size: z.string().optional(),
  merchandise_type: z.string().optional(),
  location: z.string().optional(),
});


export const ProductsManagement: React.FC<ProductsManagementProps> = ({ onReturn }) => {
  // State for manual association
  const [alternateBarcode, setAlternateBarcode] = useState('');
  const [mainBarcode, setMainBarcode] = useState('');
  const [mainReference, setMainReference] = useState('');
  const [mainSize, setMainSize] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [mainProductDetails, setMainProductDetails] = useState<Product | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const bulkProductsFileInputRef = React.useRef<HTMLInputElement>(null);
  const bulkAlternatesFileInputRef = React.useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const { user } = useAuth();
  
  const newProductForm = useForm<z.infer<typeof newProductSchema>>({
    resolver: zodResolver(newProductSchema),
    defaultValues: {
      name: '',
      barcode: '',
      description: '',
      reference: '',
      size: '',
      merchandise_type: '',
      location: '',
    },
  });

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
  
  const handleBulkAlternatesUpload = async (event: ChangeEvent<HTMLInputElement>) => {
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
          toast({
            variant: "destructive",
            title: `Se encontraron ${result.summary?.failedCount} errores`,
            description: `Ej: ${result.errors[0]}. Revisa la consola del navegador (F12) para ver todos los detalles.`,
            duration: 10000,
          });
          console.error("Errores en la carga masiva:", result.errors);
        }
      } else {
        throw new Error(result.error);
      }

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error en Carga Masiva', description: error.message });
    } finally {
      setIsBulkLoading(false);
       if (bulkAlternatesFileInputRef.current) {
        bulkAlternatesFileInputRef.current.value = ""; // Reset file input
      }
    }
  };

  const handleBulkProductsUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsBulkLoading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);

      const productsToCreate: ProductDatabaseItem[] = json.map(row => ({
          id: String(row.codigo_barras), // id and codigoBarras are the same
          codigoBarras: String(row.codigo_barras || ''),
          referencia: String(row.referencia || ''),
          talla: String(row.talla || ''),
          item: String(row.descripcion || ''),
          marca: String(row.marca || ''),
          grupo: String(row.grupo || ''),
      })).filter(p => p.codigoBarras);

      if (productsToCreate.length === 0) {
        throw new Error("El archivo no contiene productos válidos con la columna 'codigo_barras'.");
      }
      
      const result = await bulkCreateProducts(productsToCreate);

      if(result.success) {
          toast({ title: "Carga Exitosa", description: `${result.summary?.successCount} productos fueron creados o actualizados.`});
      } else {
          throw new Error(result.error);
      }

    } catch (error: any) {
       toast({ variant: 'destructive', title: 'Error en Carga Masiva', description: error.message });
    } finally {
      setIsBulkLoading(false);
      if (bulkProductsFileInputRef.current) {
        bulkProductsFileInputRef.current.value = "";
      }
    }
  };


  const handleCreateNewProduct = async (values: z.infer<typeof newProductSchema>) => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Debe iniciar sesión para crear un producto.'});
      return;
    }
    setIsLoading(true);
    const result = await createProduct({ ...values });
    if(result.success) {
      toast({ title: 'Éxito', description: `Producto '${values.name}' creado correctamente.` });
      newProductForm.reset();
    } else {
      toast({ variant: 'destructive', title: 'Error al Crear', description: result.error });
    }
    setIsLoading(false);
  }

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
                <CardTitle className="text-2xl">Gestión de Catálogo de Productos</CardTitle>
                <CardDescription>Cree, asocie o cargue masivamente productos en el catálogo maestro.</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                  <Button onClick={onReturn} variant="outline">
                      <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Recepción
                  </Button>
              </div>
          </CardHeader>
        </Card>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Manual Creation Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Crear Nuevo Producto (Manual)</CardTitle>
                    <CardDescription>Añada un único producto nuevo al catálogo maestro.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                   <Form {...newProductForm}>
                    <form onSubmit={newProductForm.handleSubmit(handleCreateNewProduct)} className="space-y-4">
                       <FormField
                        control={newProductForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nombre Producto</FormLabel>
                            <FormControl><Input placeholder="Ej: CAMISETA LOGO GRANDE" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                       <FormField
                        control={newProductForm.control}
                        name="barcode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Código de Barras</FormLabel>
                            <FormControl><Input placeholder="Escanear o digitar código..." {...field} /></FormControl>
                             <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4">
                         <FormField
                            control={newProductForm.control}
                            name="reference"
                            render={({ field }) => (
                              <FormItem><FormLabel>Referencia</FormLabel><FormControl><Input placeholder="Ej: AB-123" {...field} /></FormControl><FormMessage /></FormItem>
                            )}
                          />
                          <FormField
                            control={newProductForm.control}
                            name="size"
                            render={({ field }) => (
                              <FormItem><FormLabel>Talla</FormLabel><FormControl><Input placeholder="Ej: M" {...field} /></FormControl><FormMessage /></FormItem>
                            )}
                          />
                      </div>
                       <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={newProductForm.control}
                            name="merchandise_type"
                            render={({ field }) => (
                              <FormItem><FormLabel>Marca</FormLabel><FormControl><Input placeholder="Ej: NIKE" {...field} /></FormControl><FormMessage /></FormItem>
                            )}
                          />
                          <FormField
                            control={newProductForm.control}
                            name="location"
                            render={({ field }) => (
                              <FormItem><FormLabel>Grupo/Categoría</FormLabel><FormControl><Input placeholder="Ej: ROPA" {...field} /></FormControl><FormMessage /></FormItem>
                            )}
                          />
                      </div>
                      <FormField
                        control={newProductForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem><FormLabel>Descripción (Opcional)</FormLabel><FormControl><Textarea placeholder="Detalles adicionales..." {...field} /></FormControl><FormMessage /></FormItem>
                        )}
                      />
                      <Button type="submit" className="w-full" disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlusCircle className="mr-2 h-4 w-4" />}
                        Guardar Producto
                      </Button>
                    </form>
                   </Form>
                </CardContent>
            </Card>

            {/* Bulk Upload Card */}
            <div className="space-y-8">
              <Card>
                  <CardHeader>
                      <CardTitle>Carga Masiva desde Excel</CardTitle>
                      <CardDescription>Añada múltiples productos o códigos alternos a la vez.</CardDescription>
                  </CardHeader>
                   <CardContent className="space-y-4">
                       <div className="p-4 border rounded-md bg-muted/30">
                            <input type="file" ref={bulkProductsFileInputRef} onChange={handleBulkProductsUpload} className="hidden" accept=".xlsx, .xls"/>
                            <Label htmlFor="bulk-upload-new">Opción A: Cargar Nuevos Productos</Label>
                            <p className="text-xs text-muted-foreground mt-1 mb-2">Columnas requeridas: `codigo_barras`, `referencia`, `talla`, `descripcion`, `marca`, `grupo`.</p>
                            <Button onClick={() => bulkProductsFileInputRef.current?.click()} disabled={isBulkLoading} className="w-full" variant="outline">
                                {isBulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                                Cargar Archivo de Productos
                            </Button>
                       </div>
                       <div className="p-4 border rounded-md bg-muted/30">
                            <input type="file" ref={bulkAlternatesFileInputRef} onChange={handleBulkAlternatesUpload} className="hidden" accept=".xlsx, .xls"/>
                            <Label htmlFor="bulk-upload-alt">Opción B: Cargar Códigos Alternos</Label>
                             <p className="text-xs text-muted-foreground mt-1 mb-2">Columnas requeridas: `referencia`, `talla`, `codigo_alterno`.</p>
                            <Button onClick={() => bulkAlternatesFileInputRef.current?.click()} disabled={isBulkLoading} className="w-full" variant="outline">
                                {isBulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                                {isBulkLoading ? 'Procesando...' : 'Cargar Archivo de Alternos'}
                            </Button>
                       </div>
                  </CardContent>
              </Card>
            </div>
        </div>

        {/* Manual Association Card */}
        <Card>
            <CardHeader>
                <CardTitle>Asociación Manual de Código Alterno</CardTitle>
                <CardDescription>Cree un "alias" para un producto que ya existe en el catálogo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <h3 className="font-semibold text-lg">Paso 1: Buscar Producto Principal</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2 p-4 border rounded-md">
                          <Label htmlFor="main-barcode">Opción A: Buscar por Código Principal (Recomendado)</Label>
                          <div className="flex gap-2">
                              <Input id="main-barcode" value={mainBarcode} onChange={e => setMainBarcode(e.target.value)} placeholder="Escanear o digitar código..." />
                              <Button onClick={() => handleLookupMainProduct('barcode')} disabled={isLoading || !mainBarcode.trim()}>
                                  {isLoading && mainBarcode ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Buscar'}
                              </Button>
                          </div>
                      </div>
                      <div className="space-y-2 p-4 border rounded-md">
                          <Label>Opción B: Buscar por Referencia y Talla</Label>
                          <div className="flex gap-2 items-center">
                              <Input id="main-reference" value={mainReference} onChange={e => setMainReference(e.target.value)} placeholder="Referencia" />
                              <Input id="main-size" value={mainSize} onChange={e => setMainSize(e.target.value)} placeholder="Talla" className="w-24" />
                               <Button onClick={() => handleLookupMainProduct('refSize')} disabled={isLoading || !mainReference.trim() || !mainSize.trim()}>
                                  {isLoading && (mainReference || mainSize) ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Buscar'}
                              </Button>
                          </div>
                      </div>
                    </div>

                    {isLoading ? (
                        <Skeleton className="h-40 w-full" />
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
                        <Input id="alternate-barcode" value={alternateBarcode} onChange={e => setAlternateBarcode(e.target.value)} placeholder="Escanear o digitar código nuevo..." disabled={!mainProductDetails} />
                    </div>
                    <Button onClick={handleAssociate} className="w-full" disabled={isLoading || !mainProductDetails || !alternateBarcode.trim()}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Link2 className="mr-2 h-4 w-4"/>}
                        Asociar Código Alterno
                    </Button>
                </div>
            </CardContent>
        </Card>

      </div>
    </>
  );
};
