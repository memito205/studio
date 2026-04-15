/** @jsxImportSource react */
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getExternalVendors, saveExternalVendor, deleteExternalVendor } from '@/app/reception/actions';
import type { ExternalVendor, ExternalOperator } from '@/types';
import { Loader2, Plus, Edit2, Trash2, Shield, Users, Save, X, UserPlus, Key } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const ExternalVendorManager: React.FC = () => {
    const { toast } = useToast();
    const [vendors, setVendors] = useState<ExternalVendor[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    
    // Form state
    const [editingVendor, setEditingVendor] = useState<Partial<ExternalVendor> | null>(null);
    const [currentOperators, setCurrentOperators] = useState<ExternalOperator[]>([]);
    
    // New operator form
    const [newOpName, setNewOpName] = useState('');
    const [newOpPin, setNewOpPin] = useState('');

    const fetchVendors = async () => {
        setIsLoading(true);
        const result = await getExternalVendors();
        if (result.success && result.data) {
            setVendors(result.data);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        fetchVendors();
    }, []);

    const handleOpenDialog = (vendor?: ExternalVendor) => {
        if (vendor) {
            setEditingVendor(vendor);
            setCurrentOperators(vendor.operators || []);
        } else {
            setEditingVendor({ name: '', active: true, operators: [] });
            setCurrentOperators([]);
        }
        setNewOpName('');
        setNewOpPin('');
        setIsDialogOpen(true);
    };

    const addOperator = () => {
        if (!newOpName || newOpPin.length !== 4) {
            toast({ variant: 'destructive', title: 'Error', description: 'Nombre y PIN (4 dígitos) son requeridos.' });
            return;
        }

        if (currentOperators.some(o => o.name.toLowerCase() === newOpName.toLowerCase())) {
            toast({ variant: 'destructive', title: 'Error', description: 'Este operario ya existe.' });
            return;
        }

        setCurrentOperators([...currentOperators, { name: newOpName, pin: newOpPin }]);
        setNewOpName('');
        setNewOpPin('');
    };

    const removeOperator = (name: string) => {
        setCurrentOperators(currentOperators.filter(o => o.name !== name));
    };

    const handleSave = async () => {
        if (!editingVendor?.name) {
            toast({ variant: 'destructive', title: 'Error', description: 'El nombre de la empresa es obligatorio.' });
            return;
        }

        setIsSaving(true);
        
        const result = await saveExternalVendor({
            ...editingVendor,
            operators: currentOperators
        });

        if (result.success) {
            toast({ title: 'Éxito', description: 'Empresa y operarios guardados correctamente.' });
            setIsDialogOpen(false);
            fetchVendors();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;
        
        const result = await deleteExternalVendor(id);
        if (result.success) {
            toast({ title: 'Eliminado', description: 'Empresa eliminada.' });
            fetchVendors();
        } else {
             toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
    };

    if (isLoading) {
        return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-xl font-bold">Gestión de Proveedores Externos</h3>
                    <p className="text-sm text-muted-foreground">Configure empresas y asigne PINes individuales a sus operarios.</p>
                </div>
                <Button onClick={() => handleOpenDialog()}>
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {vendors.map((vendor) => (
                    <Card key={vendor.id} className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">{vendor.name}</CardTitle>
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(vendor)}>
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(vendor.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pb-4">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                                    <Users className="h-4 w-4" /> Operarios ({vendor.operators?.length || 0}):
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {vendor.operators && vendor.operators.length > 0 ? (
                                        vendor.operators.map((op, i) => (
                                            <div key={i} className="flex items-center gap-1 bg-secondary px-2 py-1 rounded-md text-[11px]">
                                                <span className="font-bold">{op.name}</span>
                                                <span className="text-muted-foreground border-l pl-1 ml-1 flex items-center gap-1">
                                                    <Key className="h-2 w-2" /> {op.pin}
                                                </span>
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs italic text-muted-foreground">Sin personal configurado</span>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingVendor?.id ? 'Editar Empresa y Personal' : 'Nuevo Registro de Proveedor'}</DialogTitle>
                        <DialogDescription>
                            Configure el nombre de la empresa y los PINes individuales de cada trabajador.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nombre de la Empresa</Label>
                            <Input 
                                id="name" 
                                value={editingVendor?.name || ''} 
                                onChange={(e) => setEditingVendor(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Ej: LogisPack S.A.S"
                            />
                        </div>

                        <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                            <h4 className="font-semibold flex items-center gap-2 text-sm">
                                <UserPlus className="h-4 w-4" /> Gestionar Personal
                            </h4>
                            <div className="grid grid-cols-5 gap-2 items-end">
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-[10px]">Nombre del Operario</Label>
                                    <Input 
                                        placeholder="Ej: Juan Garcia" 
                                        value={newOpName}
                                        onChange={(e) => setNewOpName(e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                </div>
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-[10px]">PIN Personal (4)</Label>
                                    <Input 
                                        placeholder="1234" 
                                        maxLength={4}
                                        value={newOpPin}
                                        onChange={(e) => setNewOpPin(e.target.value.replace(/\D/g, ''))}
                                        className="h-8 text-xs font-mono"
                                    />
                                </div>
                                <Button size="sm" onClick={addOperator} className="h-8">
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="mt-4 border rounded-md overflow-hidden bg-background">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50 h-8">
                                            <TableHead className="text-[10px] h-8">Nombre</TableHead>
                                            <TableHead className="text-[10px] h-8">PIN</TableHead>
                                            <TableHead className="text-right h-8"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentOperators.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-4 text-xs text-muted-foreground italic">
                                                    No hay operarios asignados.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            currentOperators.map((op, i) => (
                                                <TableRow key={i} className="h-8">
                                                    <TableCell className="font-medium text-xs py-1 h-8">{op.name}</TableCell>
                                                    <TableCell className="text-xs py-1 h-8 font-mono">{op.pin}</TableCell>
                                                    <TableCell className="text-right py-1 h-8">
                                                        <Button 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            className="h-6 w-6 text-destructive"
                                                            onClick={() => removeOperator(op.name)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar Cambios
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
