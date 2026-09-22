"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, ClipboardList, Loader2, Plus, RefreshCcw } from "lucide-react";
import {
  createLogisticsAdminTask,
  listLogisticsAdminTasks,
  setLogisticsAdminTaskDone,
  type LogisticsAdminTask,
} from "@/app/adminTasksActions";
import { useAuth } from "@/hooks/use-auth-context";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function formatShortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Floating admin-only pendientes panel for the Suite shell.
 * Failures never block Suite load — errors stay inside the panel.
 */
export function AdminTasksPopup() {
  const { user, role, userName } = useAuth();
  const { toast } = useToast();
  const isAdmin = String(role || "").trim().toLowerCase() === "admin";

  const [open, setOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [tasks, setTasks] = useState<LogisticsAdminTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const actor = useMemo(
    () => ({
      uid: user?.uid || "",
      name: userName || user?.displayName || user?.email || null,
    }),
    [user?.uid, user?.displayName, user?.email, userName]
  );

  const pendingCount = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);
  const visibleTasks = useMemo(
    () => (showCompleted ? tasks : tasks.filter((t) => !t.done)),
    [tasks, showCompleted]
  );
  const completedCount = tasks.length - pendingCount;

  const loadTasks = useCallback(async () => {
    if (!isAdmin || !actor.uid) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listLogisticsAdminTasks(actor);
      if (result.error) {
        setLoadError(result.error);
        setTasks([]);
      } else {
        setTasks(result.data || []);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudieron cargar los pendientes.";
      setLoadError(message);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [actor, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !open) return;
    void loadTasks();
  }, [isAdmin, open, loadTasks]);

  // Lightweight badge refresh while admin is in the Suite (does not block UI).
  useEffect(() => {
    if (!isAdmin || !actor.uid) return;
    let cancelled = false;
    const refreshBadge = async () => {
      try {
        const result = await listLogisticsAdminTasks(actor);
        if (!cancelled && result.data) setTasks(result.data);
      } catch {
        // Ignore — Suite must keep working.
      }
    };
    void refreshBadge();
    const id = window.setInterval(refreshBadge, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAdmin, actor]);

  if (!isAdmin || !user) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const result = await createLogisticsAdminTask(actor, {
        title: trimmed,
        notes: notes.trim() || undefined,
      });
      if (result.error) {
        toast({ variant: "destructive", title: "No se pudo agregar", description: result.error });
      } else if (result.data) {
        setTasks((prev) => {
          const next = [result.data!, ...prev.filter((t) => t.id !== result.data!.id)];
          return next.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.createdAt.localeCompare(a.createdAt);
          });
        });
        setTitle("");
        setNotes("");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al crear.";
      toast({ variant: "destructive", title: "No se pudo agregar", description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (task: LogisticsAdminTask, nextDone: boolean) => {
    if (togglingId) return;
    if (nextDone && !window.confirm(`¿Marcar como hecho?\n\n"${task.title}"`)) return;

    setTogglingId(task.id);
    const previous = tasks;
    setTasks((prev) =>
      prev
        .map((t) =>
          t.id === task.id
            ? {
                ...t,
                done: nextDone,
                doneAt: nextDone ? new Date().toISOString() : null,
                doneByUid: nextDone ? actor.uid : null,
                updatedAt: new Date().toISOString(),
              }
            : t
        )
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          return b.createdAt.localeCompare(a.createdAt);
        })
    );

    try {
      const result = await setLogisticsAdminTaskDone(actor, task.id, nextDone);
      if (result.error) {
        setTasks(previous);
        toast({ variant: "destructive", title: "No se pudo actualizar", description: result.error });
      }
    } catch (err: unknown) {
      setTasks(previous);
      const message = err instanceof Error ? err.message : "Error al actualizar.";
      toast({ variant: "destructive", title: "No se pudo actualizar", description: message });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-slate-300 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-50 shadow-lg transition hover:bg-slate-800 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2",
          "dark:border-slate-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        )}
        aria-label="Abrir pendientes de logística"
        title="Pendientes admin"
      >
        <ClipboardList className="h-5 w-5 shrink-0" />
        <span className="hidden sm:inline">Pendientes</span>
        {pendingCount > 0 && (
          <Badge className="ml-0.5 h-5 min-w-5 justify-center rounded-full bg-amber-500 px-1.5 text-[11px] text-white hover:bg-amber-500">
            {pendingCount > 99 ? "99+" : pendingCount}
          </Badge>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="space-y-1 border-b px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CheckSquare className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              Pendientes logística
            </DialogTitle>
            <DialogDescription>
              Lista compartida entre administradores. Marca con el checkbox al completar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 border-b bg-slate-50/80 px-5 py-4 dark:bg-slate-900/40">
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="admin-task-title">Nuevo pendiente</Label>
                <Input
                  id="admin-task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Título corto…"
                  maxLength={160}
                  disabled={saving}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-task-notes" className="text-muted-foreground">
                  Notas (opcional)
                </Label>
                <Textarea
                  id="admin-task-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Detalle breve…"
                  maxLength={1000}
                  rows={2}
                  disabled={saving}
                  className="resize-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button type="submit" size="sm" disabled={saving || !title.trim()} className="gap-1.5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Agregar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadTasks()}
                  disabled={loading}
                  className="gap-1.5 text-muted-foreground"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Actualizar
                </Button>
              </div>
            </form>
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs text-muted-foreground">
            <span>
              {pendingCount} pendiente{pendingCount === 1 ? "" : "s"}
              {completedCount > 0 ? ` · ${completedCount} hecho${completedCount === 1 ? "" : "s"}` : ""}
            </span>
            {completedCount > 0 && (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => setShowCompleted((v) => !v)}
              >
                {showCompleted ? "Ocultar hechos" : "Mostrar hechos"}
              </button>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
            {loading && tasks.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
              </div>
            ) : loadError ? (
              <div className="mx-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                No se pudieron cargar los pendientes. La Suite sigue operativa.
                <p className="mt-1 text-xs opacity-80">{loadError}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void loadTasks()}>
                  Reintentar
                </Button>
              </div>
            ) : visibleTasks.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                {showCompleted || completedCount === 0
                  ? "No hay pendientes. Agrega el primero arriba."
                  : "No hay pendientes abiertos. Usa “Mostrar hechos” para ver completados."}
              </p>
            ) : (
              <ul className="space-y-1 px-2">
                {visibleTasks.map((task) => (
                  <li
                    key={task.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors",
                      task.done ? "opacity-60" : "hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    )}
                  >
                    <Checkbox
                      id={`admin-task-${task.id}`}
                      checked={task.done}
                      disabled={togglingId === task.id}
                      onCheckedChange={(checked) => {
                        void handleToggle(task, checked === true);
                      }}
                      className="mt-0.5"
                      aria-label={task.done ? "Reabrir pendiente" : "Marcar como hecho"}
                    />
                    <label htmlFor={`admin-task-${task.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <div
                        className={cn(
                          "text-sm font-medium leading-snug text-foreground",
                          task.done && "line-through text-muted-foreground"
                        )}
                      >
                        {task.title}
                      </div>
                      {task.notes ? (
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{task.notes}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {task.createdByName}
                        {task.createdAt ? ` · ${formatShortDate(task.createdAt)}` : ""}
                        {task.done && task.doneAt ? ` · hecho ${formatShortDate(task.doneAt)}` : ""}
                      </p>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
