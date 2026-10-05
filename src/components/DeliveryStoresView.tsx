"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, CheckCircle2, Download, Loader2, MapPin, Save, UploadCloud, X } from 'lucide-react';
import {
  assignStoreToUser,
  getDeliveryStores,
  getQuickLegacyEvidence,
  getStoreUsers,
  saveDeliveryStores,
  snapshotQuickLegacyEvidence,
  type StoreUser,
} from '@/app/deliveryActions';
import type { DeliveryStore } from '@/types';
import {
  parseStoreRows,
  STORE_TEMPLATE_COLUMNS,
  storeToTemplateRow,
  type StoreRowIssue,
} from '@/lib/deliveryStores';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const INSTRUCTIONS = [
  ['Columna', 'Obligatoria', 'Descripción'],
  ['Codigo ERP', 'Sí', 'Código de la bodega destino tal como aparece en la TF (ej. 21101). Es la llave: si ya existe se actualiza.'],
  ['Nombre corto', 'Sí', 'Como la conocen en bodega (ej. BR 11).'],
  ['Nombre tienda', 'Sí', 'Nombre completo del punto.'],
  ['Ciudad', 'Sí', ''],
  ['Direccion', 'Sí', 'Dirección y local.'],
  ['Latitud', 'Sí', 'En Google Maps: clic derecho sobre la tienda > clic en los números (ej. 6.200512, -75.574123). El primero es Latitud.'],
  ['Longitud', 'Sí', 'El segundo número. En Colombia es negativo.'],
  ['Codigos equivalentes', 'No', 'Otros nombres del mismo punto en Excels/analizador, separados por coma (ej. B11, 211, BR11).'],
  ['Radio validacion (m)', 'No', 'Distancia máxima para considerar que la entrega se registró en la tienda. Vacío = 300.'],
  ['Dias de visita', 'No', 'Ej. L, X, V.'],
  ['Horario de recibo', 'No', 'Ej. 8:00-11:00.'],
  ['Telefono tienda', 'No', ''],
  ['Quienes reciben', 'No', 'Personas que suelen recibir, separadas por punto y coma. Se le ofrecen al conductor con un toque.'],
  ['Notas de acceso', 'No', 'Se le muestran al conductor (muelle, parqueadero, etc.).'],
  ['Activo', 'Sí', 'SI o NO.'],
];

/** Base histórica de pruebas Quick (TF antiguas entregadas antes de la app del conductor). */
export function QuickLegacyCard() {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'save' | 'download' | null>(null);

  const handleSnapshot = async () => {
    setBusy('save');
    const actor = user?.uid ? { userId: user.uid, displayName: userName || user.email || 'Usuario' } : undefined;
    const res = await snapshotQuickLegacyEvidence(actor);
    setBusy(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    toast({
      title: 'Base histórica Quick actualizada',
      description: `${res.saved} registro(s) nuevos o con links nuevos. Total en la base: ${res.total}.`,
    });
  };

  const handleDownload = async () => {
    setBusy('download');
    const res = await getQuickLegacyEvidence();
    setBusy(null);
    if (res.error || !res.data) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    if (res.data.length === 0) {
      toast({ title: 'Sin datos', description: 'Primero guarde la base desde el analizador publicado.' });
      return;
    }
    const rows = res.data.map((r) => ({
      TF: r.numeroTF,
      Destino: r.bodegaDestino,
      'Fecha servicio': r.fechaFinalizado ? r.fechaFinalizado.slice(0, 10) : '',
      Placa: r.placaEntrega || '',
      Links: r.evidenceLinks.join(' | '),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Quick');
    XLSX.writeFile(wb, 'Base_Historica_Quick.xlsx');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Base histórica de pruebas Quick</CardTitle>
        <CardDescription>
          Guarda los links de evidencia Quick que el analizador ya publicó (TF antiguas), para consultarlos sin volver a subir el Excel.
          Se puede repetir: solo agrega lo nuevo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={handleSnapshot} disabled={busy !== null}>
          {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar / actualizar base
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={busy !== null}>
          {busy === 'download' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Descargar base (Excel)
        </Button>
      </CardContent>
    </Card>
  );
}

const NO_STORE = '__none__';

/** Usuarios con rol tiendas: cada uno queda fijo a una tienda para recibir escaneando. */
export function StoreUsersCard() {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<StoreUser[]>([]);
  const [stores, setStores] = useState<DeliveryStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, s] = await Promise.all([getStoreUsers(), getDeliveryStores()]);
    setLoading(false);
    if (u.error) toast({ variant: 'destructive', title: 'Error', description: u.error });
    setUsers(u.data || []);
    setStores((s.data || []).filter((x) => x.activo));
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedTo = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => u.storeCode && m.set(u.storeCode, u.uid));
    return m;
  }, [users]);

  const handleAssign = async (uid: string, value: string) => {
    const storeCode = value === NO_STORE ? null : value;
    setSavingUid(uid);
    const actor = user?.uid ? { userId: user.uid, displayName: userName || user.email || 'Usuario' } : undefined;
    const res = await assignStoreToUser({ uid, storeCode, actor });
    setSavingUid(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se asignó', description: res.error });
      return;
    }
    setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, storeCode: storeCode || undefined } : u)));
    toast({ title: storeCode ? 'Tienda asignada' : 'Tienda retirada' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Usuarios de tienda</CardTitle>
        <CardDescription>
          Cada usuario con rol &quot;tiendas&quot; queda fijo a una tienda (una tienda = un usuario). Con eso recibe la mercancía escaneando
          en &quot;Consulta Estado TF&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 text-center">
            <Loader2 className="inline h-5 w-5 animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay usuarios con rol tiendas.</p>
        ) : (
          <div className="border rounded-md overflow-auto max-h-[50vh]">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead className="w-[280px]">Tienda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.uid}>
                    <TableCell>
                      <div className="font-medium">{u.displayName}</div>
                      {u.email && <div className="text-xs text-muted-foreground">{u.email}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={u.storeCode || NO_STORE}
                          onValueChange={(v) => void handleAssign(u.uid, v)}
                          disabled={savingUid === u.uid}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_STORE}>Sin tienda</SelectItem>
                            {stores.map((s) => {
                              const owner = assignedTo.get(s.codigoErp);
                              return (
                                <SelectItem key={s.id} value={s.codigoErp} disabled={Boolean(owner && owner !== u.uid)}>
                                  {s.nombreCorto} ({s.codigoErp}){owner && owner !== u.uid ? ' · asignada' : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {savingUid === u.uid && <Loader2 className="h-4 w-4 animate-spin" />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DeliveryStoresView() {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stores, setStores] = useState<DeliveryStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ fileName: string; stores: DeliveryStore[]; issues: StoreRowIssue[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getDeliveryStores();
    setLoading(false);
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setStores(res.data || []);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadTemplate = () => {
    const rows = stores.length
      ? stores.map(storeToTemplateRow)
      : [Object.fromEntries(STORE_TEMPLATE_COLUMNS.map((c) => [c.header, c.example]))];
    const ws = XLSX.utils.json_to_sheet(rows, { header: STORE_TEMPLATE_COLUMNS.map((c) => c.header) });
    ws['!cols'] = STORE_TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tiendas');
    const help = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
    help['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, help, 'Instrucciones');
    XLSX.writeFile(wb, stores.length ? 'Maestro_Tiendas_Entregas.xlsx' : 'Plantilla_Tiendas_Entregas.xlsx');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets['Tiendas'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
      const parsed = parseStoreRows(rows);
      setPreview({ fileName: file.name, ...parsed });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'No se pudo leer el archivo', description: err.message });
    }
  };

  const errorRows = useMemo(() => (preview?.issues || []).filter((i) => i.errors.length), [preview]);

  const handleSave = async () => {
    if (!preview?.stores.length) return;
    setSaving(true);
    const actor = user?.uid ? { userId: user.uid, displayName: userName || user.email || 'Usuario' } : undefined;
    const res = await saveDeliveryStores(preview.stores, actor);
    setSaving(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    toast({ title: 'Maestro de tiendas guardado', description: `${res.created} nueva(s), ${res.updated} actualizada(s).` });
    setPreview(null);
    void load();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Tiendas para entregas</CardTitle>
            <CardDescription>
              Maestro de puntos de entrega (código, dirección y coordenadas). Lo usan las relaciones de entrega y la app del conductor.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              {stores.length ? 'Descargar maestro (plantilla)' : 'Descargar plantilla'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
            <Button onClick={() => fileRef.current?.click()}>
              <UploadCloud className="mr-2 h-4 w-4" /> Cargar Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview && (
          <div className="rounded-md border p-3 space-y-3 bg-muted/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <strong>{preview.fileName}</strong>: {preview.stores.length} tienda(s) válidas
                {errorRows.length > 0 && <span className="text-destructive">, {errorRows.length} fila(s) con error (no se guardan)</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  <X className="mr-1 h-4 w-4" /> Cancelar
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving || preview.stores.length === 0}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Guardar {preview.stores.length}
                </Button>
              </div>
            </div>
            {preview.issues.length > 0 && (
              <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                {preview.issues.map((i) => (
                  <li key={`${i.row}-${i.codigo}`} className="flex gap-2">
                    {i.errors.length ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <span>
                      Fila {i.row} {i.codigo && `(${i.codigo})`}: {[...i.errors, ...i.warnings].join('; ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="border rounded-md overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Ciudad / Dirección</TableHead>
                <TableHead>Equivalentes</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="inline h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : stores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Aún no hay tiendas. Descargue la plantilla, llénela y cárguela.
                  </TableCell>
                </TableRow>
              ) : (
                stores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono">{s.codigoErp}</TableCell>
                    <TableCell>
                      <div className="font-medium">{s.nombreCorto}</div>
                      <div className="text-xs text-muted-foreground">{s.nombreTienda}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{s.ciudad}</div>
                      <div className="text-muted-foreground">{s.direccion}</div>
                    </TableCell>
                    <TableCell className="text-xs">{s.codigosEquivalentes.join(', ')}</TableCell>
                    <TableCell className="text-xs">
                      {s.latitud !== null && s.longitud !== null ? (
                        <a
                          href={`https://www.google.com/maps?q=${s.latitud},${s.longitud}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary underline"
                        >
                          <MapPin className="h-3.5 w-3.5" /> Ver ({s.radioValidacionM} m)
                        </a>
                      ) : (
                        <span className="text-amber-600">Sin coordenadas</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.activo ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Activa
                        </Badge>
                      ) : (
                        <Badge variant="outline">Inactiva</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
