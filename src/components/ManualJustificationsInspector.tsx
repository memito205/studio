"use client";

import React, { useMemo, useState, useCallback } from "react";
import type { ManualJustifications, JustificationType } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface ManualJustificationsInspectorProps {
  reportDate: string;
  justifications: ManualJustifications;
  onJustificationsChange: (next: ManualJustifications) => void;
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
      .map(([key, val]) => ({
        key,
        type: val.type,
        detail: [val.reasonText, val.startTime && val.endTime ? `${val.startTime}–${val.endTime}` : "", val.customDuration != null ? `${val.customDuration} min` : ""]
          .filter(Boolean)
          .join(" · "),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [justifications]);

  const removeKey = useCallback(
    (key: string) => {
      const next = { ...justifications };
      delete next[key];
      onJustificationsChange(next);
    },
    [justifications, onJustificationsChange],
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
            <span>Justificaciones manuales (Firestore / día)</span>
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
          Fecha de reporte: <span className="font-mono text-foreground">{reportDate || "—"}</span>. Cada fila es una
          clave guardada en <code className="text-xs">reports_justifications</code> (y posibles merges de historial).
          Al eliminar, se quita la clave y se vuelve a guardar el documento del día. Versión de app mostrada:{" "}
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
                  <TableHead className="w-[38%] min-w-[120px]">Clave (id en Firestore)</TableHead>
                  <TableHead className="w-[14%]">Tipo</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead className="w-[100px] text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-mono text-xs align-top break-all max-w-[280px]">{row.key}</TableCell>
                    <TableCell className="text-sm align-top whitespace-nowrap">{typeLabel(row.type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top break-words">{row.detail || "—"}</TableCell>
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
