"use client";

import React, { useMemo, useState, useCallback } from "react";
import type { ManualJustifications, ManualJustificationsUpdate, JustificationType } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { CURRENT_APP_VERSION } from "@/app/version";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function typeLabel(t: JustificationType | undefined): string {
  switch (t) {
    case "BREAKFAST":
      return "Desayuno";
    case "LUNCH":
      return "Almuerzo";
    case "SNACK":
      return "Refrigerio";
    case "SHIFT_END":
      return "Fin de labor";
    case "PULSE_IGNORE":
      return "Ignorar pulso";
    case "REASON":
      return "Razón";
    default:
      return String(t ?? "—");
  }
}

/** Muchas claves terminan en `-` + epoch ms (13 dígitos) o s (10) del tramo de inactividad. */
const TRAILING_EPOCH = /-(\d{10,13})$/;

function inferMomentFromKey(key: string): Date | null {
  const m = key.match(TRAILING_EPOCH);
  if (!m) return null;
  const raw = m[1];
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  const ms = raw.length >= 13 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 2020 || y > 2035) return null;
  return d;
}

/** Texto legible antes del sufijo numérico (operario + segmento opcional tipo `-final`). */
function inferLabelFromKey(key: string): string {
  const noTs = key.replace(TRAILING_EPOCH, "");
  const cleaned = noTs.replace(/-(final|pre|post|justified|excess|remains)$/i, "");
  return cleaned.trim() || "—";
}

interface ManualJustificationsInspectorProps {
  reportDate: string;
  justifications: ManualJustifications;
  onJustificationsChange: (update: ManualJustificationsUpdate) => void;
  onReloadFromServer?: () => Promise<void>;
  isSaving?: boolean;
}

export const ManualJustificationsInspector: React.FC<ManualJustificationsInspectorProps> = ({
  reportDate,
  justifications,
  onJustificationsChange,
  onReloadFromServer,
  isSaving = false,
}) => {
  const [open, setOpen] = useState(true);
  const [reloadBusy, setReloadBusy] = useState(false);

  const rows = useMemo(() => {
    return Object.entries(justifications)
      .map(([key, val]) => {
        const inferredAt = inferMomentFromKey(key);
        const manualTime =
          val.startTime && val.endTime ? `${val.startTime}–${val.endTime}` : val.startTime || val.endTime || "";
        const detail = [val.reasonText, manualTime, val.customDuration != null ? `${val.customDuration} min` : ""]
          .filter(Boolean)
          .join(" · ");
        const inferredLine = inferredAt
          ? format(inferredAt, "EEE d MMM yyyy, HH:mm", { locale: es })
          : "";
        return {
          key,
          type: val.type,
          operatorLabel: inferLabelFromKey(key),
          inferredAt,
          inferredLine,
          detail,
        };
      })
      .sort((a, b) => {
        const ta = a.inferredAt?.getTime() ?? 0;
        const tb = b.inferredAt?.getTime() ?? 0;
        if (ta !== tb) return ta - tb;
        return a.key.localeCompare(b.key);
      });
  }, [justifications]);

  const removeKey = useCallback(
    (key: string) => {
      onJustificationsChange((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [onJustificationsChange],
  );

  const handleReload = useCallback(async () => {
    if (!onReloadFromServer) return;
    setReloadBusy(true);
    try {
      await onReloadFromServer();
    } finally {
      setReloadBusy(false);
    }
  }, [onReloadFromServer]);

  return (
    <Card className="border-amber-600/40 bg-amber-950/10">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 text-left font-semibold text-foreground hover:opacity-90"
          >
            {open ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
            <span>Justificaciones manuales — día {reportDate || "—"}</span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {onReloadFromServer && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleReload()}
                disabled={reloadBusy || isSaving}
                className="border-muted-foreground/40"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", reloadBusy && "animate-spin")} />
                Recargar desde servidor
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          Solo entradas del documento <code className="text-xs">reports_justifications/{reportDate || "—"}</code>{" "}
          (misma fecha que el reporte que vas a generar). La columna <strong>Fecha/hora (ID)</strong> se calcula del
          número final de la clave cuando es un instante válido; desayuno/almuerzo sin texto siguen siendo
          identificables por esa hora. Al borrar se guarda de nuevo el mapa del día. App:{" "}
          <span className="font-mono text-sky-600 dark:text-sky-400">{CURRENT_APP_VERSION}</span>
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No hay entradas en el mapa de justificaciones para este día.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">Operario / tramo</TableHead>
                  <TableHead className="whitespace-nowrap min-w-[150px]">Fecha/hora (ID)</TableHead>
                  <TableHead className="w-[11%]">Tipo</TableHead>
                  <TableHead>Detalle manual</TableHead>
                  <TableHead className="min-w-[200px] max-w-[320px]">Clave completa</TableHead>
                  <TableHead className="w-[100px] text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="text-sm align-top">{row.operatorLabel}</TableCell>
                    <TableCell className="text-sm align-top whitespace-nowrap text-foreground">
                      {row.inferredLine || "—"}
                    </TableCell>
                    <TableCell className="text-sm align-top whitespace-nowrap">{typeLabel(row.type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top break-words">
                      {row.detail || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] align-top break-all text-muted-foreground">
                      {row.key}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeKey(row.key)}
                        disabled={isSaving}
                      >
                        <Trash2 className="h-4 w-4 mr-1 inline" />
                        Borrar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}
    </Card>
  );
};
