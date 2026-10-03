"use client";

import React, { useEffect, useState } from 'react';
import { getAllUserProfiles } from '@/app/reception/actions';
import type { AppUser } from '@/types';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const OTHER = '__other__';

export type DriverValue = { driverUserId?: string; driver: string };

/**
 * Conductor de la relación: usuario con perfil conductor (le aparece en su app de entregas)
 * o nombre libre como antes (no le aparece a nadie).
 */
export function DriverUserSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: DriverValue;
  onChange: (v: DriverValue) => void;
}) {
  const [drivers, setDrivers] = useState<AppUser[]>([]);
  const [manual, setManual] = useState(!value.driverUserId && !!value.driver);

  useEffect(() => {
    let alive = true;
    getAllUserProfiles()
      .then((users) => {
        if (!alive) return;
        setDrivers(
          users
            .filter((u) => String(u.role || '').toLowerCase() === 'conductor' && !u.disabled)
            .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
        );
      })
      .catch(() => setDrivers([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!value.driverUserId && !value.driver) setManual(false);
  }, [value.driverUserId, value.driver]);

  const selectValue = value.driverUserId || (manual ? OTHER : '');

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === OTHER) {
            setManual(true);
            onChange({ driverUserId: undefined, driver: '' });
            return;
          }
          setManual(false);
          const u = drivers.find((d) => d.uid === v);
          onChange({ driverUserId: v, driver: u?.displayName || u?.email || '' });
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={drivers.length ? 'Seleccione el conductor...' : 'Sin usuarios conductor: use "Otro"'} />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((d) => (
            <SelectItem key={d.uid} value={d.uid}>
              {d.displayName || d.email}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Otro (escribir nombre, sin app de entregas)</SelectItem>
        </SelectContent>
      </Select>
      {manual && (
        <Input
          placeholder="Nombre del conductor"
          value={value.driver}
          onChange={(e) => onChange({ driverUserId: undefined, driver: e.target.value })}
        />
      )}
    </div>
  );
}
