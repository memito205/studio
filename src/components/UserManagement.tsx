
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { AppUser } from '@/types';
import type { UserRole } from '@/hooks/use-auth-context';
import { Download, FileSpreadsheet, Loader2, PlusCircle, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { createUser, createUsersBulk, listAllUsers, updateUserRole, deleteUser, type BulkUserResult, type BulkUserRow } from '@/app/admin/actions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export const UserManagement = () => {
    const { toast } = useToast();
    const [users, setUsers] = useState<AppUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [role, setRole] = useState<UserRole>('operator');

    const fetchUsers = React.useCallback(async () => {
        setIsLoading(true);
        const result = await listAllUsers();
        if (result.success && result.data?.users) {
            setUsers(result.data.users);
        } else {
            toast({ variant: 'destructive', title: 'Error al cargar usuarios', description: result.error });
        }
        setIsLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        const result = await createUser({ email, password, displayName, role });
        if (result.success) {
            toast({ title: 'Usuario Creado', description: `El usuario ${email} ha sido creado exitosamente.` });
            setEmail('');
            setPassword('');
            setDisplayName('');
            setRole('operator');
            fetchUsers();
        } else {
            toast({ variant: 'destructive', title: 'Error al crear usuario', description: result.error });
        }
        setIsSubmitting(false);
    };

    const fileRef = React.useRef<HTMLInputElement>(null);
    const [bulkResults, setBulkResults] = useState<BulkUserResult[] | null>(null);
    const [isBulkLoading, setIsBulkLoading] = useState(false);

    const downloadTemplate = () => {
        const ws = XLSX.utils.json_to_sheet([
            { Nombre: 'JUAN PEREZ', Correo: 'juan.perez@tiendasbranchos.com', Contraseña: 'Clave123', Rol: 'Operario' },
        ]);
        const help = XLSX.utils.aoa_to_sheet([
            ['Roles válidos'],
            ['Operario'], ['Supervisor'], ['Conductor'], ['Tiendas'], ['Etiquetado externo'], ['Administrador'], ['Oficina'],
            [],
            ['Contraseña: mínimo 6 caracteres. Si el correo ya existe con esa misma contraseña, solo se crea/actualiza el perfil.'],
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
        XLSX.utils.book_append_sheet(wb, help, 'Ayuda');
        XLSX.writeFile(wb, 'Plantilla_usuarios.xlsx');
    };

    const handleBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setIsBulkLoading(true);
        setBulkResults(null);
        try {
            const wb = XLSX.read(await file.arrayBuffer());
            const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
            const pick = (row: Record<string, unknown>, ...names: string[]) => {
                const key = Object.keys(row).find((k) =>
                    names.includes(k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
                );
                return key ? String(row[key] ?? '').trim() : '';
            };
            const rows: BulkUserRow[] = raw
                .map((r) => ({
                    displayName: pick(r, 'nombre', 'name', 'displayname'),
                    email: pick(r, 'correo', 'email', 'correo electronico'),
                    password: pick(r, 'contrasena', 'password', 'clave'),
                    role: pick(r, 'rol', 'role'),
                }))
                .filter((r) => r.email || r.displayName);
            if (rows.length === 0) {
                toast({ variant: 'destructive', title: 'Archivo vacío', description: 'Use las columnas Nombre, Correo, Contraseña y Rol.' });
                return;
            }
            const res = await createUsersBulk(rows);
            if (!res.success || !res.data) {
                toast({ variant: 'destructive', title: 'No se pudo procesar', description: res.error });
                return;
            }
            setBulkResults(res.data);
            const ok = res.data.filter((r) => r.ok).length;
            toast({ title: 'Carga terminada', description: `${ok} de ${res.data.length} usuarios listos.` });
            fetchUsers();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error leyendo el Excel', description: err?.message });
        } finally {
            setIsBulkLoading(false);
        }
    };

    const handleRoleChange = async (uid: string, newRole: UserRole) => {
        const result = await updateUserRole({ uid, role: newRole });
        if (result.success) {
            toast({ title: 'Rol Actualizado', description: 'El rol del usuario ha sido actualizado.' });
            fetchUsers();
        } else {
            toast({ variant: 'destructive', title: 'Error al actualizar rol', description: result.error });
        }
    };

    const handleDeleteUser = async (uid: string) => {
        const result = await deleteUser({ uid });
        if (result.success) {
            toast({ title: 'Usuario Eliminado', description: 'El usuario ha sido eliminado exitosamente.' });
            fetchUsers();
        } else {
            toast({ variant: 'destructive', title: 'Error al eliminar usuario', description: result.error });
        }
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gestión de Usuarios</CardTitle>
        <CardDescription>
          Crear, ver y administrar los usuarios y sus roles en la aplicación.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Create User Form */}
        <div className="p-6 border rounded-lg">
            <h3 className="text-lg font-medium mb-4">Crear Nuevo Usuario</h3>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <div className="space-y-2">
                    <Label htmlFor="displayName">Nombre</Label>
                    <Input id="displayName" value={displayName} onChange={e => setDisplayName(e.target.value)} required />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="email">Correo Electrónico</Label>
                    <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="role">Rol</Label>
                    <Select value={role} onValueChange={(value: UserRole) => setRole(value)}>
                        <SelectTrigger id="role">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="operator">Operario</SelectItem>
                            <SelectItem value="supervisor">Supervisor</SelectItem>
                            <SelectItem value="conductor">Conductor</SelectItem>
                            <SelectItem value="tiendas">Tiendas</SelectItem>
                            <SelectItem value="external_operator">Etiquetado externo / Tallado</SelectItem>
                            <SelectItem value="admin">Administrador</SelectItem>
                            <SelectItem value="office">Oficina</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="lg:col-span-4 flex justify-end">
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <PlusCircle className="mr-2 h-4 w-4" />}
                        Crear Usuario
                    </Button>
                </div>
            </form>
        </div>

        <div className="p-6 border rounded-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-lg font-medium">Cargar usuarios desde Excel</h3>
                    <p className="text-sm text-muted-foreground">
                        Columnas: Nombre, Correo, Contraseña, Rol. Crea la cuenta en Firebase y el perfil con su rol, sin copiar IDs.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={downloadTemplate}>
                        <Download className="mr-2 h-4 w-4" /> Plantilla
                    </Button>
                    <Button type="button" onClick={() => fileRef.current?.click()} disabled={isBulkLoading}>
                        {isBulkLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                        Subir Excel
                    </Button>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBulkFile} />
                </div>
            </div>
            {bulkResults && (
                <div className="border rounded-lg overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Correo</TableHead>
                                <TableHead>Resultado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {bulkResults.map((r, i) => (
                                <TableRow key={`${r.email}-${i}`}>
                                    <TableCell>{r.displayName}</TableCell>
                                    <TableCell>{r.email}</TableCell>
                                    <TableCell className={r.ok ? 'text-green-700' : 'text-destructive'}>
                                        {r.ok ? (r.status === 'ya_existia' ? 'Ya existía: perfil actualizado' : 'Creado') : r.error}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>

        {/* Users Table */}
        <div>
          <h3 className="text-lg font-medium mb-4">Usuarios Existentes</h3>
          <div className="border rounded-lg overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Correo</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={4} className="text-center h-24">
                                <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                            </TableCell>
                        </TableRow>
                    ) : users.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                                No se encontraron usuarios.
                            </TableCell>
                        </TableRow>
                    ) : (
                       users.map(user => (
                           <TableRow key={user.uid}>
                               <TableCell>{user.displayName}</TableCell>
                               <TableCell>{user.email}</TableCell>
                               <TableCell>
                                   <Select value={user.role} onValueChange={(newRole: UserRole) => handleRoleChange(user.uid, newRole)}>
                                        <SelectTrigger className="w-36">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="operator">Operario</SelectItem>
                                            <SelectItem value="supervisor">Supervisor</SelectItem>
                                            <SelectItem value="conductor">Conductor</SelectItem>
                                            <SelectItem value="tiendas">Tiendas</SelectItem>
                                            <SelectItem value="external_operator">Etiquetado externo / Tallado</SelectItem>
                                            <SelectItem value="admin">Administrador</SelectItem>
                                            <SelectItem value="office">Oficina</SelectItem>
                                        </SelectContent>
                                   </Select>
                               </TableCell>
                               <TableCell className="text-right">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="icon">
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                            <AlertDialogTitle>¿Está seguro?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Esta acción eliminará permanentemente al usuario {user.email}.
                                            </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteUser(user.uid)}>Eliminar</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                               </TableCell>
                           </TableRow>
                       ))
                    )}
                </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
