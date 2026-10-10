"use client";

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/use-auth-context';
import { createRouteTasks, type NewRouteTask } from '@/app/routeTaskActions';
import { DriverUserSelect, type DriverValue } from '@/components/DriverUserSelect';
import { looksLikeTfNumber } from '@/lib/pod';
import type { VehiclePlan } from '../types';

const cleanPoint = (v: string) => String(v || '').trim().toUpperCase().replace(/-[RP]$/, '');

/**
 * Una tarea por TF: RECOGER = punto de recogida, ENTREGAR = punto de entrega. Solo RECOGER → se deja en bodega.
 * Filas cuyo "TF" es texto (SOBRE, DOCUMENTOS…) = envío sin TF, una tarea por fila.
 */
export function planToRouteTasks(plan: VehiclePlan): NewRouteTask[] {
  const byTf = new Map<string, NewRouteTask & { idx: number; deliverIdx?: number }>();
  plan.tasks.forEach((t, idx) => {
    const tf = String(t.tf || '').trim();
    if (!tf) return;
    const isTf = looksLikeTfNumber(tf);
    const key = isTf ? tf.replace(/^TF[-\s]?/i, '') : `row-${t.id}`;
    const cur = byTf.get(key) || (isTf
      ? { numeroTF: key, deliverPoint: '', idx }
      : { kind: 'libre' as const, description: tf, refText: tf, deliverPoint: '', idx });
    if (t.type === 'RECOGER') {
      cur.pickupPoint = cleanPoint(t.valor || '');
      const para = (t.observaciones || '').match(/PARA ENTREGA EN ([^-\s]+)/);
      if (para && !cur.deliverPoint) cur.deliverPoint = cleanPoint(para[1]);
    } else {
      cur.deliverPoint = cleanPoint(t.valor || '');
      cur.deliverIdx = idx;
    }
    const extra = [t.seEnviaCon, t.observaciones].filter(Boolean).join(' · ');
    if (extra) cur.notes = cur.notes ? `${cur.notes} · ${extra}` : extra;
    byTf.set(key, cur);
  });
  return Array.from(byTf.values())
    .sort((a, b) => a.idx - b.idx)
    .map(({ idx, deliverIdx, ...t }) => ({
      ...t,
      deliverPoint: t.deliverPoint || 'BODEGA',
      order: idx + 1,
      deliverOrder: deliverIdx !== undefined ? deliverIdx + 1 : undefined,
      notes: t.notes?.slice(0, 300),
    }));
}

export const SendRouteToAppModal: React.FC<{ plan: VehiclePlan; onClose: () => void }> = ({ plan, onClose }) => {
  const { user, userName } = useAuth();
  const [driver, setDriver] = useState<DriverValue>({ driver: '' });
  const [placa, setPlaca] = useState('MENSAJEROS');
  const [day, setDay] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const tasks = useMemo(() => planToRouteTasks(plan), [plan]);

  const send = async () => {
    if (!user?.uid || !driver.driverUserId) return;
    setSaving(true);
    setMessage('');
    const res = await createRouteTasks({
      tasks,
      driverId: driver.driverUserId,
      driverName: driver.driver,
      placa,
      day,
      source: 'planificador',
      actor: { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' },
    });
    setSaving(false);
    if (!res.success) {
      setMessage(res.error || 'No se pudo enviar.');
      return;
    }
    const skipped = res.skipped?.length ? ` Omitidas: ${res.skipped.map((s) => `TF ${s.numeroTF} (${s.reason})`).join(', ')}.` : '';
    setMessage(`${res.created} TF enviadas a la app de ${driver.driver}.${skipped}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-800">Enviar ruta a la app · {plan.name}</h3>
        <p className="text-sm text-gray-600">
          {tasks.filter((t) => t.kind !== 'libre').length} TF y {tasks.filter((t) => t.kind === 'libre').length} envío(s) sin TF. El mensajero los verá
          en &quot;Mis entregas&quot; agrupados por punto. Los números que no existan como TF también se registran como envío sin TF, con código propio
          para buscarlos después.
        </p>
        <div className="space-y-1">
          <label className="text-sm font-medium">Mensajero (usuario conductor) *</label>
          <DriverUserSelect value={driver} onChange={setDriver} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Placa / recurso</label>
            <input className="w-full rounded-md border px-3 py-2" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Día</label>
            <input type="date" className="w-full rounded-md border px-3 py-2" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>
        <div className="max-h-48 overflow-auto rounded border text-xs">
          {tasks.map((t, i) => (
            <div key={`${t.numeroTF || t.description}-${i}`} className="flex justify-between gap-2 border-b px-2 py-1">
              <span className="font-semibold">
                {t.kind === 'libre' ? <><span className="mr-1 rounded bg-amber-100 px-1 text-amber-800">Sin TF</span>{t.description}</> : `TF ${t.numeroTF}`}
              </span>
              <span>{t.pickupPoint ? `${t.pickupPoint} → ` : ''}{t.deliverPoint}</span>
            </div>
          ))}
        </div>
        {message && <p className="text-sm font-medium text-blue-700">{message}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md bg-gray-200 px-4 py-2">Cerrar</button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={saving || !driver.driverUserId || placa.trim().length < 3 || tasks.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Enviando...' : 'Enviar a la app'}
          </button>
        </div>
      </div>
    </div>
  );
};
