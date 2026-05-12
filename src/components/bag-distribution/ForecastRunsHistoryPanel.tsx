"use client";

import React, { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { listSupplyForecastRuns, getSupplyForecastRun } from "@/app/forecast-snapshot-actions";
import type { ListForecastRunsResult } from "@/lib/forecastSnapshot/supplyForecastRunsMeta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatPersisted(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

/** Serializa documentos Firestore (p. ej. Timestamp) para mostrar en JSON legible. */
function stringifyDoc(data: Record<string, unknown>): string {
  return JSON.stringify(
    data,
    (_, v) => {
      if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
        const ms = (v as { toMillis: () => number }).toMillis();
        return { _firestoreTimestampMs: ms, iso: new Date(ms).toISOString() };
      }
      return v;
    },
    2
  );
}

export const ForecastRunsHistoryPanel: React.FC = () => {
  const [listState, setListState] = useState<ListForecastRunsResult | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailJson, setDetailJson] = useState<string>("");
  const [detailTitle, setDetailTitle] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await listSupplyForecastRuns(40);
      setListState(res);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = useCallback(async (id: string) => {
    setDetailTitle(id);
    setDetailJson("");
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await getSupplyForecastRun(id);
      if (res.success) {
        setDetailJson(stringifyDoc(res.data));
      } else {
        setDetailJson(JSON.stringify({ error: res.error }, null, 2));
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  return (
    <div className="bg-slate-800 shadow-2xl rounded-xl p-6 mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-3xl font-bold text-sky-400 border-b-2 border-sky-500 pb-2 flex items-center gap-2">
          <History className="h-8 w-8 shrink-0" />
          Historial de corridas (Firestore)
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadList()}
          disabled={listLoading}
          className="border-slate-600 text-slate-200"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${listLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <p className="text-slate-400 text-sm mb-4">
        Últimas corridas guardadas en la colección <code className="text-sky-300">supplyForecastRuns</code>. Pulse
        &quot;Ver detalle&quot; para inspeccionar el payload (solo lectura).
      </p>

      {listLoading && !listState ? (
        <p className="text-sky-300">Cargando historial…</p>
      ) : listState && !listState.success ? (
        <div className="rounded-md bg-amber-900/40 border border-amber-700/50 text-amber-100 px-4 py-3 text-sm">
          {listState.error}
        </div>
      ) : listState && listState.success && listState.items.length === 0 ? (
        <p className="text-slate-400">No hay corridas guardadas todavía.</p>
      ) : listState && listState.success ? (
        <Table>
          <TableHeader>
            <TableRow className="border-slate-600 hover:bg-transparent">
              <TableHead className="text-sky-300">Fecha corrida (ISO)</TableHead>
              <TableHead className="text-sky-300">Items</TableHead>
              <TableHead className="text-sky-300">Guardado</TableHead>
              <TableHead className="text-sky-300 text-right">Id</TableHead>
              <TableHead className="text-sky-300 text-right w-[120px]">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listState.items.map((row) => (
              <TableRow key={row.id} className="border-slate-600">
                <TableCell className="text-slate-200 font-mono text-xs max-w-[200px] truncate" title={row.generationDateIso}>
                  {row.generationDateIso || "—"}
                </TableCell>
                <TableCell className="text-slate-200">{row.itemCount}</TableCell>
                <TableCell className="text-slate-300 text-sm">{formatPersisted(row.persistedAtMs)}</TableCell>
                <TableCell className="text-slate-400 font-mono text-xs text-right max-w-[140px] truncate" title={row.id}>
                  {row.id}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="bg-slate-700 text-slate-100 hover:bg-slate-600"
                    onClick={() => void openDetail(row.id)}
                  >
                    Ver detalle
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col bg-slate-900 border-slate-600 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-sky-400 truncate pr-8" title={detailTitle}>
              Detalle corrida
            </DialogTitle>
            <p className="text-xs text-slate-400 font-mono break-all">{detailTitle}</p>
          </DialogHeader>
          {detailLoading ? (
            <p className="text-sky-300 text-sm">Cargando…</p>
          ) : (
            <pre className="text-xs overflow-auto max-h-[60vh] rounded-md bg-slate-950 p-4 border border-slate-700 text-slate-200 whitespace-pre-wrap break-words">
              {detailJson}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
